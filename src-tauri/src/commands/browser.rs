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
use tauri::{WebviewWindow, WebviewWindowBuilder, WebviewUrl, Url};
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
