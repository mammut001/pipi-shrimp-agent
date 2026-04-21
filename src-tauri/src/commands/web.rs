/**
 * Web automation commands
 *
 * Handles web automation and browser control
 * (Placeholder for future Page-Agent integration)
 */

use crate::browser::actions::{
    self, ActionContext, ClickInput, ElementReference, ExtractContentInput,
    GetTextContentInput, NavigateInput, PressKeyInput, ScrollInput, TypeTextInput, WaitInput,
};
use crate::browser::dom::PageState;
use crate::browser::observability::BrowserObservabilitySnapshot;
use crate::browser::session::{BrowserConnectionState, BrowserSessionManager};
use crate::utils::AppResult;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct BrowserController {
    pub manager: Arc<Mutex<BrowserSessionManager>>,
}

enum ChromeDebugLaunchOutcome {
    DebugPortReady,
    Launched,
}

impl Default for BrowserController {
    fn default() -> Self {
        Self {
            manager: Arc::new(Mutex::new(BrowserSessionManager::default())),
        }
    }
}

async fn clone_manager_handle(
    state: &tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Arc<Mutex<BrowserSessionManager>> {
    state.lock().await.manager.clone()
}

async fn action_context(
    state: &tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> ActionContext {
    ActionContext::new(clone_manager_handle(state).await)
}

fn action_result<T>(result: actions::ActionResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

async fn navigate_and_wait_with_ctx(
    ctx: &ActionContext,
    url: String,
    wait_selector: Option<String>,
) -> Result<String, String> {
    action_result(
        actions::navigate(
            ctx,
            NavigateInput {
                url: Some(url),
                wait_selector,
                timeout_ms: None,
            },
        )
        .await,
    )?;

    Ok("页面加载并渲染完全".to_string())
}

async fn browser_wait_with_ctx(
    ctx: &ActionContext,
    seconds: Option<u64>,
    wait_selector: Option<String>,
) -> Result<String, String> {
    let output = action_result(
        actions::wait(
            ctx,
            WaitInput {
                seconds,
                wait_selector,
                timeout_ms: None,
            },
        )
        .await,
    )?;

    if output.selector_matched {
        Ok(format!("等待完成，目标选择器已出现（{}ms）", output.waited_ms))
    } else {
        Ok(format!("已等待 {} 秒", output.waited_ms / 1_000))
    }
}

async fn browser_click_with_ctx(
    ctx: &ActionContext,
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
) -> Result<String, String> {
    let output = action_result(
        actions::click(
            ctx,
            ClickInput {
                target: ElementReference {
                    index: element_id,
                    backend_node_id,
                    navigation_id,
                },
            },
        )
        .await,
    )?;

    Ok(format!(
        "点击成功: backend_node_id {}{}",
        output.backend_node_id,
        output
            .tag_name
            .as_ref()
            .map(|tag| format!(" <{}>", tag))
            .unwrap_or_default()
    ))
}

async fn browser_type_with_ctx(
    ctx: &ActionContext,
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    text: String,
) -> Result<String, String> {
    let output = action_result(
        actions::type_text(
            ctx,
            TypeTextInput {
                target: ElementReference {
                    index: element_id,
                    backend_node_id,
                    navigation_id,
                },
                text,
            },
        )
        .await,
    )?;

    Ok(format!(
        "输入成功: backend_node_id {}，共 {} 个字符",
        output.backend_node_id, output.text_len
    ))
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
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;

    if manager_guard.has_connection() {
        return Ok("浏览器已连接（复用现有连接）".to_string());
    }

    let session = manager_guard.connect_attach().await.map_err(|e| e.to_string())?;
    manager_guard.start_background_workers(manager.clone());
    Ok(format!("成功接管浏览器！模式: {}", session.launch_mode.as_str()))
}

// 高级功能：智能等待导航
#[tauri::command]
pub async fn navigate_and_wait(
    url: String, 
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
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
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
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

    serde_json::to_string(&legacy_elements)
        .map_err(|e| format!("序列化语义树失败: {}", e))
}

/**
 * Open a URL in the default browser
 */
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<String> {
    open::that(&url)
        .map_err(|e| format!("Failed to open URL: {}", e))?;

    Ok(format!("Opened URL: {}", url))
}

// ============= CDP Tier Commands =============

/// Click an element by either PageState index or backend_node_id.
#[tauri::command]
pub async fn browser_click(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_click_with_ctx(&ctx, element_id, backend_node_id, navigation_id).await
}

/// Click an element by its PageState index / semantic-tree id.
#[tauri::command]
pub async fn cdp_click(
    element_id: u64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    browser_click(Some(element_id), None, None, state).await
}

/// Type text into an element by either PageState index or backend_node_id.
#[tauri::command]
pub async fn browser_type(
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_type_with_ctx(&ctx, element_id, backend_node_id, navigation_id, text).await
}

/// Type text into an element by its ID using CDP KeyEvents
#[tauri::command]
pub async fn cdp_type(
    element_id: u64,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    browser_type(Some(element_id), None, None, text, state).await
}

/// Scroll the page.
#[tauri::command]
pub async fn browser_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    let output = action_result(
        actions::scroll(
            &ctx,
            ScrollInput {
                direction,
                pixels,
            },
        )
        .await,
    )?;

    Ok(format!("滚动: {} {}px", output.direction, output.pixels))
}

/// Scroll the page
#[tauri::command]
pub async fn cdp_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    browser_scroll(direction, pixels, state).await
}

#[tauri::command]
pub async fn browser_press_key(
    key: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    let output = action_result(actions::press_key(&ctx, PressKeyInput { key }).await)?;
    Ok(format!("已按下键 '{}'", output.key))
}

#[tauri::command]
pub async fn browser_wait(
    seconds: Option<u64>,
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    browser_wait_with_ctx(&ctx, seconds, wait_selector).await
}

#[tauri::command]
pub async fn browser_get_text(
    max_length: Option<u64>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
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

// ============= CDP Connector UI Commands =============

async fn chrome_debug_port_ready() -> bool {
    reqwest::get("http://127.0.0.1:9222/json/version").await.is_ok()
}

async fn ensure_chrome_debug_process() -> Result<ChromeDebugLaunchOutcome, String> {
    #[cfg(target_os = "macos")]
    {
        if chrome_debug_port_ready().await {
            return Ok(ChromeDebugLaunchOutcome::DebugPortReady);
        }

        let chrome_running = std::process::Command::new("pgrep")
            .args(["-x", "Google Chrome"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if chrome_running {
            return Err("CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口。请退出 Chrome 后重新点击「连接 Chrome」，软件会自动以调试模式启动它。".to_string());
        }

        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let real_profile = format!("{}/Library/Application Support/Google/Chrome", home);
        let chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];

        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", real_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                return Ok(ChromeDebugLaunchOutcome::Launched);
            }
        }

        Err("未找到 Chrome 或 Chromium，请确认已安装在 /Applications 目录下".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        if chrome_debug_port_ready().await {
            return Ok(ChromeDebugLaunchOutcome::DebugPortReady);
        }

        let chrome_running = std::process::Command::new("tasklist")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("chrome.exe"))
            .unwrap_or(false);

        if chrome_running {
            return Err("CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口。请退出 Chrome 后重新点击「连接 Chrome」。".to_string());
        }

        let appdata = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| "C:\\Users\\User\\AppData\\Local".to_string());
        let real_profile = format!("{}\\Google\\Chrome\\User Data", appdata);
        let chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ];

        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", real_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                return Ok(ChromeDebugLaunchOutcome::Launched);
            }
        }

        Err("未找到 Chrome 安装路径".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if chrome_debug_port_ready().await {
            return Ok(ChromeDebugLaunchOutcome::DebugPortReady);
        }

        let chrome_running = std::process::Command::new("pgrep")
            .args(["-x", "google-chrome"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if chrome_running {
            return Err("CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口。请退出 Chrome 后重新点击「连接 Chrome」。".to_string());
        }

        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let real_profile = format!("{}/.config/google-chrome", home);

        std::process::Command::new("google-chrome")
            .args([
                "--remote-debugging-port=9222",
                &format!("--user-data-dir={}", real_profile),
                "--no-first-run",
                "--no-default-browser-check",
            ])
            .spawn()
            .map_err(|e| format!("启动 Chrome 失败: {}", e))?;

        Ok(ChromeDebugLaunchOutcome::Launched)
    }
}

/// Launch Chrome with remote debugging enabled and connect through the shared session manager.
#[tauri::command]
pub async fn launch_chrome_debug(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;

    {
        let manager_guard = manager.lock().await;
        if manager_guard.has_connection() {
            return Ok("Chrome 已连接（复用现有连接）".to_string());
        }
    }

    let launch_outcome = ensure_chrome_debug_process().await?;
    let mut manager_guard = manager.lock().await;
    let session = match launch_outcome {
        ChromeDebugLaunchOutcome::DebugPortReady => manager_guard.connect_attach().await,
        ChromeDebugLaunchOutcome::Launched => manager_guard.connect_launch().await,
    }
    .map_err(|e| e.to_string())?;
    manager_guard.start_background_workers(manager.clone());

    Ok(match launch_outcome {
        ChromeDebugLaunchOutcome::DebugPortReady => {
            format!("Chrome 调试端口已就绪，已接管浏览器（模式: {}）", session.launch_mode.as_str())
        }
        ChromeDebugLaunchOutcome::Launched => {
            format!("Chrome 已启动并接管浏览器（模式: {}）", session.launch_mode.as_str())
        }
    })
}

/// Re-sync page reference after navigation or new-tab opens.
/// Picks the LAST open page (most recently opened/navigated),
/// which is correct for GitHub-style "target=_blank" links.
#[tauri::command]
pub async fn resync_page(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;
    manager_guard.resync_page().await.map_err(|e| e.to_string())?;
    Ok("页面已重新同步".to_string())
}

/// Disconnect browser - clears BrowserController state
#[tauri::command]
pub async fn disconnect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let mut manager_guard = manager.lock().await;
    manager_guard.disconnect().await;
    Ok("已断开 Chrome 连接".to_string())
}

