/**
 * Browser commands for second WebviewWindow approach
 *
 * Opens a separate Tauri window to load target URLs, then injects
 * PageAgent JavaScript for real browser automation control.
 *
 * Uses Tauri v2 API (WebviewWindowBuilder)
 */

use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tauri::{
    Listener, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Url,
};
use serde::{Deserialize, Serialize};
use reqwest::Client as ReqwestClient;
use crate::utils::{AppError, AppResult};

/// Inline page-agent IIFE bundle — embedded at compile time so we never load from CDN.
/// Tauri's eval() is native-level injection that bypasses any page CSP (unlike <script src>).
const PAGE_AGENT_IIFE: &str = include_str!("../../../node_modules/page-agent/dist/iife/page-agent.demo.js");

/// Browser window state management
pub struct BrowserState {
    pub browser_window: Option<WebviewWindow>,
    pub embedded_webview: Option<Webview>,
    pub is_busy: bool,
    /// Embedded webview mode - when true, browser renders in embedded pane
    pub embedded_mode: bool,
    /// The main window label for embedding
    pub main_window_label: String,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            browser_window: None,
            embedded_webview: None,
            is_busy: false,
            embedded_mode: false,
            main_window_label: "main".to_string(),
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
            "URL must start with http:// or https://".to_string()
        ));
    }

    // Parse URL to validate it
    let parsed_url = Url::parse(&url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut state = state.lock().await;

    // Close existing browser window if any
    if let Some(window) = state.browser_window.take() {
        let _ = window.close();
    }

    // Create new browser window using Tauri v2 WebviewWindowBuilder API
    let window = WebviewWindowBuilder::new(
        &app,
        "browser-window",
        WebviewUrl::External(parsed_url),
    )
    .title("Browser Agent")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .center()
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| AppError::InternalError(format!("Failed to create browser window: {}", e)))?;

    state.browser_window = Some(window);

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

    let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        format!("https://{}", url)
    };

    let parsed_url = Url::parse(&normalized_url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut state = state.lock().await;

    // Close any existing webviews to avoid conflicts
    if let Some(window) = state.browser_window.take() {
        let _ = window.close();
    }
    if let Some(webview) = state.embedded_webview.take() {
        let _ = webview.close();
    }

    // Get the main window
    let main_window = app.get_window(&state.main_window_label)
        .ok_or_else(|| AppError::InternalError("Main window not found".to_string()))?;

    let webview_builder = WebviewBuilder::new("embedded-browser-surface", WebviewUrl::External(parsed_url));
    let webview = main_window
        .add_child(
            webview_builder,
            LogicalPosition::new(100.0, 100.0),
            LogicalSize::new(800.0, 600.0),
        )
        .map_err(|e| AppError::InternalError(format!("Failed to create embedded surface: {}", e)))?;

    webview
        .hide()
        .map_err(|e| AppError::InternalError(format!("Failed to hide embedded surface initially: {}", e)))?;

    state.embedded_webview = Some(webview);
    state.embedded_mode = true;

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
        let webview = state.embedded_webview.as_ref()
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
                        "Bounds are required when moving browser surface to mini or expanded mode".to_string(),
                    ));
                }
            };

            webview
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| AppError::InternalError(format!("Failed to move browser surface: {}", e)))?;
            webview
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| AppError::InternalError(format!("Failed to resize browser surface: {}", e)))?;
            webview
                .show()
                .map_err(|e| AppError::InternalError(format!("Failed to show browser surface: {}", e)))?;

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
            webview
                .hide()
                .map_err(|e| AppError::InternalError(format!("Failed to hide browser surface: {}", e)))?;
            println!("[Browser] Browser surface hidden");
            Ok("Browser surface hidden".to_string())
        }
        _ => Err(AppError::InvalidInput("Invalid mode. Use 'mini', 'expanded', or 'hidden'".to_string()))
    }
}

