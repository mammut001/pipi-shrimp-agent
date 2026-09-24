use super::{
    action_context, action_result, browser_click_with_ctx, browser_type_with_ctx,
    browser_wait_with_ctx, clone_manager_handle, BrowserController,
};
use crate::browser::actions::{
    self, ExtractContentInput, GetTextContentInput, PressKeyInput, ScrollInput,
};
use crate::browser::failure_snapshot::{
    get_failure_snapshot, list_failure_snapshots, BrowserFailureSnapshot,
};
use crate::browser::observability::BrowserObservabilitySnapshot;
use crate::browser::session::BrowserConnectionState;
use crate::commands::tools::resolve_execute_single_tool_session_id;
use crate::tools::{execution_policy, ToolExecutionSource};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

enum ChromeDebugLaunchOutcome {
    DebugPortReady,
    Launched,
}

async fn chrome_debug_port_ready() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get("http://127.0.0.1:9222/json/version")
        .send()
        .await
        .is_ok()
}

/// Builds Chrome/Chromium launch arguments for Linux environments.
/// In containerized/box desktop environments, Chrome remote debugging requires
/// --no-sandbox and --disable-dev-shm-usage to stay healthy and avoid shared memory crashes.
/// --remote-debugging-address=127.0.0.1 binds explicitly to localhost.
/// --enable-unsafe-swiftshader provides software rendering fallback when hardware GPU is unavailable.
#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
pub(super) fn linux_chrome_debug_args(debug_profile: &str) -> Vec<String> {
    vec![
        "--remote-debugging-port=9222".to_string(),
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--user-data-dir={}", debug_profile),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--no-sandbox".to_string(),
        "--disable-dev-shm-usage".to_string(),
        "--enable-unsafe-swiftshader".to_string(),
        "about:blank".to_string(),
    ]
}

async fn ensure_chrome_debug_process(timeout: Duration) -> Result<ChromeDebugLaunchOutcome, String> {
    if chrome_debug_port_ready().await {
        return Ok(ChromeDebugLaunchOutcome::DebugPortReady);
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/tmp".to_string());
        let debug_profile = format!("{}/Library/Application Support/PipiShrimp/ChromeDebugProfile", home);
        let chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_string(),
            "/Applications/Chromium.app/Contents/MacOS/Chromium".to_string(),
            format!("{}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", home),
            format!("{}/Applications/Chromium.app/Contents/MacOS/Chromium", home),
        ];

        let mut spawned = false;
        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", debug_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                        "about:blank",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                spawned = true;
                break;
            }
        }

        if !spawned {
            return Err("未找到 Chrome 或 Chromium，请确认已安装".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\User\\AppData\\Local".to_string());

        let chrome_paths = [
            format!(r"{}\Google\Chrome\Application\chrome.exe", program_files),
            format!(r"{}\Google\Chrome\Application\chrome.exe", program_files_x86),
            format!(r"{}\Google\Chrome\Application\chrome.exe", local_appdata),
            format!(r"{}\Chromium\Application\chrome.exe", program_files),
            format!(r"{}\Chromium\Application\chrome.exe", program_files_x86),
            format!(r"{}\Chromium\Application\chrome.exe", local_appdata),
        ];

        let debug_profile = format!("{}\\PipiShrimp\\ChromeDebugProfile", local_appdata);

        let mut spawned = false;
        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", debug_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                        "about:blank",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                spawned = true;
                break;
            }
        }

        if !spawned {
            return Err("未找到 Chrome 或 Chromium，请确认已安装。".to_string());
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/tmp".to_string());
        let debug_profile = format!("{}/.config/pipi-shrimp/chrome-debug-profile", home);

        let commands = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ];

        let args = linux_chrome_debug_args(&debug_profile);

        let mut spawned = false;
        for cmd in &commands {
            match std::process::Command::new(cmd)
                .args(&args)
                .spawn()
            {
                Ok(_) => {
                    spawned = true;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    continue;
                }
                Err(e) => {
                    return Err(format!("启动 {} 失败: {}", cmd, e));
                }
            }
        }

        if !spawned {
            return Err("未找到 Chrome/Chromium 浏览器，请确认已安装。".to_string());
        }
    }

    // After spawning Chrome, poll for the port to become ready (max 8s poll to prevent main loop latency)
    let start_time = std::time::Instant::now();
    let poll_timeout = std::time::Duration::from_secs(8).min(timeout);
    while !chrome_debug_port_ready().await {
        if start_time.elapsed() >= poll_timeout {
            return Err("启动 Chrome 成功，但调试端口未能就绪，连接超时。请确认未占用 9222 端口，或尝试手动启动。".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    Ok(ChromeDebugLaunchOutcome::Launched)
}

// ============= CDP Tier Commands =============

/// Click an element by either PageState index or backend_node_id.

pub(super) async fn browser_click(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_click_with_ctx(&ctx, element_id, backend_node_id, navigation_id).await
}

/// Click an element by its PageState index / semantic-tree id.

pub(super) async fn cdp_click(
    element_id: u64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    browser_click(Some(element_id), None, None, state).await
}

/// Type text into an element by either PageState index or backend_node_id.

pub(super) async fn browser_type(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_type_with_ctx(&ctx, element_id, backend_node_id, navigation_id, text).await
}

/// Type text into an element by its ID using CDP KeyEvents

pub(super) async fn cdp_type(
    element_id: u64,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    browser_type(Some(element_id), None, None, text, state).await
}

/// Scroll the page.

pub(super) async fn browser_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    let output = action_result(actions::scroll(&ctx, ScrollInput { direction, pixels }).await)?;

    Ok(format!("滚动: {} {}px", output.direction, output.pixels))
}

/// Scroll the page

pub(super) async fn cdp_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    browser_scroll(direction, pixels, state).await
}

