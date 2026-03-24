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
use tauri::{Listener, WebviewWindow, WebviewWindowBuilder, WebviewUrl, Url};
use crate::utils::{AppError, AppResult};

/// Browser window state management
pub struct BrowserState {
    pub browser_window: Option<WebviewWindow>,
    pub is_busy: bool,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            browser_window: None,
            is_busy: false,
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
    .build()
    .map_err(|e| AppError::InternalError(format!("Failed to create browser window: {}", e)))?;

    state.browser_window = Some(window);

    println!("[Browser] Window created successfully");
    Ok("Browser window opened".to_string())
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

    let browser_window = {
        let mut state = state.lock().await;

        if state.is_busy {
            return Err(AppError::InvalidInput("Agent is already running".to_string()));
        }

        let window = state.browser_window.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone();

        state.is_busy = true;
        window
    };

    println!("[Browser] Executing agent task: {}", task);

    // Inject and execute the script in the browser window
    // Note: JavaScript in the browser window will emit events via window.__TAURI__.event.emit
    browser_window.eval(&page_agent_script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject script: {}", e)))?;

    // Mark as not busy immediately (the JS will handle completion events)
    {
        let mut state = state.lock().await;
        state.is_busy = false;
    }

    Ok("Task execution started".to_string())
}

/// Build the JavaScript code to inject into the browser window
/// This script loads the PageAgent SDK from CDN and executes the task
#[allow(non_snake_case)]
fn build_page_agent_script(
    task: &str,
    baseUrl: Option<String>,
    apiKey: &str,
    model: &str,
    systemPrompt: Option<String>,
) -> String {
    let base_url = baseUrl;
    let api_key = apiKey;
    let system_prompt = systemPrompt;
    let base_url_js = match base_url {
        Some(url) => format!("\"{}\"", url),
        None => "undefined".to_string(),
    };

    let system_prompt_js = match system_prompt {
        Some(prompt) => format!("\"{}\"", prompt.replace('"', "\\\"")),
        None => "undefined".to_string(),
    };

    // Escape the task string for JavaScript
    let escaped_task = task.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r");
    let escaped_api_key = api_key.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_model = model.replace('\\', "\\\\").replace('"', "\\\"");

    // PageAgent SDK CDN URLs (in order of preference)
    let sdk_urls = [
        "https://cdn.jsdelivr.net/npm/page-agent@latest/dist/page-agent.min.js",
        "https://unpkg.com/page-agent@latest/dist/page-agent.min.js",
    ];

    format!(r#"
(function() {{
    // Emit log event helper
    function emitLog(level, message) {{
        if (window.__TAURI__) {{
            window.__TAURI__.event.emit('agent_log', {{
                timestamp: new Date().toISOString(),
                message: message,
                level: level
            }});
        }}
        console.log('[PageAgent ' + level + ']', message);
    }}

    // Emit task complete event
    function emitComplete(success, result) {{
        if (window.__TAURI__) {{
            window.__TAURI__.event.emit('agent_task_complete', {{
                success: success,
                final_url: window.location.href,
                result: result
            }});
        }}
        emitLog(success ? 'success' : 'error', 'Task ' + (success ? 'completed' : 'failed') + ': ' + result);
    }}

    // SDK load URLs
    const SDK_URLS = {sdk_urls:?};

    // Load PageAgent SDK from CDN
    async function loadSDK(urls, index) {{
        if (index >= urls.length) {{
            throw new Error('Failed to load PageAgent SDK from all CDN sources');
        }}

        const url = urls[index];
        emitLog('info', 'Loading PageAgent SDK from: ' + url);

        return new Promise((resolve, reject) => {{
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {{
                emitLog('success', 'PageAgent SDK loaded from: ' + url);
                resolve();
            }};
            script.onerror = () => {{
                emitLog('error', 'Failed to load from: ' + url);
                // Try next URL
                loadSDK(urls, index + 1).then(resolve).catch(reject);
            }};
            document.head.appendChild(script);
        }});
    }}

    async function initAndExecute() {{
        try {{
            emitLog('info', 'Initializing PageAgent...');

            // Load SDK if not already loaded
            if (typeof PageAgent === 'undefined') {{
                await loadSDK(SDK_URLS, 0);
            }} else {{
                emitLog('info', 'PageAgent SDK already available');
            }}

            // Verify PageAgent is available
            if (typeof PageAgent === 'undefined') {{
                throw new Error('PageAgent not found after loading attempts');
            }}

            emitLog('info', 'Creating PageAgent instance...');

            const agent = new PageAgent({{
                baseURL: {base_url_js},
                apiKey: "{escaped_api_key}",
                model: "{escaped_model}",
                systemPrompt: {system_prompt_js}
            }});

            emitLog('info', 'PageAgent initialized, executing task...');
            emitLog('info', 'Task: {escaped_task}');

            // Execute the task
            agent.execute("{escaped_task}").then(result => {{
                emitLog('success', 'Task completed successfully');
                emitComplete(true, result);
            }}).catch(error => {{
                emitLog('error', 'Task execution error: ' + error.message);
                emitComplete(false, error.message);
            }});
        }} catch (error) {{
            emitLog('error', 'Initialization error: ' + error.message);
            emitComplete(false, error.message);
        }}
    }}

    // Start execution
    initAndExecute();
}})();
"#)
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
    let browser_window = {
        let state = state.lock().await;
        state.browser_window.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    // Use eval to call window.history.back()
    browser_window.eval("window.history.back();")
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

        const result = {
            url: url,
            title: title,
            has_password_input: hasPasswordInput,
            has_login_form: hasLoginForm,
            has_qr_auth: hasQrAuth,
            has_captcha: hasCaptcha,
            text_markers: uniqueTextMarkers,
            dom_markers: uniqueDomMarkers
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
    let browser_window = {
        let state = state.lock().await;
        state.browser_window.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
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
    browser_window.eval(&script)
        .map_err(|e| AppError::InternalError(format!("Failed to navigate: {}", e)))?;

    println!("[Browser] Navigating to: {}", normalized_url);
    Ok(format!("Navigated to: {}", normalized_url))
}

/// Reload the current page in the browser window
#[tauri::command]
pub async fn browser_reload(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> AppResult<String> {
    let browser_window = {
        let state = state.lock().await;
        state.browser_window.as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    browser_window.eval("window.location.reload();")
        .map_err(|e| AppError::InternalError(format!("Failed to reload: {}", e)))?;

    println!("[Browser] Page reloaded");
    Ok("Page reloaded".to_string())
}