/// Show or hide the embedded browser surface without closing the underlying session.
#[tauri::command]
pub async fn set_embedded_surface_visibility(
    visible: bool,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let webview = {
        let state = state.lock().await;
        state.embedded_webview.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    if visible {
        webview
            .show()
            .map_err(|e| AppError::InternalError(format!("Failed to show browser surface: {}", e)))?;
    } else {
        webview
            .hide()
            .map_err(|e| AppError::InternalError(format!("Failed to hide browser surface: {}", e)))?;
    }

    Ok(format!("Embedded surface visibility set to {}", visible))
}

/// Get the current embedded surface URL - checks both embedded webview and browser window
#[tauri::command]
pub async fn get_embedded_surface_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let state = state.lock().await;

    // Try embedded webview first
    if let Some(webview) = &state.embedded_webview {
        let url = webview.url()
            .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;
        return Ok(url.to_string());
    }

    // Fall back to browser window
    if let Some(window) = &state.browser_window {
        let url = window.url()
            .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;
        return Ok(url.to_string());
    }

    Err(AppError::InvalidInput("No browser surface open".to_string()))
}

/// Execute task on the embedded surface.
#[tauri::command]
pub async fn execute_on_embedded_surface(
    task: String,
    #[allow(non_snake_case)]
    baseUrl: Option<String>,
    #[allow(non_snake_case)]
    apiKey: String,
    model: String,
    #[allow(non_snake_case)]
    systemPrompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let page_agent_script = build_page_agent_script(&task, baseUrl, &apiKey, &model, systemPrompt);

    let target = {
        let mut state = state.lock().await;

        if state.is_busy {
            return Err(AppError::InvalidInput("Agent is already running".to_string()));
        }

        let webview = state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone();
        state.is_busy = true;
        webview
    };

    println!("[Browser] Executing on embedded surface: {}", task);
    println!("[Browser] Script size: {} bytes", page_agent_script.len());
    match target.eval(&page_agent_script) {
        Ok(_) => println!("[Browser] ✅ eval() succeeded"),
        Err(e) => {
            println!("[Browser] ❌ eval() FAILED: {}", e);
            return Err(AppError::InternalError(format!("Failed to inject script: {}", e)));
        }
    }

    {
        let mut state = state.lock().await;
        state.is_busy = false;
    }

    Ok("Task execution started on embedded surface".to_string())
}