pub(super) async fn browser_press_key(
    key: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    let output = action_result(actions::press_key(&ctx, PressKeyInput { key }).await)?;
    Ok(format!("已按下键 '{}'", output.key))
}

pub(super) async fn browser_wait(
    seconds: Option<u64>,
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_wait_with_ctx(&ctx, seconds, wait_selector).await
}

pub(super) async fn browser_get_text(
    max_length: Option<u64>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(
        actions::get_text_content(
            &ctx,
            GetTextContentInput {
                max_length: max_length.unwrap_or(3_000) as usize,
            },
        )
        .await,
    )
}


/// Launch Chrome with remote debugging enabled and connect through the shared session manager.

pub(super) async fn launch_chrome_debug(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;

    {
        let manager_guard = manager.lock().await;
        if manager_guard.has_connection() {
            return Ok("Chrome 已连接（复用现有连接）".to_string());
        }
    }

    let timeout = {
        let manager_guard = manager.lock().await;
        manager_guard.config().timeout
    };

    let launch_outcome = ensure_chrome_debug_process(timeout).await?;
    let mut manager_guard = manager.lock().await;
    let session = match launch_outcome {
        ChromeDebugLaunchOutcome::DebugPortReady => manager_guard.connect_attach().await,
        ChromeDebugLaunchOutcome::Launched => manager_guard.connect_launch().await,
    }
    .map_err(|e| e.to_string())?;
    manager_guard.start_background_workers(manager.clone());

    Ok(match launch_outcome {
        ChromeDebugLaunchOutcome::DebugPortReady => {
            format!(
                "Chrome 调试端口已就绪，已接管浏览器（模式: {}）",
                session.launch_mode.as_str()
            )
        }
        ChromeDebugLaunchOutcome::Launched => {
            format!(
                "Chrome 已启动并接管浏览器（模式: {}）",
                session.launch_mode.as_str()
            )
        }
    })
}

/// Re-sync page reference after navigation or new-tab opens.
/// Picks the LAST open page (most recently opened/navigated),
/// which is correct for GitHub-style "target=_blank" links.

pub(super) async fn resync_page(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;
    manager_guard
        .resync_page()
        .await
        .map_err(|e| e.to_string())?;
    Ok("页面已重新同步".to_string())
}

/// Disconnect browser - clears BrowserController state

