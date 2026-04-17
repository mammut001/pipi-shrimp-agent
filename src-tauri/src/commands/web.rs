/**
 * Web automation commands
 *
 * Handles web automation and browser control
 * (Placeholder for future Page-Agent integration)
 */

use crate::utils::AppResult;
use serde::{Deserialize, Serialize};

use chromiumoxide::browser::Browser;
use chromiumoxide::page::Page;
use tokio::sync::Mutex;
use futures::StreamExt;
use std::sync::Arc;

pub struct BrowserController {
    pub page: Option<Page>,
    pub browser: Option<Browser>,
    pub browser_handle: Option<tokio::task::JoinHandle<()>>,
}

impl Default for BrowserController {
    fn default() -> Self {
        Self { page: None, browser: None, browser_handle: None }
    }
}

// 核心命令：开启并接管用户的本地 Chrome
#[tauri::command]
pub async fn connect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    // If already connected, reuse existing connection — don't create a second WebSocket
    {
        let st = state.lock().await;
        if st.browser.is_some() && st.page.is_some() {
            return Ok("浏览器已连接（复用现有连接）".to_string());
        }
    }

    // 首先我们要去获取 websocket 的 debugger URL
    let resp = reqwest::get("http://127.0.0.1:9222/json/version")
        .await
        .map_err(|e| format!("无法访问 Chrome 调试端点 (请确保开启了 --remote-debugging-port=9222): {}", e))?;
        
    let json: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("无法解析 Chrome 调试数据: {}", e))?;
        
    let ws_url = json["webSocketDebuggerUrl"]
        .as_str()
        .ok_or_else(|| "未从 Chrome 返回数据中找到 webSocketDebuggerUrl 的字段".to_string())?;

    // 连接本地浏览器
    let (browser, mut handler) = Browser::connect(ws_url)
        .await
        .map_err(|e| format!("无法连接本地浏览器 WebSocket: {}", e))?;

    // 在后台运行事件循环
    // IMPORTANT: do NOT break on errors — navigation events (frameDetached, etc.)
    // can yield Err but should not kill the entire session.
    let handle = tokio::spawn(async move {
        while let Some(_) = handler.next().await {}
    });

    // Prefer reusing the first existing page (already has session/cookies) rather
    // than opening a fresh about:blank tab which would lose all logged-in state.
    let page = {
        let existing = browser.pages().await.ok().and_then(|pages| {
            pages.into_iter().find(|_| true) // first page
        });
        match existing {
            Some(p) => p,
            None => browser.new_page("about:blank").await.map_err(|e| e.to_string())?,
        }
    };

    let mut st = state.lock().await;
    // Abort old handler if any
    if let Some(old_handle) = st.browser_handle.take() {
        old_handle.abort();
    }
    st.page = Some(page);
    st.browser = Some(browser);   // KEEP browser alive — dropping it kills the CDP connection
    st.browser_handle = Some(handle);

    Ok("成功接管浏览器！".to_string())
}

// 高级功能：智能等待导航
#[tauri::command]
pub async fn navigate_and_wait(
    url: String, 
    wait_selector: Option<String>,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接")?
    };

    // 1. 发起导航
    page.goto(&url).await.map_err(|e| e.to_string())?;

    // 2. 模拟等待网络空闲
    page.wait_for_navigation().await.map_err(|e| e.to_string())?;

    // 3. 等待指定节点出现
    if let Some(selector) = wait_selector {
        let mut found = false;
        for _ in 0..10 {
            if page.find_element(&selector).await.is_ok() {
                found = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        if !found {
            return Err(format!("Timeout waiting for selector: {}", selector));
        }
    }

    Ok("页面加载并渲染完全".to_string())
}

// 核心优化：获取 Semantic Tree
#[tauri::command]
pub async fn get_semantic_tree(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接")?
    };

    let parse_script = r#"
        (() => {
            const elements = [];
            let i = 1;
            // NOTE: getBoundingClientRect() always returns 0 in background tabs.
            // Use CSS computed style to check visibility instead.
            document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], h1, h2, h3, h4, [aria-label], [data-testid]').forEach(el => {
                const style = window.getComputedStyle(el);
                const hidden = style.display === 'none'
                    || style.visibility === 'hidden'
                    || style.opacity === '0'
                    || el.closest('[hidden]') !== null;
                if (hidden) return;
                const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().substring(0, 120);
                if (!text) return;
                elements.push({
                    id: i++,
                    tag: el.tagName.toLowerCase(),
                    role: el.getAttribute('role') || '',
                    text,
                    ariaLabel: el.getAttribute('aria-label') || '',
                    href: el.tagName === 'A' ? el.getAttribute('href') || '' : ''
                });
            });
            return JSON.stringify(elements);
        })();
    "#;

    let result = page.evaluate(parse_script).await.map_err(|e| e.to_string())?;
    Ok(result.into_value::<String>().unwrap_or_else(|_| "[]".to_string()))
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