/// Inspect browser state on the embedded surface.
#[tauri::command]
pub async fn inspect_embedded_surface(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<RawBrowserInspection> {
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::sync::oneshot;

    let target = {
        let state = state.lock().await;
        state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
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
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
            .unwrap_or_else(|| format!("Browser inspection failed: {}", payload));

        if let Ok(mut sender) = error_tx.lock() {
            if let Some(tx) = sender.take() {
                let _ = tx.send(Err(message));
            }
        }
    });

    // Same inspection script as before
    let inspection_script = r#"
(function() {
    try {
        const url = window.location.href;
        const title = document.title;
        const hasPasswordInput = document.querySelectorAll('input[type="password"]').length > 0;
        const hasLoginForm = document.querySelectorAll('form[action*="login"], form[action*="signin"], form[action*="auth"]').length > 0;
        const hasQrAuth = !!(
            document.querySelector('[data-testid="qr-code"]') ||
            document.querySelector('img[alt*="QR"]') ||
            document.querySelector('img[src*="qr"]') ||
            document.body.innerText.toLowerCase().includes('scan qr')
        );
        const hasCaptcha = !!(
            document.querySelector('[class*="captcha"]') ||
            document.querySelector('[id*="captcha"]') ||
            document.body.innerText.toLowerCase().includes('captcha') ||
            document.body.innerText.toLowerCase().includes('verify you\'re human') ||
            document.body.innerText.toLowerCase().includes('i\'m not a robot')
        );

        const bodyText = document.body.innerText;
        const textMarkers = [];
        const authTexts = [
            'sign in', 'sign in to', 'log in', 'log in to', 'login',
            'password', 'username', 'email', 'authentication',
            'two-factor', '2fa', 'verification code', 'security code',
            'dashboard', 'my apps', 'account', 'profile', 'settings',
            'chats', 'messages', 'contacts', 'whatsapp', 'telegram',
        ];

        for (const text of authTexts) {
            if (bodyText.toLowerCase().includes(text)) {
                textMarkers.push(text);
            }
        }

        const domMarkers = [];
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        for (const input of passwordInputs) {
            domMarkers.push('input[type="password"]');
            if (input.id) domMarkers.push('input#' + input.id);
            if (input.name) domMarkers.push('input[name="' + input.name + '"]');
        }

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (form.action && (form.action.includes('login') || form.action.includes('signin'))) {
                domMarkers.push('form[action*="login"]');
            }
        }

        const uniqueTextMarkers = [...new Set(textMarkers)];
        const uniqueDomMarkers = [...new Set(domMarkers)];

        // Detect if login UI is inside a modal/overlay (optional sign-in, content still accessible)
        const modalSelectors = [
            'dialog',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[class*="modal"]',
            '[class*="overlay"]',
            '[class*="popup"]',
            '[class*="drawer"]',
            '[class*="sheet"]',
        ];
        let hasLoginModal = false;
        const loginKeywords = ['sign in', 'log in', 'login', 'sign up', 'create account'];
        for (const sel of modalSelectors) {
            try {
                const modals = document.querySelectorAll(sel);
                for (const modal of modals) {
                    const mt = (modal.innerText || '').toLowerCase();
                    if (loginKeywords.some(kw => mt.includes(kw))) {
                        hasLoginModal = true;
                        break;
                    }
                }
            } catch(e) {}
            if (hasLoginModal) break;
        }

        // Count words in body (high count = real content accessible behind any login prompt)
        const contentWordCount = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;

        const result = {
            url: url,
            title: title,
            has_password_input: hasPasswordInput,
            has_login_form: hasLoginForm,
            has_qr_auth: hasQrAuth,
            has_captcha: hasCaptcha,
            text_markers: uniqueTextMarkers,
            dom_markers: uniqueDomMarkers,
            has_login_modal: hasLoginModal,
            content_word_count: contentWordCount,
        };

        window.__inspection_result = JSON.stringify(result);

        function emitInspectionResult(payload) {
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                    event: 'browser_inspection_result',
                    windowLabel: null,
                    payload: payload
                }).catch(function() {});
                return;
            }
            console.warn('[Browser] No Tauri IPC available for inspection result');
        }

        emitInspectionResult(result);
        console.log('[Browser] Inspection complete:', result.url);
    } catch (e) {
        console.error('Inspection error:', e);
        function emitInspectionError(msg) {
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                    event: 'browser_inspection_error',
                    windowLabel: null,
                    payload: { message: msg }
                }).catch(function() {});
            }
        }
        emitInspectionError(e.message || String(e));
    }
})();
"#;

    target.eval(inspection_script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject inspection script: {}", e)))?;

    let inspection = tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| AppError::InternalError("Timed out waiting for browser inspection result".to_string()))?
        .map_err(|_| AppError::InternalError("Browser inspection channel closed unexpectedly".to_string()))?
        .map_err(AppError::InternalError)?;

    app.unlisten(success_listener);
    app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url,
        inspection.text_markers
    );
    Ok(inspection)
}

/// Navigate embedded surface to a URL
#[tauri::command]
pub async fn navigate_embedded_surface(
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

    let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        format!("https://{}", url)
    };

    let script = format!("window.location.href = '{}';", normalized_url.replace('\'', "\\'"));
    target.eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to navigate: {}", e)))?;

    println!("[Browser] Navigating embedded surface to: {}", normalized_url);
    Ok(format!("Navigated to: {}", normalized_url))
}

/// Reload the embedded surface
#[tauri::command]
pub async fn reload_embedded_surface(
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

    target.eval("window.location.reload();")
        .map_err(|e| AppError::InternalError(format!("Failed to reload: {}", e)))?;

    println!("[Browser] Embedded surface reloaded");
    Ok("Page reloaded".to_string())
}

