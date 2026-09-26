//! Compile-time bodies for embedded browser surface commands.

use super::RawBrowserInspection;
use crate::services::browser::action_service::{build_page_agent_script, normalize_browser_url};
use crate::services::browser::inspection_service::EMBEDDED_SURFACE_INSPECTION_SCRIPT;
use crate::utils::AppError;
use tauri::{Listener, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl};

macro_rules! open_embedded_surface_body {
    ($url:ident, $app:ident, $state:ident) => {{
    println!("[Browser] Opening embedded surface for URL: {}", $url);

    // Validate URL
    if $url.is_empty() {
        return Err(AppError::InvalidInput("URL cannot be empty".to_string()));
    }

    let normalized_url = normalize_browser_url(&$url);

    let parsed_url = Url::parse(&normalized_url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    let mut $state = $state.lock().await;

    // Close any existing webviews to avoid conflicts
    $state.deactivate_all();

    // Get the main window
    let main_window = $app
        .get_window(&$state.main_window_label)
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

    $state.activate_embedded(webview);

    println!("[Browser] Embedded surface created successfully");
    Ok("Embedded surface opened".to_string())

    }};
}

macro_rules! move_browser_surface_body {
    ($target_mode:ident, $x:ident, $y:ident, $width:ident, $height:ident, $state:ident) => {{
    let (webview, browser_window) = {
        let mut $state = $state.lock().await;
        $state.embedded_mode = true;
        let webview = $state
            .embedded_webview
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No embedded browser surface open".to_string()))?
            .clone();
        let browser_window = $state.browser_window.clone();
        (webview, browser_window)
    };

    match $target_mode.as_str() {
        "mini" | "expanded" => {
            let ($x, $y, $width, $height) = ($x, $y, $width, $height);
            let ($x, $y, $width, $height) = match ($x, $y, $width, $height) {
                (Some($x), Some($y), Some($width), Some($height)) => {
                    ($x, $y, $width.max(1.0), $height.max(1.0))
                }
                _ => {
                    return Err(AppError::InvalidInput(
                        "Bounds are required when moving browser surface to mini or expanded mode"
                            .to_string(),
                    ));
                }
            };

            webview
                .set_position(LogicalPosition::new($x, $y))
                .map_err(|e| {
                    AppError::InternalError(format!("Failed to move browser surface: {}", e))
                })?;
            webview
                .set_size(LogicalSize::new($width, $height))
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
                $target_mode, $x, $y, $width, $height
            );
            Ok(format!(
                "Browser surface moved to {} at ({:.1}, {:.1}) size {:.1}x{:.1}",
                $target_mode, $x, $y, $width, $height
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

    }};
}

macro_rules! set_embedded_surface_visibility_body {
    ($visible:ident, $state:ident) => {{
    let (webview, surface_type) = {
        let $state = $state.lock().await;
        $state.get_target()?
    };

    if $visible {
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
        surface_type, $visible
    ))

    }};
}

macro_rules! get_embedded_surface_url_body {
    ($state:ident) => {{
    let (webview, surface_type) = {
        let $state = $state.lock().await;
        $state.get_target()?
    };

    let url = webview
        .url()
        .map_err(|e| AppError::InternalError(format!("Failed to get URL: {}", e)))?;

    println!(
        "[Browser] get_embedded_surface_url: surface={:?}, url={}",
        surface_type, url
    );
    Ok(url.to_string())

    }};
}

macro_rules! execute_on_embedded_surface_body {
    ($task:ident, $baseUrl:ident, $apiKey:ident, $model:ident, $systemPrompt:ident, $state:ident) => {{
    let page_agent_script = build_page_agent_script(&$task, $baseUrl, &$apiKey, &$model, $systemPrompt);

    let (webview, surface_type) = {
        let mut st = $state.lock().await;

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

    Ok(format!(
        "Task execution started on {:?} surface",
        surface_type
    ))

    }};
}

macro_rules! inspect_embedded_surface_body {
    ($app:ident, $state:ident) => {{
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::sync::oneshot;

    let (webview, surface_type) = {
        let st = $state.lock().await;
        st.get_target()?
    };

    println!("[Browser] Inspecting {:?} surface", surface_type);

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

    $app.unlisten(success_listener);
    $app.unlisten(error_listener);

    println!(
        "[Browser] Inspection result: {} - markers: {:?}",
        inspection.url, inspection.text_markers
    );
    Ok(inspection)

    }};
}

macro_rules! navigate_embedded_surface_body {
    ($url:ident, $state:ident) => {{
    let (webview, surface_type) = {
        let $state = $state.lock().await;
        $state.get_target()?
    };

    let normalized_url = normalize_browser_url(&$url);

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

    }};
}

macro_rules! reload_embedded_surface_body {
    ($state:ident) => {{
    let (webview, surface_type) = {
        let $state = $state.lock().await;
        $state.get_target()?
    };

    webview
        .eval("window.location.reload();")
        .map_err(|e| AppError::InternalError(format!("Failed to reload: {}", e)))?;

    println!("[Browser] {:?} surface reloaded", surface_type);
    Ok(format!("Page reloaded (via {:?})", surface_type))

    }};
}

macro_rules! close_embedded_surface_body {
    ($state:ident) => {{
    let mut $state = $state.lock().await;

    if let Some(webview) = $state.embedded_webview.take() {
        webview
            .close()
            .map_err(|e| AppError::InternalError(format!("Failed to close: {}", e)))?;
        println!("[Browser] Embedded surface closed");
    }

    $state.embedded_mode = false;
    if $state.active_surface == ActiveSurface::Embedded {
        $state.active_surface = ActiveSurface::None;
    }
    Ok("Embedded surface closed".to_string())

    }};
}
