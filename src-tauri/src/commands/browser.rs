use crate::services::browser::action_service::{
    build_page_agent_script, normalize_browser_url, strip_thinking_content,
};
use crate::services::browser::inspection_service::{
    EMBEDDED_SURFACE_INSPECTION_SCRIPT, STANDALONE_INSPECTION_SCRIPT,
};
use crate::utils::{AppError, AppResult};
use reqwest::Client as ReqwestClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
/**
 * Browser commands for second WebviewWindow approach
 *
 * Opens a separate Tauri window to load target URLs, then injects
 * PageAgent JavaScript for real browser automation control.
 *
 * Uses Tauri v2 API (WebviewWindowBuilder)
 */
use std::sync::Arc;
use tauri::{
    Listener, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::Mutex;

pub use crate::services::browser::inspection_service::RawBrowserInspection;

/// Represents which browser surface is currently active.
/// This eliminates ambiguity in dual-track execution environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActiveSurface {
    /// No browser surface is currently active
    #[default]
    None,
    /// Standalone window mode (created via open_browser_window)
    StandaloneWindow,
    /// Embedded mode (created via open_embedded_surface)
    Embedded,
}

/// Browser window state management
pub struct BrowserState {
    pub browser_window: Option<WebviewWindow>,
    pub embedded_webview: Option<Webview>,
    pub is_busy: bool,
    /// Embedded webview mode - when true, browser renders in embedded pane
    pub embedded_mode: bool,
    /// The main window label for embedding
    pub main_window_label: String,
    /// Current active surface type - authoritative source for routing decisions
    pub active_surface: ActiveSurface,
}

impl BrowserState {
    /// Check if any browser surface is currently open
    #[allow(dead_code)]
    pub fn has_active_surface(&self) -> bool {
        self.embedded_webview.is_some() || self.browser_window.is_some()
    }

    /// Get the target webview and surface type for execution.
    /// This is the unified entry point for all browser operations,
    /// ensuring consistent routing across all commands.
    ///
    /// Returns: (Webview, ActiveSurface) or error if no surface is available
    pub fn get_target(&self) -> Result<(Webview, ActiveSurface), AppError> {
        // Priority: Embedded > StandaloneWindow (consistent with get_embedded_surface_url)
        if let Some(ref webview) = self.embedded_webview {
            return Ok((webview.clone(), ActiveSurface::Embedded));
        }

        if let Some(ref window) = self.browser_window {
            // WebviewWindow.webviews() returns Vec<(label, Webview)> in Tauri v2
            let webviews = window.webviews();
            let (_, webview) = webviews
                .into_iter()
                .next()
                .ok_or_else(|| AppError::InternalError("No webview in window".to_string()))?;
            return Ok((webview, ActiveSurface::StandaloneWindow));
        }

        Err(AppError::InvalidInput(
            "No browser surface open".to_string(),
        ))
    }

    /// Activate embedded surface mode
    pub fn activate_embedded(&mut self, webview: Webview) {
        self.embedded_webview = Some(webview);
        self.active_surface = ActiveSurface::Embedded;
    }

    /// Activate standalone window mode
    pub fn activate_standalone(&mut self, window: WebviewWindow) {
        self.browser_window = Some(window);
        self.active_surface = ActiveSurface::StandaloneWindow;
    }

    /// Deactivate all surfaces and reset state
    pub fn deactivate_all(&mut self) {
        if let Some(w) = self.browser_window.take() {
            let _ = w.close();
        }
        if let Some(w) = self.embedded_webview.take() {
            let _ = w.close();
        }
        self.active_surface = ActiveSurface::None;
    }

    /// Get description of current surface for logging/debugging
    pub fn surface_description(&self) -> &'static str {
        match self.active_surface {
            ActiveSurface::Embedded => "embedded",
            ActiveSurface::StandaloneWindow => "standalone_window",
            ActiveSurface::None => "none",
        }
    }
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            browser_window: None,
            embedded_webview: None,
            is_busy: false,
            embedded_mode: false,
            main_window_label: "main".to_string(),
            active_surface: ActiveSurface::None,
        }
    }
}