pub(super) async fn disconnect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;
    manager_guard.disconnect().await;
    Ok("已断开 Chrome 连接".to_string())
}

pub(super) async fn get_browser_connection_state(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserConnectionState, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.connection_state())
}

pub(super) async fn get_browser_observability_snapshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserObservabilitySnapshot, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.observability_snapshot())
}

pub(super) async fn get_browser_failure(
    task_id: String,
) -> Result<Option<BrowserFailureSnapshot>, String> {
    get_failure_snapshot(&task_id)
}

pub(super) async fn list_browser_failures() -> Result<Vec<BrowserFailureSnapshot>, String> {
    list_failure_snapshots()
}

pub(super) async fn retry_browser_action(
    task_id: String,
    action: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserFailureSnapshot, String> {
    let snapshot = get_failure_snapshot(&task_id)?
        .ok_or_else(|| format!("Browser failure snapshot not found: {}", task_id))?;
    if snapshot.failed_action != action {
        return Err(format!(
            "Browser failure action mismatch: expected '{}' but received '{}'",
            snapshot.failed_action, action
        ));
    }

    let manager = clone_manager_handle(&state).await;
    manager.lock().await.note_manual_activity();
    Ok(snapshot)
}

pub(super) async fn take_over_browser(
    task_id: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserFailureSnapshot, String> {
    let snapshot = get_failure_snapshot(&task_id)?
        .ok_or_else(|| format!("Browser failure snapshot not found: {}", task_id))?;
    let manager = clone_manager_handle(&state).await;
    manager.lock().await.note_manual_activity();
    Ok(snapshot)
}

pub(super) async fn export_browser_benchmark_report(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.export_benchmark_markdown())
}

/// Execute arbitrary JavaScript in the current CDP page.
/// Used to inject/remove the agent scanning overlay.

pub(super) async fn cdp_execute_script(
    script: String,
    source: Option<ToolExecutionSource>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] toolCallId: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let source_value = source.unwrap_or(ToolExecutionSource::Unknown);
    let tool_call_id = toolCallId.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let session_id = match resolve_execute_single_tool_session_id(
        source_value,
        sessionId.as_deref(),
    ) {
        Ok(value) => value.map(str::to_string),
        Err(message) => return Err(message),
    };

    execution_policy::enforce_cdp_execute_script_policy(
        &tool_call_id,
        &script,
        source_value,
        session_id.as_deref(),
        approvalToken.as_deref(),
        executionMode.as_deref(),
        None,
    )
    .map_err(|error| {
        let message = error.to_string();
        if message.contains(&script) {
            "Browser script execution denied by policy.".to_string()
        } else {
            message
        }
    })?;

    let manager = clone_manager_handle(&state).await;
    let page = {
        let manager_guard = manager.lock().await;
        manager_guard.page_cloned().ok_or("CDP 未连接")?
    };
    let result = page
        .evaluate(script)
        .await
        .map(|v| {
            v.into_value::<serde_json::Value>()
                .ok()
                .map(|val| val.to_string())
                .unwrap_or_default()
        })
        .map_err(|e| e.to_string())?;

    let mut manager_guard = manager.lock().await;
    manager_guard.note_manual_activity();
    manager_guard.invalidate_page_state();
    Ok(result)
}

/// Capture a screenshot of the current CDP page as a base64-encoded PNG.
/// Returns the base64 string (without data:image/png;base64, prefix).

pub(super) async fn browser_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(actions::screenshot(&ctx).await).map(|screenshot| screenshot.value)
}

/// Capture a screenshot of the current CDP page as a base64-encoded PNG.
/// Returns the base64 string (without data:image/png;base64, prefix).

pub(super) async fn cdp_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    browser_screenshot(state).await
}

/// Extract structured text content from the current CDP page.
/// Returns readable content with headers, links, and key data.

pub(super) async fn browser_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(actions::extract_content(&ctx, ExtractContentInput).await)
}

/// Extract structured text content from the current CDP page.
/// Returns readable content with headers, links, and key data.

pub(super) async fn cdp_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    browser_extract_content(state).await
}
