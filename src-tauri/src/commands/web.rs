/**
 * Web automation commands
 *
 * Handles web automation and browser control
 * (Placeholder for future Page-Agent integration)
 */
use crate::browser::actions;
use crate::browser::dom::{
    capture_light_observation, capture_screenshot_with_options, LightObservation, PageState,
    ScreenshotArtifact, ScreenshotOptions,
};
use crate::browser::failure_snapshot::BrowserFailureSnapshot;
use crate::browser::observability::BrowserObservabilitySnapshot;
use crate::browser::session::{BrowserConnectionState, BrowserSessionManager};
use crate::tools::ToolExecutionSource;
use crate::utils::AppResult;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

mod action_helpers;
mod cdp;
mod search;
use action_helpers::{
    action_context, action_result, browser_click_with_ctx, browser_type_with_ctx,
    browser_wait_with_ctx, clone_manager_handle, navigate_and_wait_with_ctx,
};
pub use search::{FetchResult, SearchResult};

pub struct BrowserController {
    pub manager: Arc<Mutex<BrowserSessionManager>>,
}

impl Default for BrowserController {
    fn default() -> Self {
        Self {
            manager: Arc::new(Mutex::new(BrowserSessionManager::default())),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct LegacySemanticElement {
    id: u32,
    tag: String,
    role: String,
    text: String,
    #[serde(rename = "ariaLabel")]
    aria_label: String,
    href: String,
}

// 核心命令：开启并接管用户的本地 Chrome
#[tauri::command]
pub async fn connect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;

    if manager_guard.has_connection() {
        return Ok("浏览器已连接（复用现有连接）".to_string());
    }

    let session = manager_guard
        .connect_attach()
        .await
        .map_err(|e| e.to_string())?;
    manager_guard.start_background_workers(manager.clone());
    Ok(format!(
        "成功接管浏览器！模式: {}",
        session.launch_mode.as_str()
    ))
}

// 高级功能：智能等待导航
#[tauri::command]
pub async fn navigate_and_wait(
    url: String,
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    navigate_and_wait_with_ctx(&ctx, url, wait_selector).await
}

#[tauri::command]
pub async fn get_page_state(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<PageState, String> {
    let ctx = action_context(&state).await;
    action_result(actions::get_page_state(&ctx).await)
}

/// Cheap observation: URL, title, readyState, navigation id, a short text
/// excerpt and the active element description. Avoids DOMSnapshot + AX so the
/// agent loop can poll it every step without paying the full PageState cost.
#[tauri::command]
pub async fn get_page_observation_light(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<LightObservation, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    let page = manager_guard
        .page_cloned()
        .ok_or("CDP 未连接")?;
    capture_light_observation(&page, Duration::from_secs(5))
        .await
        .map_err(|error| error.to_string())
}

/// Capture a screenshot with explicit options (format, quality, max_width).
/// Default behaviour matches the live-preview UI (JPEG, q=70, max_width=960,
/// not full-page) so the frontend can poll this command on a slow cadence
/// without bloating Zustand state.
#[tauri::command]
pub async fn browser_screenshot_options(
    options: Option<ScreenshotOptions>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<ScreenshotArtifact, String> {
    let manager = clone_manager_handle(&state).await;
    let page = {
        let manager_guard = manager.lock().await;
        manager_guard.page_cloned().ok_or("CDP 未连接")?
    };
    let opts = options.unwrap_or_else(ScreenshotOptions::preview_default);
    let processed = capture_screenshot_with_options(&page, Duration::from_secs(15), opts)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ScreenshotArtifact::from_processed(opts.format, &processed))
}

#[tauri::command]
pub async fn get_page_state_text(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(actions::get_page_state_text(&ctx).await)
}

// 兼容层：保留旧 Semantic Tree 结构，内部转发到 PageState。
#[tauri::command]
pub async fn get_semantic_tree(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    let page_state = get_page_state(state).await?;
    let legacy_elements: Vec<LegacySemanticElement> = page_state
        .elements
        .into_iter()
        .map(|element| {
            let text = if !element.name.trim().is_empty() {
                element.name.clone()
            } else {
                element.text_hint.clone().unwrap_or_default()
            };

            LegacySemanticElement {
                id: element.index,
                tag: element.tag_name.unwrap_or_else(|| element.role.clone()),
                role: element.role,
                aria_label: element.name,
                text,
                href: element.href.unwrap_or_default(),
            }
        })
        .collect();

    serde_json::to_string(&legacy_elements).map_err(|e| format!("序列化语义树失败: {}", e))
}

/**
 * Open a URL in the default browser
 */
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))?;