/// Open a new browser window with the given URL
#[tauri::command]
pub async fn open_browser_window(
    url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    println!("[Browser] Opening window for URL: {}", url);

    // Validate URL
    if url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::InvalidInput(
            "URL must start with http:// or https://".to_string(),
        ));
    }

    // Parse URL to validate it
    let parsed_url =
        Url::parse(&url).map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut state = state.lock().await;

    // Close existing browser window if any
    if let Some(window) = state.browser_window.take() {
        let _ = window.close();
    }

    // Create new browser window using Tauri v2 WebviewWindowBuilder API
    let window =
        WebviewWindowBuilder::new(&app, "browser-window", WebviewUrl::External(parsed_url))
            .title("Browser Agent")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .visible(false)
            .focused(false)
            .build()
            .map_err(|e| {
                AppError::InternalError(format!("Failed to create browser window: {}", e))
            })?;

    state.activate_standalone(window);

    println!("[Browser] Window created successfully");
    Ok("Browser window opened".to_string())
}

// ============================================
// Embedded Surface Architecture Commands
// ============================================

/// Open browser in embedded mode - creates a webview embedded in the main window
/// This is the primary browser surface for the "real browser in-app" experience
/// This command replaces the separate window approach with embedded webview
#[tauri::command]
pub async fn open_embedded_surface(
    url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    println!("[Browser] Opening embedded surface for URL: {}", url);

    // Validate URL
    if url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    let normalized_url = normalize_browser_url(&url);

    let parsed_url = Url::parse(&normalized_url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut state = state.lock().await;

    // Close any existing webviews to avoid conflicts
    state.deactivate_all();

    // Get the main window
    let main_window = app
        .get_window(&state.main_window_label)
        .ok_or_else(|| AppError::InternalError("Main window not found".to_string()))?;

    let webview_builder =
        WebviewBuilder::new("embedded-browser-surface", WebviewUrl::External(parsed_url));
    let webview = main_window
        .add_child(
            webview_builder,
            LogicalPosition::new(100.0, 100.0),
            LogicalSize::new(800.0, 600.0),
        )
        .map_err(|e| {
            AppError::InternalError(format!("Failed to create embedded surface: {}", e))
        })?;

    webview.hide().map_err(|e| {
        AppError::InternalError(format!("Failed to hide embedded surface initially: {}", e))
    })?;

    state.activate_embedded(webview);

    println!("[Browser] Embedded surface created successfully");
    Ok("Embedded surface opened".to_string())
}

#[tauri::command]
pub async fn move_browser_surface(
    target_mode: String,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let (webview, browser_window) = {
        let mut state = state.lock().await;
        state.embedded_mode = true;
        let webview = state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone();
        let browser_window = state.browser_window.clone();
        (webview, browser_window)
    };

    match target_mode.as_str() {
        "mini" | "expanded" => {
            let (x, y, width, height) = (x, y, width, height);
            let (x, y, width, height) = match (x, y, width, height) {
                (Some(x), Some(y), Some(width), Some(height)) => {
                    (x, y, width.max(1.0), height.max(1.0))
                }
                _ => {
                    return Err(AppError::InvalidInput(
                        "Bounds are required when moving browser surface to mini or expanded mode"
                            .to_string(),
                    ));
                }
            };

            webview
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| {
                    AppError::InternalError(format!("Failed to move browser surface: {}", e))
                })?;
            webview
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| {
                    AppError::InternalError(format!("Failed to resize browser surface: {}", e))
                })?;
            webview.show().map_err(|e| {
                AppError::InternalError(format!("Failed to show browser surface: {}", e))
            })?;

            if let Some(window) = browser_window {
                let _ = window.hide();
            }

            println!(
                "[Browser] Browser surface moved to {} at ({:.1}, {:.1}) size {:.1}x{:.1}",
                target_mode, x, y, width, height
            );
            Ok(format!(
                "Browser surface moved to {} at ({:.1}, {:.1}) size {:.1}x{:.1}",
                target_mode, x, y, width, height
            ))
        }
        "hidden" => {
            webview.hide().map_err(|e| {
                AppError::InternalError(format!("Failed to hide browser surface: {}", e))
            })?;
            println!("[Browser] Browser surface hidden");
            Ok("Browser surface hidden".to_string())
        }
        _ => Err(AppError::InvalidInput(
            "Invalid mode. Use 'mini', 'expanded', or 'hidden'".to_string(),
        )),
    }
}