/// Close the embedded surface
#[tauri::command]
pub async fn close_embedded_surface(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let mut state = state.lock().await;

    if let Some(webview) = state.embedded_webview.take() {
        webview.close().map_err(|e| AppError::InternalError(format!("Failed to close: {}", e)))?;
        println!("[Browser] Embedded surface closed");
    }

    state.embedded_mode = false;
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
            return Err(AppError::InvalidInput("No browser surface open".to_string()));
        }
    };

    if let Some(browser_window) = maybe_target {
        browser_window
            .show()
            .map_err(|e| AppError::InternalError(format!("Failed to show browser window: {}", e)))?;
        browser_window
            .set_focus()
            .map_err(|e| AppError::InternalError(format!("Failed to focus browser window: {}", e)))?;
        Ok("Browser window shown".to_string())
    } else {
        Ok("Embedded browser surface is already visible in-app".to_string())
    }
}

/// Close the browser window
#[tauri::command]
pub async fn close_browser_window(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let mut state = state.lock().await;

    if let Some(window) = state.browser_window.take() {
        window.close().map_err(|e| AppError::InternalError(format!("Failed to close window: {}", e)))?;
        println!("[Browser] Window closed");
    }

    Ok("Browser window closed".to_string())
}

/// Execute PageAgent task in the browser window
#[tauri::command]
pub async fn execute_agent_task(
    task: String,
    #[allow(non_snake_case)]
    baseUrl: Option<String>,
    #[allow(non_snake_case)]
    apiKey: String,
    model: String,
    #[allow(non_snake_case)]
    systemPrompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    // Build the script before locking state to avoid borrow issues
    let page_agent_script = build_page_agent_script(&task, baseUrl, &apiKey, &model, systemPrompt);

    // Determine target surface: external browser window OR embedded surface
    // We avoid holding a long-lived borrow across await by selecting target upfront.
    // First, try external browser window
    {
        let mut st = state.lock().await;
        if st.is_busy {
            return Err(AppError::InvalidInput("Agent is already running".to_string()));
        }
        if let Some(window_clone) = st.browser_window.clone() {
            // Set busy atomically before releasing lock (prevents race condition)
            st.is_busy = true;
            drop(st);
            println!("[Browser] Executing agent task on external browser window: {}", task);
            if let Err(e) = window_clone.eval(&page_agent_script) {
                println!("[Browser] ❌ eval() FAILED on external window: {}", e);
                let mut st2 = state.lock().await;
                st2.is_busy = false;
                return Err(AppError::InternalError(format!("Failed to inject script: {}", e)));
            }
            // Reset busy after script injection (agent runs async; frontend status guards re-entry)
            let mut st2 = state.lock().await;
            st2.is_busy = false;
            return Ok("Task execution started".to_string());
        }
    }

    // Next, try embedded surface
    {
        let mut st = state.lock().await;
        if st.is_busy {
            return Err(AppError::InvalidInput("Agent is already running".to_string()));
        }
        if let Some(webview_clone) = st.embedded_webview.clone() {
            // Set busy atomically before releasing lock (prevents race condition)
            st.is_busy = true;
            drop(st);
            println!("[Browser] Executing agent task on embedded surface: {}", task);
            println!("[Browser] Script size: {} bytes", page_agent_script.len());
            match webview_clone.eval(&page_agent_script) {
                Ok(_) => println!("[Browser] ✅ eval() succeeded on embedded surface"),
                Err(e) => {
                    println!("[Browser] ❌ eval() FAILED: {}", e);
                    let mut st2 = state.lock().await;
                    st2.is_busy = false;
                    return Err(AppError::InternalError(format!("Failed to inject script: {}", e)));
                }
            }
            // Reset busy after script injection (agent runs async; frontend status guards re-entry)
            let mut st2 = state.lock().await;
            st2.is_busy = false;
            return Ok("Task execution started".to_string());
        }
    }

    // If neither surface is available
    Err(AppError::InvalidInput("No browser surface open".to_string()))
}