/// Click an element by its ID using CDP Mouse Events
/// element_id is 1-indexed (matches get_semantic_tree order)
#[tauri::command]
pub async fn cdp_click(
    element_id: u64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接，请先调用 connect_browser")?
    };

    // Prefer a direct JS .click() which works even in background/hidden tabs
    // where getBoundingClientRect() would return all-zeros.
    // Fall back to CDP mouse events only when .click() throws (e.g. the element
    // has no default click handler and needs a real pointer event).
    let script = format!(r#"
        (() => {{
            const els = Array.from(document.querySelectorAll(
                'button, a, input, [role="button"], h1, h2, h3'
            ));
            const el = els[{} - 1];  // element_id is 1-indexed
            if (!el) return JSON.stringify({{ ok: false, reason: "not_found" }});
            el.scrollIntoView({{ block: "center" }});
            try {{
                el.click();
                return JSON.stringify({{ ok: true, method: "js_click", tag: el.tagName }});
            }} catch (e) {{
                // Return coordinates so the caller can use CDP mouse events
                const r = el.getBoundingClientRect();
                return JSON.stringify({{
                    ok: false,
                    method: "need_cdp",
                    x: r.left + r.width / 2,
                    y: r.top + r.height / 2,
                    tag: el.tagName
                }});
            }}
        }})();
    "#, element_id);

    let result = page.evaluate(script).await.map_err(|e| e.to_string())?;
    let resp_str = result.into_value::<String>()
        .map_err(|_| format!("元素 ID {} 未找到或脚本返回空", element_id))?;

    let resp: serde_json::Value = serde_json::from_str(&resp_str)
        .map_err(|e| format!("JS 响应解析失败: {}", e))?;

    if resp["ok"].as_bool().unwrap_or(false) {
        let tag = resp["tag"].as_str().unwrap_or("?");
        return Ok(format!("点击成功: 元素 ID {} <{}>", element_id, tag));
    }

    let reason = resp["reason"].as_str().unwrap_or("");
    if reason == "not_found" {
        return Err(format!("元素 ID {} 不存在", element_id));
    }

    // JS click threw — fall back to CDP mouse events using the coordinates
    let x = resp["x"].as_f64().ok_or("x 坐标无效")?;
    let y = resp["y"].as_f64().ok_or("y 坐标无效")?;

    if x == 0.0 && y == 0.0 {
        return Err(format!(
            "元素 ID {} 在后台标签页中不可见，坐标为零，无法点击", element_id
        ));
    }

    use chromiumoxide::cdp::browser_protocol::input::{
        DispatchMouseEventParams, DispatchMouseEventType, MouseButton,
    };

    let params_down = DispatchMouseEventParams::builder()
        .r#type(DispatchMouseEventType::MousePressed)
        .x(x)
        .y(y)
        .button(MouseButton::Left)
        .click_count(1)
        .build()
        .map_err(|e| e.to_string())?;

    let params_up = DispatchMouseEventParams::builder()
        .r#type(DispatchMouseEventType::MouseReleased)
        .x(x)
        .y(y)
        .button(MouseButton::Left)
        .click_count(1)
        .build()
        .map_err(|e| e.to_string())?;

    page.execute(params_down).await.map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    page.execute(params_up).await.map_err(|e| e.to_string())?;

    Ok(format!("点击成功(CDP): 元素 ID {} 坐标 ({}, {})", element_id, x, y))
}

/// Type text into an element by its ID using CDP KeyEvents
#[tauri::command]
pub async fn cdp_type(
    element_id: u64,
    text: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接")?
    };

    // Focus and clear the target input
    let focus_script = format!(r#"
        (() => {{
            const els = Array.from(document.querySelectorAll(
                'button, a, input, [role="button"], h1, h2, h3'
            )).filter(el => {{
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }});
            const el = els[{} - 1];
            if (!el) return false;
            el.focus();
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {{
                el.value = '';
            }}
            return true;
        }})();
    "#, element_id);

    let focused = page.evaluate(focus_script).await.map_err(|e| e.to_string())?;
    let ok = focused.into_value::<bool>().unwrap_or(false);
    if !ok {
        return Err(format!("元素 ID {} 未找到，无法输入", element_id));
    }

    // Type character by character via CDP KeyEvent (triggers React/Vue listeners)
    use chromiumoxide::cdp::browser_protocol::input::{
        DispatchKeyEventParams, DispatchKeyEventType,
    };

    for ch in text.chars() {
        let char_str = ch.to_string();
        let key_event = DispatchKeyEventParams::builder()
            .r#type(DispatchKeyEventType::Char)
            .text(char_str)
            .build()
            .map_err(|e| e.to_string())?;
        page.execute(key_event).await.map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }

    Ok(format!("输入成功: 元素 ID {} 内容 \"{}\"", element_id, text))
}