/// Show or hide the embedded browser surface without closing the underlying session.
#[tauri::command]
pub async fn set_embedded_surface_visibility(
    visible: bool,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let (webview, surface_type) = {
        let state = state.lock().await;
        state.get_target()?
    };

    if visible {
        webview.show().map_err(|e| {
            AppError::InternalError(format!("Failed to show browser surface: {}", e))
        })?;
    } else {
        webview.hide().map_err(|e| {
            AppError::InternalError(format!("Failed to hide browser surface: {}", e))
        })?;
    }

    Ok(format!(
        "Browser surface ({:?}) visibility set to {}",
        surface_type, visible
    ))
}

/// Get the current browser surface URL using unified routing.
/// Uses embedded_webview first, then falls back to browser_window.
#[tauri::command]
pub async fn get_embedded_surface_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let (webview, surface_type) = {
        let state = state.lock().await;
        state.get_target()?
    };

    let url = webview
        .url()
        .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;

    println!(
        "[Browser] get_embedded_surface_url: surface={:?}, url={}",
        surface_type, url
    );
    Ok(url.to_string())
}

/// Execute task on the current active surface using unified routing.
#[tauri::command]
pub async fn execute_on_embedded_surface(
    task: String,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    #[allow(non_snake_case)] apiKey: String,
    model: String,
    #[allow(non_snake_case)] systemPrompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let page_agent_script = build_page_agent_script(&task, baseUrl, &apiKey, &model, systemPrompt);

    let (webview, surface_type) = {
        let mut st = state.lock().await;

        if st.is_busy {
            return Err(AppError::InvalidInput(
                "Agent is already running".to_string(),
            ));
        }

        let result = st.get_target()?;
        st.is_busy = true;
        result
    };

    println!(
        "[Browser] Executing on {:?} surface: {}",
        surface_type, task
    );
    println!("[Browser] Script size: {} bytes", page_agent_script.len());

    match webview.eval(&page_agent_script) {
        Ok(_) => println!("[Browser] ✅ eval() succeeded on {:?}", surface_type),
        Err(e) => {
            println!("[Browser] ❌ eval() FAILED: {}", e);
            let mut st = state.lock().await;
            st.is_busy = false;
            return Err(AppError::InternalError(format!(
                "Failed to inject script: {}",
                e
            )));
        }
    }

    {
        let mut st = state.lock().await;
        st.is_busy = false;
    }

    Ok(format!(
        "Task execution started on {:?} surface",
        surface_type
    ))
}

/// Inspect browser state on the current active surface using unified routing.
#[tauri::command]
pub async fn inspect_embedded_surface(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<RawBrowserInspection> {
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::sync::oneshot;

    let (webview, surface_type) = {
        let st = state.lock().await;
        st.get_target()?
    };

    println!("[Browser] Inspecting {:?} surface", surface_type);

    let (tx, rx) = oneshot::channel::<Result<RawBrowserInspection, String>>();
    let tx = StdArc::new(StdMutex::new(Some(tx)));

    let success_tx = tx.clone();
    let success_listener = app.once("browser_inspection_result", move |event| {
        let payload = event.payload().to_string();
        if let Ok(mut sender) = success_tx.lock() {
            if let Some(tx) = sender.take() {
                let parsed = serde_json::from_str::<RawBrowserInspection>(&payload)
                    .map_err(|e| format!("Failed to parse inspection payload: {}", e));
                let _ = tx.send(parsed);
            }
        }
    });

    let error_tx = tx.clone();
    let error_listener = app.once("browser_inspection_error", move |event| {
        let payload = event.payload().to_string();
        let message = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("Browser inspection failed: {}", payload));

        if let Ok(mut sender) = error_tx.lock() {
            if let Some(tx) = sender.take() {
                let _ = tx.send(Err(message));
            }
        }
    });

    let inspection_script = EMBEDDED_SURFACE_INSPECTION_SCRIPT;

    webview.eval(inspection_script).map_err(|e| {
        AppError::InternalError(format!("Failed to inject inspection script: {}", e))
    })?;

    let inspection = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| {
            AppError::InternalError("Timed out waiting for browser inspection result".to_string())
        })?
        .map_err(|_| {
            AppError::InternalError("Browser inspection channel closed unexpectedly".to_string())
        })?
        .map_err(AppError::InternalError)?;

    app.unlisten(success_listener);
    app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url, inspection.text_markers
    );
    Ok(inspection)
}