/// Build the JavaScript code to inject into the browser window.
/// Inlines the page-agent IIFE bundle so it bypasses CSP (Tauri eval is native-level).
#[allow(non_snake_case)]
fn build_page_agent_script(
    task: &str,
    baseUrl: Option<String>,
    apiKey: &str,
    model: &str,
    systemPrompt: Option<String>,
) -> String {
    let base_url_js = match baseUrl {
        Some(url) => format!("\"{}\"", url),
        None => "undefined".to_string(),
    };

    let system_prompt_js = match systemPrompt {
        Some(prompt) => format!("\"{}\"", prompt
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")),
        None => "undefined".to_string(),
    };

    let escaped_task = task.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r");
    let escaped_api_key = apiKey.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_model = model.replace('\\', "\\\\").replace('"', "\\\"");

    // The IIFE bundle sets window.PageAgent when it runs.
    // We suppress its demo auto-start by temporarily replacing setTimeout.
    // We also override fetch() to proxy LLM API calls through Tauri backend (bypass CSP connect-src).
    format!(r#"
(function() {{
    console.log('[PageAgent] Script injected. __TAURI_INTERNALS__ exists:', !!window.__TAURI_INTERNALS__);
    // --- Override fetch to proxy LLM API calls (bypass CSP connect-src) ---
    var __origFetch = window.fetch;
    var LLM_API_PATTERNS = [
        'api.openai.com',
        'api.anthropic.com',
        'api-biz.alibaba.com',
        'api.minimaxi.com',      // MiniMax (Chinese LLM)
        'page-ag-testing',
        'api.minimax.chat',
        'localhost',
        '127.0.0.1',
        ':8000', ':8080', ':3000', ':5000'  // Local dev servers
    ];

    function shouldProxy(url) {{
        var urlStr = String(url).toLowerCase();

        // Check whitelist patterns
        var matchesPattern = LLM_API_PATTERNS.some(function(pattern) {{
            return urlStr.indexOf(pattern) !== -1;
        }});

        if (matchesPattern) return true;

        // Also proxy if URL matches the configured baseURL
        var baseUrl = {base_url_js};
        if (baseUrl && baseUrl !== 'undefined') {{
            var baseUrlStr = String(baseUrl).toLowerCase();
            if (urlStr.startsWith(baseUrlStr)) return true;
        }}

        return false;
    }}

    // Convert headers to plain object (handles both Headers instance and plain object)
    function toPlainHeaders(h) {{
        var obj = {{}};
        if (!h) return obj;
        if (typeof h.forEach === 'function') {{
            h.forEach(function(v, k) {{ obj[k] = v; }});
        }} else if (typeof h === 'object') {{
            for (var k in h) {{ if (Object.prototype.hasOwnProperty.call(h, k)) obj[k] = h[k]; }}
        }}
        return obj;
    }}

    window.fetch = async function(url, options) {{
        // Don't proxy non-LLM requests
        if (!shouldProxy(url)) {{
            return __origFetch.apply(this, arguments);
        }}

        try {{
            var method = (options && options.method) || 'POST';
            var headers = toPlainHeaders(options && options.headers);
            var body = options && options.body;

            // Convert body to string if needed
            if (body && typeof body !== 'string') {{
                body = JSON.stringify(body);
            }}

            console.log('[FetchProxy] Intercepted:', String(url).substring(0, 80));
            console.log('[FetchProxy] __TAURI_INTERNALS__:', !!window.__TAURI_INTERNALS__);

            // Use Tauri IPC proxy to bypass CSP connect-src restrictions.
            // NOTE: proxy_http_request takes a named `request` parameter (struct).
            // JS must wrap args under the param name: {{ request: {{ url, method, ... }} }}
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                try {{
                    console.log('[FetchProxy] Calling proxy_http_request via IPC...');
                    var result = await window.__TAURI_INTERNALS__.invoke('proxy_http_request', {{
                        request: {{
                            url: String(url),
                            method: method,
                            headers: headers,
                            body: body || null
                        }}
                    }});
                    console.log('[FetchProxy] IPC success, status:', result && result.status);

                    return new Response(result.body, {{
                        status: result.status,
                        statusText: result.status_text || 'OK',
                        headers: new Headers(result.headers || {{}})
                    }});
                }} catch(tauri_error) {{
                    var errMsg = tauri_error && (tauri_error.message || String(tauri_error));
                    console.warn('[FetchProxy] Tauri IPC failed:', errMsg);
                    // Surface error to action logs so it's visible in the UI
                    try {{
                        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                            window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                                event: 'agent_log',
                                windowLabel: null,
                                payload: {{ timestamp: Date.now(), message: '[FetchProxy] IPC error: ' + errMsg, level: 'error' }}
                            }}).catch(function(){{}});
                        }}
                    }} catch(e) {{}}
                }}
            }}

            // Last resort: try original fetch (will likely fail due to CSP on external pages)
            console.warn('[FetchProxy] Falling back to native fetch (may fail due to CSP)');
            return __origFetch.apply(this, [url, options]);
        }} catch (error) {{
            console.error('[FetchProxy] All methods failed:', error && error.message);
            return __origFetch.apply(this, [url, options]);
        }}
    }};

    // --- Suppress demo auto-start from the IIFE bundle ---
    var __origSetTimeout = window.setTimeout;
    window.setTimeout = function() {{ return 0; }};

    // --- Inline page-agent IIFE (bypasses page CSP via Tauri eval) ---
    {iife}

    // Restore setTimeout
    window.setTimeout = __origSetTimeout;

    // --- Helpers ---
    function emitLog(level, message) {{
        console.log('[PageAgent ' + level + ']', message);
        try {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'agent_log',
                    windowLabel: null,
                    payload: {{ timestamp: new Date().toISOString(), message: message, level: level }}
                }}).catch(function(){{}});
            }}
        }} catch(e) {{}}
    }}

    function emitComplete(success, result) {{
        emitLog(success ? 'success' : 'error', 'Task ' + (success ? 'completed' : 'failed') + ': ' + result);
        try {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                    event: 'agent_task_complete',
                    windowLabel: null,
                    payload: {{ success: success, final_url: window.location.href, result: result }}
                }}).catch(function(){{}});
            }}
        }} catch(e) {{}}
    }}

    // --- Execute ---
    (async function() {{
        try {{
            emitLog('info', 'Initializing PageAgent...');

            if (typeof window.PageAgent === 'undefined') {{
                throw new Error('PageAgent not available after inline injection');
            }}

            emitLog('info', 'Creating PageAgent instance...');
            const agent = new window.PageAgent({{
                baseURL: {base_url_js},
                apiKey: "{escaped_api_key}",
                model: "{escaped_model}",
                systemPrompt: {system_prompt_js}
            }});

            emitLog('info', 'Executing task: {escaped_task}');
            const result = await agent.execute("{escaped_task}");
            // Extract a clean text summary — PageAgent may return a raw API response object
            // (with tool schemas, choices arrays, etc.) which is too noisy to send to the AI.
            let resultText;
            if (typeof result === 'string') {{
                resultText = result;
            }} else if (result && typeof result === 'object') {{
                // Try common text fields first
                resultText = result.text || result.message || result.content ||
                             result.summary || result.output || result.answer || result.result;
                if (!resultText) {{
                    // If choices array (OpenAI/MiniMax format), extract content
                    if (Array.isArray(result.choices) && result.choices[0] && result.choices[0].message) {{
                        resultText = result.choices[0].message.content || result.choices[0].message.text;
                    }}
                }}
                if (!resultText) {{
                    // Last resort: JSON, but truncate to avoid sending huge schemas
                    const raw = JSON.stringify(result);
                    resultText = raw.length > 2000 ? raw.substring(0, 2000) + '...' : raw;
                }}
            }} else {{
                resultText = String(result);
            }}
            emitLog('success', 'Task completed: ' + String(resultText).substring(0, 200));
            emitComplete(true, String(resultText));
        }} catch (error) {{
            emitLog('error', 'Error: ' + (error && error.message ? error.message : String(error)));
            emitComplete(false, error && error.message ? error.message : String(error));
        }}
    }})();
}})();
"#,
        iife = PAGE_AGENT_IIFE,
    )
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