/// Scroll the page
#[tauri::command]
pub async fn cdp_scroll(
    direction: String,
    pixels: i64,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接")?
    };

    let (dx, dy) = match direction.as_str() {
        "down"  => (0, pixels),
        "up"    => (0, -pixels),
        "right" => (pixels, 0),
        "left"  => (-pixels, 0),
        other   => return Err(format!("无效方向: {}，请用 down/up/left/right", other)),
    };

    let script = format!("window.scrollBy({}, {});", dx, dy);
    page.evaluate(script).await.map_err(|e| e.to_string())?;

    Ok(format!("滚动: {} {}px", direction, pixels))
}

// ============= CDP Connector UI Commands =============

/// Launch Chrome with remote debugging port enabled.
///
/// If Chrome is already running WITHOUT the debug port, `open -a` would just focus
/// the existing window and ignore `--args`. To fix this, we kill any running Chrome
/// first, then relaunch with the debug flag. The caller should wait ~3s after this
/// returns before attempting connect_browser.
#[tauri::command]
pub async fn launch_chrome_debug() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Strategy: try to reuse the EXISTING Chrome by enabling remote debugging
        // via AppleScript. If Chrome is not running, launch it fresh with the user's
        // REAL profile so all cookies / sessions are preserved.
        //
        // We intentionally do NOT kill Chrome — killing it would wipe the user's
        // open tabs and logged-in sessions.

        // Step 1: Check if port 9222 is already open (Chrome already in debug mode).
        if reqwest::get("http://127.0.0.1:9222/json/version").await.is_ok() {
            return Ok("Chrome 调试端口已就绪，无需重启。".to_string());
        }

        // Step 2: Chrome is running but without the debug port — we cannot inject
        // the flag into a running process. Inform the caller so the UI can show
        // a manual instruction ("Quit Chrome, then click Connect again").
        let chrome_running = std::process::Command::new("pgrep")
            .args(["-x", "Google Chrome"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if chrome_running {
            // Chrome is open but doesn't have --remote-debugging-port.
            // We cannot enable CDP without restarting it. Return a specific error
            // so the frontend can guide the user.
            return Err("CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口。请退出 Chrome 后重新点击「连接 Chrome」，软件会自动以调试模式启动它。".to_string());
        }

        // Step 3: Chrome is not running — launch it with the real user profile.
        // Using the real profile preserves all logins, cookies and extensions.
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let real_profile = format!("{}/Library/Application Support/Google/Chrome", home);

        let chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];

        let mut launched = false;
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
                launched = true;
                break;
            }
        }

        if !launched {
            return Err("未找到 Chrome 或 Chromium，请确认已安装在 /Applications 目录下".to_string());
        }

        return Ok("Chrome 正在以调试模式启动（使用您的真实 Profile）...".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // Check if port is already open
        if reqwest::get("http://127.0.0.1:9222/json/version").await.is_ok() {
            return Ok("Chrome 调试端口已就绪，无需重启。".to_string());
        }

        // Check if Chrome is running without debug port
        let chrome_running = std::process::Command::new("tasklist")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("chrome.exe"))
            .unwrap_or(false);

        if chrome_running {
            return Err("CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口。请退出 Chrome 后重新点击「连接 Chrome」。".to_string());
        }

        // Launch with real user profile
        let appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\User\\AppData\\Local".to_string());
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
                return Ok("Chrome 正在以调试模式启动...".to_string());
            }
        }
        return Err("未找到 Chrome 安装路径".to_string());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if reqwest::get("http://127.0.0.1:9222/json/version").await.is_ok() {
            return Ok("Chrome 调试端口已就绪，无需重启。".to_string());
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

        Ok("Chrome 正在以调试模式启动...".to_string())
    }
}

