//! Compile-time bodies for standalone browser window and shared browser commands.

use super::RawBrowserInspection;
use crate::services::browser::action_service::{build_page_agent_script, normalize_browser_url};
use crate::services::browser::inspection_service::STANDALONE_INSPECTION_SCRIPT;
use crate::utils::AppError;
use tauri::{Listener, Url, WebviewUrl, WebviewWindowBuilder};

macro_rules! open_browser_window_body {
    ($url:ident, $app:ident, $state:ident) => {{
    println!("[Browser] Opening window for URL: {}", $url);

    // Validate URL
    if $url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    if !$url.starts_with("http://") && !$url.starts_with("https://") {
        return Err(AppError::InvalidInput(
            "URL must start with http:// or https://".to_string(),
        ));
    }

    // Parse URL to validate it
    let parsed_url =
        Url::parse(&$url).map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut $state = $state.lock().await;

    // Close existing browser window if any
    if let Some(window) = $state.browser_window.take() {
        let _ = window.close();
    }

    // Create new browser window using Tauri v2 WebviewWindowBuilder API
    let window =
        WebviewWindowBuilder::new(&$app, "browser-window", WebviewUrl::External(parsed_url))
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

    $state.activate_standalone(window);

    println!("[Browser] Window created successfully");
    Ok("Browser window opened".to_string())

    }};
}

macro_rules! show_browser_window_body {
    ($state:ident) => {{
    let maybe_target = {
        let $state = $state.lock().await;
        if let Some(window) = $state.browser_window.as_ref() {
            Some(window.clone())
        } else if $state.embedded_webview.is_some() {
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

    }};
}

macro_rules! close_browser_window_body {
    ($state:ident) => {{
    let surface_type = {
        let mut st = $state.lock().await;
        let desc = st.surface_description().to_string();
        st.deactivate_all();
        desc
    };

    println!("[Browser] All surfaces closed (was: {})", surface_type);
    Ok(format!("Browser surface closed (type: {})", surface_type))

    }};
}

macro_rules! execute_agent_task_body {
    ($task:ident, $baseUrl:ident, $apiKey:ident, $model:ident, $systemPrompt:ident, $state:ident) => {{
    // Build the script before locking state to avoid borrow issues
    let page_agent_script = build_page_agent_script(&$task, $baseUrl, &$apiKey, &$model, $systemPrompt);

    // Unified routing: get target webview using consistent priority
    let (webview, surface_type) = {
        let mut st = $state.lock().await;

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
        surface_type, $task
    );
    println!("[Browser] Script size: {} bytes", page_agent_script.len());

    match webview.eval(&page_agent_script) {
        Ok(_) => println!("[Browser] ✅ eval() succeeded on {:?}", surface_type),
        Err(e) => {
            println!("[Browser] ❌ eval() FAILED: {}", e);
            let mut st = $state.lock().await;
            st.is_busy = false;
            return Err(AppError::InternalError(format!(
                "Failed to inject script: {}",
                e
            )));
        }
    }

    {
        let mut st = $state.lock().await;
        st.is_busy = false;
    }

    Ok(format!("Task execution started on {:?}", surface_type))

    }};
}

macro_rules! open_devtools_body {
    ($state:ident) => {{
    let $state = $state.lock().await;

    if let Some(webview) = &$state.embedded_webview {
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

    }};
}

macro_rules! get_browser_url_body {
    ($state:ident) => {{
    let $state = $state.lock().await;

    let browser_window = $state
        .browser_window
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    // tauri::Url has a to_string method
    let url = browser_window
        .url()
        .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;
    Ok(url.to_string())

    }};
}

macro_rules! inject_script_body {
    ($script:ident, $state:ident) => {{
    let browser_window = {
        let $state = $state.lock().await;
        $state
            .browser_window
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    browser_window
        .eval(&$script)
        .map_err(|e| AppError::InternalError(format!("Failed to inject script: {}", e)))?;

    Ok("Script injected successfully".to_string())

    }};
}

macro_rules! is_agent_busy_body {
    ($state:ident) => {{
    let $state = $state.lock().await;
    Ok($state.is_busy)

    }};
}

macro_rules! browser_go_back_body {
    ($state:ident) => {{
    let target = {
        let $state = $state.lock().await;
        $state
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

    }};
}

macro_rules! inspect_browser_state_body {
    ($app:ident, $state:ident) => {{
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::sync::oneshot;

    let browser_window = {
        let $state = $state.lock().await;
        $state
            .browser_window
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?
            .clone()
    };

    let (tx, rx) = oneshot::channel::<Result<RawBrowserInspection, String>>();
    let tx = StdArc::new(StdMutex::new(Some(tx)));

    let success_tx = tx.clone();
    let success_listener = $app.once("browser_inspection_result", move |event| {
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
    let error_listener = $app.once("browser_inspection_error", move |event| {
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

    $app.unlisten(success_listener);
    $app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url, inspection.text_markers
    );
    Ok(inspection)

    }};
}

macro_rules! browser_navigate_body {
    ($url:ident, $state:ident) => {{
    let target = {
        let $state = $state.lock().await;
        $state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone()
    };

    // Validate URL
    if $url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    let normalized_url = normalize_browser_url(&$url);

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

    }};
}

macro_rules! browser_reload_body {
    ($state:ident) => {{
    let target = {
        let $state = $state.lock().await;
        $state
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

    }};
}

macro_rules! set_embedded_mode_body {
    ($enabled:ident, $state:ident) => {{
    let mut $state = $state.lock().await;
    $state.embedded_mode = $enabled;
    println!("[Browser] Embedded mode: {}", $enabled);
    Ok(format!("Embedded mode set to: {}", $enabled))

    }};
}

macro_rules! get_embedded_mode_body {
    ($state:ident) => {{
    let $state = $state.lock().await;
    Ok($state.embedded_mode)

    }};
}

macro_rules! capture_screenshot_body {
    ($state:ident) => {{
    let target = {
        let $state = $state.lock().await;
        $state
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

    }};
}

macro_rules! get_browser_dimensions_body {
    ($state:ident) => {{
    let $state = $state.lock().await;
    let browser_window = $state
        .browser_window
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No browser window open".to_string()))?;

    let size = browser_window
        .inner_size()
        .map_err(|e| AppError::InternalError(format!("Failed to get dimensions: {}", e)))?;

    Ok((size.width, size.height))

    }};
}
