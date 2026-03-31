/**
 * Web automation commands
 *
 * Handles web automation and browser control
 * (Placeholder for future Page-Agent integration)
 */

use crate::models::WebAutomationRequest;
use crate::utils::{AppError, AppResult};
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
    let (mut browser, mut handler) = Browser::connect(ws_url)
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

    // Re-query the element using the same selector as get_semantic_tree
    // to ensure ID correspondence.
    // Return "" (empty string) when element not found — avoids the JSON-null
    // deserialization ambiguity that makes the "null" string check unreachable.
    let script = format!(r#"
        (() => {{
            const els = Array.from(document.querySelectorAll(
                'button, a, input, [role="button"], h1, h2, h3'
            )).filter(el => {{
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }});
            const el = els[{} - 1];  // element_id is 1-indexed
            if (!el) return "";
            const r = el.getBoundingClientRect();
            return JSON.stringify({{
                x: r.left + r.width / 2,
                y: r.top + r.height / 2,
                tag: el.tagName
            }});
        }})();
    "#, element_id);

    let result = page.evaluate(script).await.map_err(|e| e.to_string())?;
    let coord_str = result.into_value::<String>()
        .map_err(|_| format!("元素 ID {} 未找到或不可见", element_id))?;

    if coord_str.is_empty() {
        return Err(format!("元素 ID {} 不存在或已不在视口内", element_id));
    }

    let coords: serde_json::Value = serde_json::from_str(&coord_str)
        .map_err(|e| format!("坐标解析失败: {}", e))?;

    // Keep as f64 — no need for i64 intermediate that loses sub-pixel precision
    let x = coords["x"].as_f64().ok_or("x 坐标无效")?;
    let y = coords["y"].as_f64().ok_or("y 坐标无效")?;

    // Use chromiumoxide CDP Mouse Events to click
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

    Ok(format!("点击成功: 元素 ID {} 坐标 ({}, {})", element_id, x, y))
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