/// Navigate using unified routing.
#[tauri::command]
pub async fn navigate_embedded_surface(
    url: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let (webview, surface_type) = {
        let state = state.lock().await;
        state.get_target()?
    };

    let normalized_url = normalize_browser_url(&url);

    let script = format!(
        "window.location.href = '{}';",
        normalized_url.replace('\'', "\\'")
    );
    webview
        .eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to navigate: {}", e)))?;

    println!(
        "[Browser] Navigating {:?} surface to: {}",
        surface_type, normalized_url
    );
    Ok(format!(
        "Navigated to: {} (via {:?})",
        normalized_url, surface_type
    ))
}

/// Reload using unified routing.
#[tauri::command]
pub async fn reload_embedded_surface(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let (webview, surface_type) = {
        let state = state.lock().await;
        state.get_target()?
    };

    webview
        .eval("window.location.reload();")
        .map_err(|e| AppError::InternalError(format!("Failed to reload: {}", e)))?;

    println!("[Browser] {:?} surface reloaded", surface_type);
    Ok(format!("Page reloaded (via {:?})", surface_type))
}

/// Close the embedded surface and clear its state.
#[tauri::command]
pub async fn close_embedded_surface(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let mut state = state.lock().await;

    if let Some(webview) = state.embedded_webview.take() {
        webview
            .close()
            .map_err(|e| AppError::InternalError(format!("Failed to close: {}", e)))?;
        println!("[Browser] Embedded surface closed");
    }

    state.embedded_mode = false;
    if state.active_surface == ActiveSurface::Embedded {
        state.active_surface = ActiveSurface::None;
    }
    Ok("Embedded surface closed".to_string())
}

/// Show the existing browser window
#[tauri::command]
pub async fn show_browser_window(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let maybe_target = {
        let state = state.lock().await;
        if let Some(window) = state.browser_window.as_ref() {
            Some(window.clone())
        } else if state.embedded_webview.is_some() {
            None
        } else {
            return Err(AppError::InvalidInput(
                "No browser surface open".to_string(),
            ));
        }
    };

    if let Some(browser_window) = maybe_target {
        browser_window.show().map_err(|e| {
            AppError::InternalError(format!("Failed to show browser window: {}", e))
        })?;
        browser_window.set_focus().map_err(|e| {
            AppError::InternalError(format!("Failed to focus browser window: {}", e))
        })?;
        Ok("Browser window shown".to_string())
    } else {
        Ok("Embedded browser surface is already visible in-app".to_string())
    }
}

/// Close all browser surfaces and reset state using unified deactivation
#[tauri::command]
pub async fn close_browser_window(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let surface_type = {
        let mut st = state.lock().await;
        let desc = st.surface_description().to_string();
        st.deactivate_all();
        desc
    };

    println!("[Browser] All surfaces closed (was: {})", surface_type);
    Ok(format!("Browser surface closed (type: {})", surface_type))
}

/// Execute PageAgent task using unified routing.
/// Routes to embedded surface first, then falls back to standalone window.
/// This ensures consistent behavior with get_embedded_surface_url.
#[tauri::command]
pub async fn execute_agent_task(
    task: String,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    #[allow(non_snake_case)] apiKey: String,
    model: String,
    #[allow(non_snake_case)] systemPrompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    // Build the script before locking state to avoid borrow issues
    let page_agent_script = build_page_agent_script(&task, baseUrl, &apiKey, &model, systemPrompt);

    // Unified routing: get target webview using consistent priority
    let (webview, surface_type) = {
        let mut st = state.lock().await;

        if st.is_busy {
            return Err(AppError::InvalidInput(
                "Agent is already running".to_string(),
            ));
        }

        // Use unified get_target() - Embedded first, then StandaloneWindow
        let target = st.get_target()?;
        st.is_busy = true;
        target
    };

    println!(
        "[Browser] Executing agent task on {:?} surface: {}",
        surface_type, task
    );
    println!("[Browser] Script size: {} bytes", page_agent_script.len());

    match webview.eval(&page_agent_script) {
        Ok(_) => println!("[Browser] ✅ eval() succeeded on {:?}", surface_type),
        Err(e) => {
            println!("[Browser] ❌ eval() FAILED: {}", e);
            let mut st = state.lock().await;
            st.is_busy = false;
            return Err(AppError::InternalError(format!(
                "Failed to inject script: {}",
                e
            )));
        }
    }

    {
        let mut st = state.lock().await;
        st.is_busy = false;
    }

    Ok(format!("Task execution started on {:?}", surface_type))
}

