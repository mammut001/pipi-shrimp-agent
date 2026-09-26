use crate::services::browser::action_service::strip_thinking_content;
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
use tokio::sync::Mutex;

mod state;
#[macro_use]
mod embedded_surface;
#[macro_use]
mod window;
pub use state::{ActiveSurface, BrowserState};

pub use crate::services::browser::inspection_service::RawBrowserInspection;

/// Open a new browser window with the given URL
#[tauri::command]
pub async fn open_browser_window(
    url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    open_browser_window_body!(url, app, state)
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
    open_embedded_surface_body!(url, app, state)
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
    move_browser_surface_body!(target_mode, x, y, width, height, state)
}

/// Show or hide the embedded browser surface without closing the underlying session.
#[tauri::command]
pub async fn set_embedded_surface_visibility(
    visible: bool,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    set_embedded_surface_visibility_body!(visible, state)
}

/// Get the current browser surface URL using unified routing.
/// Uses embedded_webview first, then falls back to browser_window.
#[tauri::command]
pub async fn get_embedded_surface_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    get_embedded_surface_url_body!(state)
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
    execute_on_embedded_surface_body!(task, baseUrl, apiKey, model, systemPrompt, state)
}

/// Inspect browser state on the current active surface using unified routing.
#[tauri::command]
pub async fn inspect_embedded_surface(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<RawBrowserInspection> {
    inspect_embedded_surface_body!(app, state)
}

/// Navigate using unified routing.
#[tauri::command]
pub async fn navigate_embedded_surface(
    url: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    navigate_embedded_surface_body!(url, state)
}

/// Reload using unified routing.
#[tauri::command]
pub async fn reload_embedded_surface(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    reload_embedded_surface_body!(state)
}

/// Close the embedded surface and clear its state.
#[tauri::command]
pub async fn close_embedded_surface(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    close_embedded_surface_body!(state)
}

/// Show the existing browser window
#[tauri::command]
pub async fn show_browser_window(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    show_browser_window_body!(state)
}

/// Close all browser surfaces and reset state using unified deactivation
#[tauri::command]
pub async fn close_browser_window(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    close_browser_window_body!(state)
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
    execute_agent_task_body!(task, baseUrl, apiKey, model, systemPrompt, state)
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
    open_devtools_body!(state)
}

/// Get current browser window URL
#[tauri::command]
pub async fn get_browser_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    get_browser_url_body!(state)
}

/// Inject arbitrary JavaScript into the browser window
#[tauri::command]
pub async fn inject_script(
    script: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    inject_script_body!(script, state)
}

/// Check if browser window is busy
#[tauri::command]
pub async fn is_agent_busy(state: tauri::State<'_, Arc<Mutex<BrowserState>>>) -> AppResult<bool> {
    is_agent_busy_body!(state)
}

/// Navigate back in browser history
#[tauri::command]
pub async fn browser_go_back(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    browser_go_back_body!(state)
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
    inspect_browser_state_body!(app, state)
}

/// Navigate to a specific URL in the browser window
#[tauri::command]
pub async fn browser_navigate(
    url: String,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    browser_navigate_body!(url, state)
}

/// Reload the current page in the browser window
#[tauri::command]
pub async fn browser_reload(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    browser_reload_body!(state)
}

// ===== Embedded Webview Commands =====

/// Enable embedded mode - browser will render in embedded pane instead of separate window
#[tauri::command]
pub async fn set_embedded_mode(
    enabled: bool,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    set_embedded_mode_body!(enabled, state)
}

/// Get current embedded mode status
#[tauri::command]
pub async fn get_embedded_mode(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<bool> {
    get_embedded_mode_body!(state)
}

/// Capture screenshot from browser window (for embedded preview)
#[tauri::command]
pub async fn capture_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    capture_screenshot_body!(state)
}

/// Get browser window dimensions (for embedded layout)
#[tauri::command]
pub async fn get_browser_dimensions(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<(u32, u32)> {
    get_browser_dimensions_body!(state)
}