    Ok(format!("Opened URL: {}", url))
}

#[tauri::command]
pub async fn browser_click(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_click(element_id, backend_node_id, navigation_id, state).await
}

#[tauri::command]
pub async fn cdp_click(
    element_id: u64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_click(element_id, state).await
}

#[tauri::command]
pub async fn browser_type(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_type(element_id, backend_node_id, navigation_id, text, state).await
}

#[tauri::command]
pub async fn cdp_type(
    element_id: u64,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_type(element_id, text, state).await
}

#[tauri::command]
pub async fn browser_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_scroll(direction, pixels, state).await
}

#[tauri::command]
pub async fn cdp_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_scroll(direction, pixels, state).await
}

#[tauri::command]
pub async fn browser_press_key(
    key: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_press_key(key, state).await
}

#[tauri::command]
pub async fn browser_wait(
    seconds: Option<u64>,
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_wait(seconds, wait_selector, state).await
}

#[tauri::command]
pub async fn browser_get_text(
    max_length: Option<u64>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_get_text(max_length, state).await
}

// ============= CDP Connector UI Commands =============

#[tauri::command]
pub async fn launch_chrome_debug(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::launch_chrome_debug(state).await
}

#[tauri::command]
pub async fn resync_page(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::resync_page(state).await
}

#[tauri::command]
pub async fn disconnect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::disconnect_browser(state).await
}

#[tauri::command]
pub async fn get_browser_connection_state(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserConnectionState, String> {
    cdp::get_browser_connection_state(state).await
}

#[tauri::command]
pub async fn get_browser_observability_snapshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserObservabilitySnapshot, String> {
    cdp::get_browser_observability_snapshot(state).await
}

#[tauri::command]
pub async fn get_browser_failure(
    task_id: String,
) -> Result<Option<BrowserFailureSnapshot>, String> {
    cdp::get_browser_failure(task_id).await
}

#[tauri::command]
pub async fn list_browser_failures() -> Result<Vec<BrowserFailureSnapshot>, String> {
    cdp::list_browser_failures().await
}

#[tauri::command]
pub async fn retry_browser_action(
    task_id: String,
    action: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserFailureSnapshot, String> {
    cdp::retry_browser_action(task_id, action, state).await
}

#[tauri::command]
pub async fn take_over_browser(
    task_id: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<BrowserFailureSnapshot, String> {
    cdp::take_over_browser(task_id, state).await
}

#[tauri::command]
pub async fn export_browser_benchmark_report(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::export_browser_benchmark_report(state).await
}

#[tauri::command]
pub async fn cdp_execute_script(
    script: String,
    source: Option<ToolExecutionSource>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] toolCallId: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_execute_script(script, source, sessionId, approvalToken, executionMode, toolCallId, state).await
}

#[tauri::command]
pub async fn browser_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_screenshot(state).await
}

#[tauri::command]
pub async fn cdp_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_screenshot(state).await
}

#[tauri::command]
pub async fn browser_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::browser_extract_content(state).await
}

#[tauri::command]
pub async fn cdp_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Result<String, String> {
    cdp::cdp_extract_content(state).await
}

// ============= Web Search & Fetch Commands =============

#[tauri::command]
pub async fn web_search(
    query: String,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, String> {
    search::web_search(query, allowed_domains, blocked_domains).await
}

#[tauri::command]
pub async fn web_fetch(
    url: String,
    _prompt: String, // Reserved for future LLM extraction
) -> Result<FetchResult, String> {
    search::web_fetch(url, _prompt).await
}

#[cfg(test)]
mod tests;