/// HTTP proxy request/response types (for bypassing CSP connect-src)
#[derive(Debug, Serialize, Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Proxy HTTP requests through the backend (bypasses page CSP connect-src).
/// Needed because fetch() from within a CSP-restricted page is blocked for external APIs,
/// but Tauri backend requests are not subject to page CSP.
#[tauri::command]
pub async fn proxy_http_request(request: HttpProxyRequest) -> AppResult<HttpProxyResponse> {
    let client = ReqwestClient::new();

    let method = request.method.to_uppercase();
    let mut req_builder = match method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        "HEAD" => client.head(&request.url),
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported HTTP method: {}",
                method
            )))
        }
    };

    // Add headers
    for (key, value) in request.headers.iter() {
        req_builder = req_builder.header(key, value);
    }

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    // 120-second timeout — reasoning models with large context can take >30s
    let response = req_builder
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("HTTP request failed: {}", e)))?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(val_str) = value.to_str() {
            headers.insert(key.to_string(), val_str.to_string());
        }
    }

    // Read response body and strip thinking traces to keep IPC payload small
    let raw_body = response.text().await.unwrap_or_else(|_| String::new());

    let body = strip_thinking_content(raw_body);

    Ok(HttpProxyResponse {
        status,
        status_text,
        headers,
        body,
    })
}

/// Open DevTools for debugging (development only)
#[tauri::command]
pub async fn open_devtools(state: tauri::State<'_, Arc<Mutex<BrowserState>>>) -> AppResult<()> {
    let state = state.lock().await;

    if let Some(webview) = &state.embedded_webview {
        #[cfg(debug_assertions)]
        {
            webview.open_devtools();
            return Ok(());
        }
        #[cfg(not(debug_assertions))]
        {
            return Err(AppError::InvalidInput(
                "DevTools only available in debug mode".to_string(),
            ));
        }
    }

    Err(AppError::InvalidInput(
        "No embedded webview open".to_string(),
    ))
}

/// Get current browser window URL
#[tauri::command]
pub async fn get_browser_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let state = state.lock().await;

    let browser_window = state
        .browser_window
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    // tauri::Url has a to_string method
    let url = browser_window
        .url()
        .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;
    Ok(url.to_string())
}

/// Inject arbitrary JavaScript into the browser window
#[tauri::command]
pub async fn inject_script(
    script: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let browser_window = {
        let state = state.lock().await;
        state
            .browser_window
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    browser_window
        .eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject script: {}", e)))?;

    Ok("Script injected successfully".to_string())
}

/// Check if browser window is busy
#[tauri::command]
pub async fn is_agent_busy(state: tauri::State<'_, Arc<Mutex<BrowserState>>>) -> AppResult<bool> {
    let state = state.lock().await;
    Ok(state.is_busy)
}

/// Navigate back in browser history
#[tauri::command]
pub async fn browser_go_back(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let target = {
        let state = state.lock().await;
        state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    // Use eval to call window.history.back()
    target
        .eval("window.history.back();")
        .map_err(|e| AppError::InternalError(format!("Failed to go back: {}", e)))?;

    Ok("Navigated back".to_string())
}

/// Inspect the current browser page state
/// Returns raw DOM and text information for auth detection
/// Since Tauri v2's eval doesn't return values, we use a two-step approach:
/// 1. Inject JS that stores result in a global variable and emits an event
/// 2. Get URL from window as fallback, use event for detailed data
#[tauri::command]
pub async fn inspect_browser_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<RawBrowserInspection> {
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::sync::oneshot;

    let browser_window = {
        let state = state.lock().await;
        state
            .browser_window
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    let (tx, rx) = oneshot::channel::<Result<RawBrowserInspection, String>>();
    let tx = StdArc::new(StdMutex::new(Some(tx)));

    let success_tx = tx.clone();
    let success_listener = app.once("browser_inspection_result", move |event| {
        let payload = event.payload().to_string();
        if let Ok(mut sender) = success_tx.lock() {
            if let Some(tx) = sender.take() {
                let parsed = serde_json::from_str::<RawBrowserInspection>(&payload)
                    .map_err(|e| format!("Failed to parse inspection payload: {}", e));
                let _ = tx.send(parsed);
            }
        }
    });

    let error_tx = tx.clone();
    let error_listener = app.once("browser_inspection_error", move |event| {
        let payload = event.payload().to_string();
        let message = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("Browser inspection failed: {}", payload));

        if let Ok(mut sender) = error_tx.lock() {
            if let Some(tx) = sender.take() {
                let _ = tx.send(Err(message));
            }
        }
    });

    let inspection_script = STANDALONE_INSPECTION_SCRIPT;

    // Inject the inspection script
    browser_window.eval(inspection_script).map_err(|e| {
        AppError::InternalError(format!("Failed to inject inspection script: {}", e))
    })?;

    let inspection = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| {
            AppError::InternalError("Timed out waiting for browser inspection result".to_string())
        })?
        .map_err(|_| {
            AppError::InternalError("Browser inspection channel closed unexpectedly".to_string())
        })?
        .map_err(AppError::InternalError)?;

    app.unlisten(success_listener);
    app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url, inspection.text_markers
    );
    Ok(inspection)
}