#[tauri::command]
pub async fn get_browser_connection_state(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<BrowserConnectionState, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.connection_state())
}

#[tauri::command]
pub async fn get_browser_observability_snapshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<BrowserObservabilitySnapshot, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.observability_snapshot())
}

#[tauri::command]
pub async fn export_browser_benchmark_report(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let manager_guard = manager.lock().await;
    Ok(manager_guard.export_benchmark_markdown())
}

/// Execute arbitrary JavaScript in the current CDP page.
/// Used to inject/remove the agent scanning overlay.
#[tauri::command]
pub async fn cdp_execute_script(
    script: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let manager = clone_manager_handle(&state).await;
    let page = {
        let manager_guard = manager.lock().await;
        manager_guard.page_cloned().ok_or("CDP 未连接")?
    };
    let result = page.evaluate(script)
        .await
        .map(|v| v.into_value::<serde_json::Value>().ok()
            .map(|val| val.to_string())
            .unwrap_or_default())
        .map_err(|e| e.to_string())?;

    let mut manager_guard = manager.lock().await;
    manager_guard.note_manual_activity();
    manager_guard.invalidate_page_state();
    Ok(result)
}

/// Capture a screenshot of the current CDP page as a base64-encoded PNG.
/// Returns the base64 string (without data:image/png;base64, prefix).
#[tauri::command]
pub async fn browser_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(actions::screenshot(&ctx).await).map(|screenshot| screenshot.value)
}

