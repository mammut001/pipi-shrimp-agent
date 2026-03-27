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
    pub browser_handle: Option<tokio::task::JoinHandle<()>>,
}

impl Default for BrowserController {
    fn default() -> Self {
        Self { page: None, browser_handle: None }
    }
}

// 核心命令：开启并接管用户的本地 Chrome
#[tauri::command]
pub async fn connect_browser(
    state: tauri::State<'_, Arc<Mutex<BrowserController>>>
) -> Result<String, String> {
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
    let handle = tokio::spawn(async move {
        while let Some(h) = handler.next().await {
            if h.is_err() { break; }
        }
    });

    let page = browser.new_page("about:blank").await.map_err(|e| e.to_string())?;

    let mut st = state.lock().await;
    st.page = Some(page);
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
            document.querySelectorAll('button, a, input, [role="button"], h1, h2, h3').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    elements.push({
                        id: i++,
                        tag: el.tagName.toLowerCase(),
                        role: el.getAttribute('role') || '',
                        text: (el.innerText || el.value || '').trim().substring(0, 100),
                        ariaLabel: el.getAttribute('aria-label') || ''
                    });
                }
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