/// Navigate to a specific URL in the browser window
#[tauri::command]
pub async fn browser_navigate(
    url: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let target = {
        let state = state.lock().await;
        state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    // Validate URL
    if url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    let normalized_url = normalize_browser_url(&url);

    // Use eval to navigate
    let script = format!(
        "window.location.href = '{}';",
        normalized_url.replace('\'', "\\'")
    );
    target
        .eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to navigate: {}", e)))?;

    println!("[Browser] Navigating to: {}", normalized_url);
    Ok(format!("Navigated to: {}", normalized_url))
}

/// Reload the current page in the browser window
#[tauri::command]
pub async fn browser_reload(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let target = {
        let state = state.lock().await;
        state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    target
        .eval("window.location.reload();")
        .map_err(|e| AppError::InternalError(format!("Failed to reload: {}", e)))?;

    println!("[Browser] Page reloaded");
    Ok("Page reloaded".to_string())
}

// ===== Embedded Webview Commands =====

/// Enable embedded mode - browser will render in embedded pane instead of separate window
#[tauri::command]
pub async fn set_embedded_mode(
    enabled: bool,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let mut state = state.lock().await;
    state.embedded_mode = enabled;
    println!("[Browser] Embedded mode: {}", enabled);
    Ok(format!("Embedded mode set to: {}", enabled))
}

/// Get current embedded mode status
#[tauri::command]
pub async fn get_embedded_mode(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<bool> {
    let state = state.lock().await;
    Ok(state.embedded_mode)
}

/// Capture screenshot from browser window (for embedded preview)
#[tauri::command]
pub async fn capture_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let target = {
        let state = state.lock().await;
        state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    // Inject script to capture screenshot using html2canvas approach
    // Since we can't directly capture, we'll use a simpler approach - get page content
    let script = r#"
        (function() {
            // Simple screenshot: capture visible area as data URL
            // This uses a minimal canvas approach
            try {
                const width = window.innerWidth;
                const height = window.innerHeight;

                // Create a minimal SVG with page info as fallback
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                    <rect width="100%" height="100%" fill="white"/>
                    <text x="10" y="30" font-family="system-ui" font-size="14">
                        Page: ${document.title}
                    </text>
                    <text x="10" y="50" font-family="system-ui" font-size="12" fill="gray">
                        ${window.location.href}
                    </text>
                </svg>`;

                const encoded = btoa(unescape(encodeURIComponent(svg)));
                const dataUrl = 'data:image/svg+xml;base64,' + encoded;

                if (window.__TAURI_INTERNALS__) {
                    window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                        event: 'screenshot_captured',
                        windowLabel: null,
                        payload: { dataUrl: dataUrl }
                    });
                }
            } catch(e) {
                console.error('Screenshot error:', e);
                if (window.__TAURI_INTERNALS__) {
                    window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                        event: 'screenshot_error',
                        windowLabel: null,
                        payload: { message: e.message }
                    });
                }
            }
        })();
    "#;

    target
        .eval(script)
        .map_err(|e| AppError::InternalError(format!("Failed to capture screenshot: {}", e)))?;

    Ok("Screenshot capture initiated".to_string())
}

/// Get browser window dimensions (for embedded layout)
#[tauri::command]
pub async fn get_browser_dimensions(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<(u32, u32)> {
    let state = state.lock().await;
    let browser_window = state
        .browser_window
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    let size = browser_window
        .inner_size()
        .map_err(|e| AppError::InternalError(format!("Failed to get dimensions: {}", e)))?;

    Ok((size.width, size.height))
}