/// Capture a screenshot of the current CDP page as a base64-encoded PNG.
/// Returns the base64 string (without data:image/png;base64, prefix).
#[tauri::command]
pub async fn cdp_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    browser_screenshot(state).await
}

/// Extract structured text content from the current CDP page.
/// Returns readable content with headers, links, and key data.
#[tauri::command]
pub async fn browser_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let ctx = action_context(&state).await;
    action_result(actions::extract_content(&ctx, ExtractContentInput).await)
}

/// Extract structured text content from the current CDP page.
/// Returns readable content with headers, links, and key data.
#[tauri::command]
pub async fn cdp_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    browser_extract_content(state).await
}

// ============= Web Search & Fetch Commands =============

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResult {
    pub url: String,
    pub content: String,
    pub content_type: String,
    pub bytes: usize,
}

/**
 * Web search using DuckDuckGo Lite
 *
 * Free, no API key required. Returns results with titles and snippets.
 * Uses the lite endpoint which has a stable, simpler HTML structure.
 */
#[tauri::command]
pub async fn web_search(
    query: String,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(&query);
    let search_url = format!("https://lite.duckduckgo.com/lite/?q={}", encoded_query);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let html = response.text().await.map_err(|e| e.to_string())?;

    // DuckDuckGo Lite uses <a class="result-link"> for result URLs/titles
    // and <td class="result-snippet"> for snippets.
    let result_pattern = regex::Regex::new(r#"(?i)<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#)
        .map_err(|e| format!("Regex error: {}", e))?;
    let snippet_pattern = regex::Regex::new(r#"(?i)<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)</td>"#)
        .map_err(|e| format!("Regex error: {}", e))?;

    let strip_tags = regex::Regex::new(r"<[^>]+>").map_err(|e| format!("Regex error: {}", e))?;

    let mut results = Vec::new();
    let snippets: Vec<String> = snippet_pattern.captures_iter(&html)
        .map(|c| {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
            strip_tags.replace_all(raw, "").trim().to_string()
        })
        .collect();

    for (i, cap) in result_pattern.captures_iter(&html).enumerate() {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let raw_title = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let title = strip_tags.replace_all(raw_title, "").trim().to_string();

        if url.is_empty() || title.is_empty() {
            continue;
        }

        let snippet = snippets.get(i).cloned().unwrap_or_default();

        // Filter by domain if specified
        let passes_filter = match (&allowed_domains, &blocked_domains) {
            (Some(allowed), _) if !allowed.is_empty() => {
                allowed.iter().any(|d| url.contains(d.as_str()))
            },
            (_, Some(blocked)) => {
                !blocked.iter().any(|d| url.contains(d.as_str()))
            },
            _ => true,
        };

        if passes_filter {
            results.push(SearchResult {
                title,
                url,
                snippet,
            });
        }

        if results.len() >= 20 {
            break;
        }
    }

    Ok(results)
}

/**
 * Fetch a URL and return its content
 *
 * Uses the browser if connected, otherwise uses HTTP client
 *
 * Note: The `prompt` parameter is reserved for future LLM-based content extraction.
 * Currently all text content is returned. Set maxContentLength in ToolSettings to limit.
 */
#[tauri::command]
pub async fn web_fetch(
    url: String,
    _prompt: String,  // Reserved for future LLM extraction
) -> Result<FetchResult, String> {
    // If browser is connected, use it for better rendering
    // For now, use HTTP client as fallback

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch request failed: {}", e))?;

    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html")
        .to_string();

    let bytes = response.content_length().unwrap_or(0) as usize;

    let body = response.text().await.map_err(|e| e.to_string())?;

    // If HTML, simplify the content (remove scripts, styles, etc.)
    // Note: LLM-based content extraction based on prompt is reserved for future
    let content = if content_type.contains("text/html") {
        extract_relevant_content(&body)
    } else {
        body
    };

    Ok(FetchResult {
        url,
        content,
        content_type,
        bytes,
    })
}

/**
 * Extract relevant content from HTML
 *
 * Removes scripts, styles, and extracts readable text.
 */
fn extract_relevant_content(html: &str) -> String {
    // Simple extraction: remove scripts, styles, and get text
    let mut result = String::new();
    let mut in_script = false;
    let mut in_style = false;
    let mut in_tag = false;
    let mut current_text = String::new();

    let chars: Vec<char> = html.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        if i + 6 < len {
            let tag: String = chars[i..i+7].iter().collect();
            let tag_lower = tag.to_lowercase();
            if tag_lower.starts_with("<script") || tag_lower == "<script" {
                in_script = true;
            } else if tag_lower.starts_with("<style") || tag_lower == "<style" {
                in_style = true;
            } else if tag_lower.starts_with("</scri") {
                in_script = false;
            } else if tag_lower.starts_with("</sty") {
                in_style = false;
            }
        }

        if c == '<' && !in_script && !in_style {
            in_tag = true;
            if !current_text.is_empty() {
                let trimmed = current_text.trim();
                if !trimmed.is_empty() {
                    result.push_str(trimmed);
                    result.push('\n');
                }
                current_text.clear();
            }
        } else if c == '>' && !in_script && !in_style {
            in_tag = false;
        } else if !in_tag && !in_script && !in_style {
            current_text.push(c);
        }

        i += 1;
    }

    // Clean up whitespace
    let cleaned: String = result
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(50000)  // Limit to 50k chars
        .collect();

    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::actions;
    use crate::browser::actions::test_support::{CheckoutFlowServer, LiveActionHarness};
    use crate::browser::dom::{InteractiveElement, PageState};
    use anyhow::Result;

    fn find_live_element<F>(
        page_state: &PageState,
        label: &str,
        predicate: F,
    ) -> Result<InteractiveElement>
    where
        F: Fn(&InteractiveElement) -> bool,
    {
        let element_debug = serde_json::to_string_pretty(&page_state.elements)
            .unwrap_or_else(|_| format!("{:?}", page_state.elements));

        page_state
            .elements
            .iter()
            .find(|element| predicate(element))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("expected {} in live page state; elements={}", label, element_debug))
    }

    async fn read_payment_status_text(harness: &LiveActionHarness) -> Result<String> {
        harness
            .page()
            .evaluate(
                "(function() { const node = document.querySelector('#payment-status'); return node ? node.textContent : ''; })()",
            )
            .await
            .map_err(anyhow::Error::from)?
            .into_value::<String>()
            .map_err(anyhow::Error::from)
    }

    async fn read_selector_text(harness: &LiveActionHarness, selector: &str) -> Result<String> {
        let script = format!(
            "(function() {{ const node = document.querySelector({selector:?}); return node ? node.textContent : ''; }})()",
        );
        harness
            .page()
            .evaluate(script)
            .await
            .map_err(anyhow::Error::from)?
            .into_value::<String>()
            .map_err(anyhow::Error::from)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn navigate_and_wait_and_browser_wait_wrappers_support_selector_flows() -> Result<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let wrapper_result = async {
            let navigate_message = navigate_and_wait_with_ctx(
                harness.ctx(),
                server.checkout_url(),
                Some("#page-ready.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(navigate_message, "页面加载并渲染完全");

            let wait_message = browser_wait_with_ctx(
                harness.ctx(),
                None,
                Some("#late-ready.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));
            assert!(wait_message.ends_with("ms）"));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        wrapper_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn browser_click_and_browser_type_wrappers_support_shadow_dom_targets() -> Result<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let wrapper_result = async {
            let navigate_message = navigate_and_wait_with_ctx(
                harness.ctx(),
                server.shadow_checkout_url(),
                Some("#page-ready.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(navigate_message, "页面加载并渲染完全");

            let page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            let navigation_id = page_state.navigation_id.clone();
            let shadow_input = find_live_element(&page_state, "shadow iframe input", |element| {
                element.frame_id != "root"
                    && element.is_editable
                    && element.selector_hint.as_deref() == Some("#shadow-card-number")
            })?;
            let shadow_button = find_live_element(&page_state, "shadow iframe button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.tag_name.as_deref() == Some("button")
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

            let typed_value = "1010 2020 3030 4040".to_string();
            let type_message = browser_type_with_ctx(
                harness.ctx(),
                Some(shadow_input.index as u64),
                Some(shadow_input.backend_node_id),
                Some(navigation_id.clone()),
                typed_value.clone(),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(
                type_message,
                format!(
                    "输入成功: backend_node_id {}，共 {} 个字符",
                    shadow_input.backend_node_id,
                    typed_value.chars().count()
                )
            );

            let click_message = browser_click_with_ctx(
                harness.ctx(),
                Some(shadow_button.index as u64),
                Some(shadow_button.backend_node_id),
                Some(navigation_id),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(
                click_message,
                format!("点击成功: backend_node_id {} <BUTTON>", shadow_button.backend_node_id)
            );

            let wait_message = browser_wait_with_ctx(
                harness.ctx(),
                None,
                Some("#payment-status.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));

            let status_text = read_payment_status_text(&harness).await?;
            assert!(status_text.contains("confirmed:"));
            assert!(status_text.contains("1010"));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        wrapper_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn browser_wrappers_preserve_root_actions_when_cross_frame_partial_warning_exists() -> Result<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch_site_isolated().await?;

        let wrapper_result = async {
            let navigate_message = navigate_and_wait_with_ctx(
                harness.ctx(),
                server.partial_warning_checkout_url(),
                Some("#frame-ready.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(navigate_message, "页面加载并渲染完全");

            let page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            assert!(page_state
                .warnings
                .contains(&"cross_origin_iframe_partial".to_string()));
            assert!(!page_state
                .warnings
                .contains(&"closed_shadow_root_partial".to_string()));

            let root_button = find_live_element(&page_state, "partial warning root button", |element| {
                element.is_clickable
                    && element.selector_hint.as_deref() == Some("#warning-root-action")
            })?;

            let click_message = browser_click_with_ctx(
                harness.ctx(),
                Some(root_button.index as u64),
                Some(root_button.backend_node_id),
                Some(page_state.navigation_id.clone()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert_eq!(
                click_message,
                format!("点击成功: backend_node_id {} <BUTTON>", root_button.backend_node_id)
            );

            let wait_message = browser_wait_with_ctx(
                harness.ctx(),
                None,
                Some("#warning-status.ready".to_string()),
            )
            .await
            .map_err(anyhow::Error::msg)?;
            assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));

            let status_text = read_selector_text(&harness, "#warning-status").await?;
            assert_eq!(status_text, "support-opened");

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        wrapper_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }
}