/// Re-sync page reference after navigation or new-tab opens.
/// Picks the LAST open page (most recently opened/navigated),
/// which is correct for GitHub-style "target=_blank" links.
#[tauri::command]
pub async fn resync_page(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let mut st = state.lock().await;
    let browser = st.browser.as_mut().ok_or("浏览器未连接")?;

    // Get all pages from the browser
    let pages = browser.pages().await.map_err(|e| e.to_string())?;

    // Pick the LAST page — when a link opens a new tab (target=_blank),
    // that new tab is the last entry. Falling back to first if only one exists.
    let active_page = pages
        .into_iter()
        .last()
        .ok_or("未找到任何已打开的页面")?;

    st.page = Some(active_page);
    Ok("页面已重新同步".to_string())
}

/// Disconnect browser - clears BrowserController state
#[tauri::command]
pub async fn disconnect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let mut st = state.lock().await;
    // Abort background handler task
    if let Some(handle) = st.browser_handle.take() {
        handle.abort();
    }
    st.page = None;
    st.browser = None;   // drop browser → closes CDP connection
    Ok("已断开 Chrome 连接".to_string())
}

/// Execute arbitrary JavaScript in the current CDP page.
/// Used to inject/remove the agent scanning overlay.
#[tauri::command]
pub async fn cdp_execute_script(
    script: String,
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let st = state.lock().await;
    let page = st.page.as_ref().ok_or("CDP 未连接")?;
    page.evaluate(script)
        .await
        .map(|v| v.into_value::<serde_json::Value>().ok()
            .map(|val| val.to_string())
            .unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// Capture a screenshot of the current CDP page as a base64-encoded PNG.
/// Returns the base64 string (without data:image/png;base64, prefix).
#[tauri::command]
pub async fn cdp_screenshot(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接，请先调用 connect_browser")?
    };

    use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotParams;
    use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;

    let params = CaptureScreenshotParams::builder()
        .format(CaptureScreenshotFormat::Png)
        .build();

    let screenshot = page.execute(params).await.map_err(|e| format!("截图失败: {}", e))?;
    // screenshot.data is chromiumoxide::Binary, convert to base64 string
    use base64::Engine;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&screenshot.data);
    Ok(base64_str)
}

/// Extract structured text content from the current CDP page.
/// Returns readable content with headers, links, and key data.
#[tauri::command]
pub async fn cdp_extract_content(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
    let page = {
        let st = state.lock().await;
        st.page.clone().ok_or("浏览器未连接")?
    };

    let extract_script = r#"
        (() => {
            const result = {};
            result.url = window.location.href;
            result.title = document.title;

            // Extract main content areas
            const mainSelectors = ['main', 'article', '[role="main"]', '#content', '.content', '#main'];
            let mainEl = null;
            for (const sel of mainSelectors) {
                mainEl = document.querySelector(sel);
                if (mainEl) break;
            }
            const contentRoot = mainEl || document.body;

            // Extract headings
            const headings = [];
            contentRoot.querySelectorAll('h1, h2, h3').forEach(h => {
                const text = h.innerText.trim();
                if (text) headings.push({ level: parseInt(h.tagName[1]), text: text.substring(0, 200) });
            });
            result.headings = headings.slice(0, 20);

            // Extract links with context
            const links = [];
            contentRoot.querySelectorAll('a[href]').forEach(a => {
                const text = a.innerText.trim();
                const href = a.href;
                if (text && href && !href.startsWith('javascript:') && text.length > 1) {
                    links.push({ text: text.substring(0, 100), href: href.substring(0, 300) });
                }
            });
            result.links = links.slice(0, 30);

            // Extract text content (cleaned)
            const text = contentRoot.innerText
                .replace(/\n{3,}/g, '\n\n')
                .substring(0, 5000);
            result.text = text;

            // Extract tables if any
            const tables = [];
            contentRoot.querySelectorAll('table').forEach(table => {
                const rows = [];
                table.querySelectorAll('tr').forEach(tr => {
                    const cells = [];
                    tr.querySelectorAll('th, td').forEach(cell => {
                        cells.push(cell.innerText.trim().substring(0, 100));
                    });
                    if (cells.length > 0) rows.push(cells);
                });
                if (rows.length > 0 && rows.length <= 50) tables.push(rows);
            });
            result.tables = tables.slice(0, 5);

            // Extract form fields
            const forms = [];
            contentRoot.querySelectorAll('input, select, textarea').forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;
                forms.push({
                    tag: el.tagName.toLowerCase(),
                    type: el.type || '',
                    name: el.name || '',
                    placeholder: el.placeholder || '',
                    label: el.getAttribute('aria-label') || '',
                    value: el.value || '',
                });
            });
            result.forms = forms.slice(0, 20);

            return JSON.stringify(result);
        })();
    "#;

    let result = page.evaluate(extract_script).await.map_err(|e| e.to_string())?;
    Ok(result.into_value::<String>().unwrap_or_else(|_| "{}".to_string()))
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