/// Strip <think>...</think> blocks from LLM response bodies.
/// Reasoning models (Claude, DeepSeek-R1, MiniMax thinking mode) embed large internal
/// reasoning traces in responses. PageAgent stores the full response in conversation history,
/// so these traces accumulate quickly and make subsequent request bodies too large for Tauri IPC.
fn strip_thinking_content(body: String) -> String {
    let mut result = body;
    loop {
        match (result.find("<think>"), result.find("</think>")) {
            (Some(start), Some(end_tag_pos)) if end_tag_pos >= start => {
                let end = end_tag_pos + "</think>".len();
                result = format!("{}{}", &result[..start], &result[end..]);
            }
            _ => break,
        }
    }
    result
}

/// Proxy HTTP requests through the backend (bypasses page CSP connect-src).
/// Needed because fetch() from within a CSP-restricted page is blocked for external APIs,
/// but Tauri backend requests are not subject to page CSP.
#[tauri::command]
pub async fn proxy_http_request(
    request: HttpProxyRequest,
) -> AppResult<HttpProxyResponse> {
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
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(val_str) = value.to_str() {
            headers.insert(key.to_string(), val_str.to_string());
        }
    }

    // Read response body and strip thinking traces to keep IPC payload small
    let raw_body = response
        .text()
        .await
        .unwrap_or_else(|_| String::new());

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
pub async fn open_devtools(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<()> {
    let state = state.lock().await;

    if let Some(webview) = &state.embedded_webview {
        #[cfg(debug_assertions)]
        {
            webview.open_devtools();
            return Ok(());
        }
        #[cfg(not(debug_assertions))]
        {
            return Err(AppError::InvalidInput("DevTools only available in debug mode".to_string()));
        }
    }

    Err(AppError::InvalidInput("No embedded webview open".to_string()))
}

/// Get current browser window URL
#[tauri::command]
pub async fn get_browser_url(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let state = state.lock().await;

    let browser_window = state.browser_window.as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    // tauri::Url has a to_string method
    let url = browser_window.url()
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
        state.browser_window.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    browser_window.eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject script: {}", e)))?;

    Ok("Script injected successfully".to_string())
}

/// Check if browser window is busy
#[tauri::command]
pub async fn is_agent_busy(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<bool> {
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
    target.eval("window.history.back();")
        .map_err(|e| AppError::InternalError(format!("Failed to go back: {}", e)))?;

    Ok("Navigated back".to_string())
}

/// Raw inspection data returned from browser
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RawBrowserInspection {
    pub url: String,
    pub title: String,
    pub has_password_input: bool,
    pub has_login_form: bool,
    pub has_qr_auth: bool,
    pub has_captcha: bool,
    pub text_markers: Vec<String>,
    pub dom_markers: Vec<String>,
    #[serde(default)]
    pub has_login_modal: bool,
    #[serde(default)]
    pub content_word_count: u32,
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
        state.browser_window.as_ref()
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
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
            .unwrap_or_else(|| format!("Browser inspection failed: {}", payload));

        if let Ok(mut sender) = error_tx.lock() {
            if let Some(tx) = sender.take() {
                let _ = tx.send(Err(message));
            }
        }
    });

    // Inject JavaScript that computes the inspection and stores it globally
    let inspection_script = r#"
(function() {
    try {
        // Get basic info
        const url = window.location.href;
        const title = document.title;

        // Check for password inputs
        const hasPasswordInput = document.querySelectorAll('input[type="password"]').length > 0;

        // Check for login forms
        const hasLoginForm = document.querySelectorAll('form[action*="login"], form[action*="signin"], form[action*="auth"]').length > 0;

        // Check for QR code (common patterns)
        const hasQrAuth = !!(
            document.querySelector('[data-testid="qr-code"]') ||
            document.querySelector('img[alt*="QR"]') ||
            document.querySelector('img[src*="qr"]') ||
            document.body.innerText.toLowerCase().includes('scan qr')
        );

        // Check for captcha
        const hasCaptcha = !!(
            document.querySelector('[class*="captcha"]') ||
            document.querySelector('[id*="captcha"]') ||
            document.body.innerText.toLowerCase().includes('captcha') ||
            document.body.innerText.toLowerCase().includes('verify you\'re human') ||
            document.body.innerText.toLowerCase().includes('i\'m not a robot')
        );

        // Collect text markers
        const bodyText = document.body.innerText;
        const textMarkers = [];
        const authTexts = [
            'sign in', 'sign in to', 'log in', 'log in to', 'login',
            'password', 'username', 'email', 'authentication',
            'two-factor', '2fa', 'verification code', 'security code',
            'dashboard', 'my apps', 'account', 'profile', 'settings',
            'chats', 'messages', 'contacts', 'whatsapp', 'telegram',
        ];

        for (const text of authTexts) {
            if (bodyText.toLowerCase().includes(text)) {
                textMarkers.push(text);
            }
        }

        // Collect DOM markers
        const domMarkers = [];
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        for (const input of passwordInputs) {
            domMarkers.push('input[type="password"]');
            if (input.id) domMarkers.push('input#' + input.id);
            if (input.name) domMarkers.push('input[name="' + input.name + '"]');
        }

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (form.action && (form.action.includes('login') || form.action.includes('signin'))) {
                domMarkers.push('form[action*="login"]');
            }
        }

        const uniqueTextMarkers = [...new Set(textMarkers)];
        const uniqueDomMarkers = [...new Set(domMarkers)];

        // Detect if login UI is inside a modal/overlay (optional sign-in, content still accessible)
        const modalSelectors2 = [
            'dialog',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[class*="modal"]',
            '[class*="overlay"]',
            '[class*="popup"]',
            '[class*="drawer"]',
            '[class*="sheet"]',
        ];
        let hasLoginModal2 = false;
        const loginKeywords2 = ['sign in', 'log in', 'login', 'sign up', 'create account'];
        for (const sel of modalSelectors2) {
            try {
                const modals = document.querySelectorAll(sel);
                for (const modal of modals) {
                    const mt = (modal.innerText || '').toLowerCase();
                    if (loginKeywords2.some(kw => mt.includes(kw))) {
                        hasLoginModal2 = true;
                        break;
                    }
                }
            } catch(e) {}
            if (hasLoginModal2) break;
        }
        const contentWordCount2 = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;

        const result = {
            url: url,
            title: title,
            has_password_input: hasPasswordInput,
            has_login_form: hasLoginForm,
            has_qr_auth: hasQrAuth,
            has_captcha: hasCaptcha,
            text_markers: uniqueTextMarkers,
            dom_markers: uniqueDomMarkers,
            has_login_modal: hasLoginModal2,
            content_word_count: contentWordCount2,
        };

        // Store in global for Rust to read via second eval
        window.__inspection_result = JSON.stringify(result);

        // Emit event with result to Rust (for async listeners)
        if (window.__TAURI__) {
            window.__TAURI__.event.emit('browser_inspection_result', result);
        }

        console.log('[Browser] Inspection complete:', result.url);
    } catch (e) {
        console.error('Inspection error:', e);
        if (window.__TAURI__) {
            window.__TAURI__.event.emit('browser_inspection_error', { message: e.message });
        }
    }
})();
"#;

    // Inject the inspection script
    browser_window.eval(inspection_script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject inspection script: {}", e)))?;

    let inspection = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| AppError::InternalError("Timed out waiting for browser inspection result".to_string()))?
        .map_err(|_| AppError::InternalError("Browser inspection channel closed unexpectedly".to_string()))?
        .map_err(AppError::InternalError)?;

    app.unlisten(success_listener);
    app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url,
        inspection.text_markers
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

    let normalized_url = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        format!("https://{}", url)
    };

    // Use eval to navigate
    let script = format!("window.location.href = '{}';", normalized_url.replace('\'', "\\'"));
    target.eval(&script)
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

    target.eval("window.location.reload();")
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

    target.eval(script)
        .map_err(|e| AppError::InternalError(format!("Failed to capture screenshot: {}", e)))?;

    Ok("Screenshot capture initiated".to_string())
}

/// Get browser window dimensions (for embedded layout)
#[tauri::command]
pub async fn get_browser_dimensions(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<(u32, u32)> {
    let state = state.lock().await;
    let browser_window = state.browser_window.as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    let size = browser_window.inner_size()
        .map_err(|e| AppError::InternalError(format!("Failed to get dimensions: {}", e)))?;

    Ok((size.width, size.height))
}
