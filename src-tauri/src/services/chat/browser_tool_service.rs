use crate::browser::dom::PageState;
use crate::utils::{AppError, AppResult};
use async_trait::async_trait;

pub(crate) fn is_browser_not_connected_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("未连接") || normalized.contains("not connected")
}

pub(crate) fn browser_not_connected_message() -> String {
    "ERROR: 浏览器未连接。请先在界面中点击「连接 Chrome」，然后再重试此操作。".to_string()
}

pub(crate) fn serialize_page_state_for_chat(page_state: &PageState) -> String {
    serde_json::to_string_pretty(page_state).unwrap_or_else(|_| "{}".to_string())
}

pub(crate) fn browser_target_from_args(
    args: &serde_json::Value,
    tool_name: &str,
) -> AppResult<(Option<u64>, Option<i64>, Option<String>)> {
    let element_id = args
        .get("element_id")
        .or_else(|| args.get("elementId"))
        .and_then(|value| value.as_u64());
    let backend_node_id = args
        .get("backend_node_id")
        .or_else(|| args.get("backendNodeId"))
        .and_then(|value| value.as_i64());
    let navigation_id = args
        .get("navigation_id")
        .or_else(|| args.get("navigationId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    if element_id.is_none() && backend_node_id.is_none() {
        return Err(AppError::InternalError(format!(
            "Missing 'element_id' or 'backend_node_id' argument for {}",
            tool_name
        )));
    }

    Ok((element_id, backend_node_id, navigation_id))
}

fn describe_browser_target(element_id: Option<u64>, backend_node_id: Option<i64>) -> String {
    match (element_id, backend_node_id) {
        (Some(element_id), Some(backend_node_id)) => {
            format!("元素 {} / backend_node_id {}", element_id, backend_node_id)
        }
        (Some(element_id), None) => format!("元素 {}", element_id),
        (None, Some(backend_node_id)) => format!("backend_node_id {}", backend_node_id),
        (None, None) => "目标元素".to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BrowserToolTarget {
    pub(crate) element_id: Option<u64>,
    pub(crate) backend_node_id: Option<i64>,
    pub(crate) navigation_id: Option<String>,
}

impl BrowserToolTarget {
    fn from_args(args: &serde_json::Value, tool_name: &str) -> AppResult<Self> {
        let (element_id, backend_node_id, navigation_id) =
            browser_target_from_args(args, tool_name)?;
        Ok(Self {
            element_id,
            backend_node_id,
            navigation_id,
        })
    }

    pub(crate) fn label(&self) -> String {
        describe_browser_target(self.element_id, self.backend_node_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BrowserChatToolCall {
    Navigate {
        url: String,
        wait_selector: Option<String>,
    },
    GetPage,
    Click {
        target: BrowserToolTarget,
    },
    Type {
        target: BrowserToolTarget,
        text: String,
    },
    Scroll {
        direction: String,
        pixels: i64,
    },
    GetText {
        max_length: usize,
    },
    Screenshot,
    ExtractContent,
    PressKey {
        key: String,
    },
    Wait {
        seconds: Option<u64>,
        wait_selector: Option<String>,
    },
}

fn browser_wait_selector_from_args(args: &serde_json::Value) -> Option<String> {
    args.get("selector")
        .or_else(|| args.get("wait_selector"))
        .or_else(|| args.get("waitSelector"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

pub(crate) fn parse_browser_chat_tool_call(
    tool_name: &str,
    args: &serde_json::Value,
) -> AppResult<Option<BrowserChatToolCall>> {
    let call = match tool_name {
        "browser_navigate" => {
            let url = args.get("url").and_then(|v| v.as_str()).ok_or_else(|| {
                AppError::InternalError("Missing 'url' argument for browser_navigate".to_string())
            })?;

            Some(BrowserChatToolCall::Navigate {
                url: url.to_string(),
                wait_selector: browser_wait_selector_from_args(args),
            })
        }
        "browser_get_page" => Some(BrowserChatToolCall::GetPage),
        "browser_click" => Some(BrowserChatToolCall::Click {
            target: BrowserToolTarget::from_args(args, "browser_click")?,
        }),
        "browser_type" => {
            let text = args.get("text").and_then(|v| v.as_str()).ok_or_else(|| {
                AppError::InternalError("Missing 'text' argument for browser_type".to_string())
            })?;

            Some(BrowserChatToolCall::Type {
                target: BrowserToolTarget::from_args(args, "browser_type")?,
                text: text.to_string(),
            })
        }
        "browser_scroll" => {
            let direction = args
                .get("direction")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::InternalError(
                        "Missing 'direction' argument for browser_scroll".to_string(),
                    )
                })?;
            let pixels = args.get("pixels").and_then(|v| v.as_i64()).unwrap_or(600);

            Some(BrowserChatToolCall::Scroll {
                direction: direction.to_string(),
                pixels,
            })
        }
        "browser_get_text" => Some(BrowserChatToolCall::GetText {
            max_length: args
                .get("max_length")
                .and_then(|v| v.as_u64())
                .unwrap_or(3000) as usize,
        }),
        "browser_screenshot" => Some(BrowserChatToolCall::Screenshot),
        "browser_extract_content" => Some(BrowserChatToolCall::ExtractContent),
        "browser_press_key" => {
            let key = args.get("key").and_then(|v| v.as_str()).ok_or_else(|| {
                AppError::InternalError("Missing 'key' argument for browser_press_key".to_string())
            })?;

            Some(BrowserChatToolCall::PressKey {
                key: key.to_string(),
            })
        }
        "browser_wait" => Some(BrowserChatToolCall::Wait {
            seconds: args.get("seconds").and_then(|v| v.as_u64()),
            wait_selector: browser_wait_selector_from_args(args),
        }),
        _ => None,
    };

    Ok(call)
}

#[async_trait]
pub(crate) trait BrowserChatRuntime {
    async fn navigate_and_wait(
        &self,
        url: String,
        wait_selector: Option<String>,
    ) -> Result<(), String>;
    async fn resync_page(&self) -> Result<(), String>;
    async fn get_page_state(&self) -> Result<PageState, String>;
    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String>;
    async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String>;
    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String>;
    async fn get_text(&self, max_length: Option<u64>) -> Result<String, String>;
    async fn screenshot(&self) -> Result<String, String>;
    async fn extract_content(&self) -> Result<String, String>;
    async fn press_key(&self, key: String) -> Result<String, String>;
    async fn wait(
        &self,
        seconds: Option<u64>,
        wait_selector: Option<String>,
    ) -> Result<String, String>;

    async fn delay_after_click(&self) {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }
}

pub(crate) async fn execute_browser_chat_tool_call<R>(
    call: BrowserChatToolCall,
    runtime: &R,
) -> String
where
    R: BrowserChatRuntime + Sync,
{
    match call {
        BrowserChatToolCall::Navigate { url, wait_selector } => {
            match runtime.navigate_and_wait(url.clone(), wait_selector).await {
                Ok(_) => {
                    if let Err(error) = runtime.resync_page().await {
                        eprintln!("[browser_navigate] resync_page warning: {}", error);
                    }
                    let title = runtime
                        .get_page_state()
                        .await
                        .map(|page_state| page_state.title)
                        .unwrap_or_else(|_| "Unknown".to_string());
                    format!("已导航到: {}，页面标题: {}", url, title)
                }
                Err(error) => {
                    if is_browser_not_connected_error(&error) {
                        browser_not_connected_message()
                    } else {
                        format!(
                            "ERROR: 导航失败（{}s）。URL: {}。可能是网络问题或页面需要认证。",
                            30, url
                        )
                    }
                }
            }
        }
        BrowserChatToolCall::GetPage => match runtime.get_page_state().await {
            Ok(page_state) => serialize_page_state_for_chat(&page_state),
            Err(error) => {
                if is_browser_not_connected_error(&error) {
                    browser_not_connected_message()
                } else {
                    format!("ERROR: 获取页面元素失败: {}", error)
                }
            }
        },
        BrowserChatToolCall::Click { target } => {
            let target_label = target.label();

            match runtime.click(&target).await {
                Ok(_) => {
                    runtime.delay_after_click().await;
                    format!(
                        "已点击{}，页面可能已更新，请使用 browser_get_page 查看新状态",
                        target_label
                    )
                }
                Err(error) => {
                    if is_browser_not_connected_error(&error) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 点击{}失败: {}", target_label, error)
                    }
                }
            }
        }
        BrowserChatToolCall::Type { target, text } => {
            let target_label = target.label();

            match runtime.type_text(&target, text).await {
                Ok(message) => message,
                Err(error) => {
                    if is_browser_not_connected_error(&error) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 向{}输入失败: {}", target_label, error)
                    }
                }
            }
        }
        BrowserChatToolCall::Scroll { direction, pixels } => {
            match runtime.scroll(direction.clone(), pixels).await {
                Ok(_) => format!("已向{}滚动 {}px", direction, pixels),
                Err(error) => {
                    if is_browser_not_connected_error(&error) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 滚动失败: {}", error)
                    }
                }
            }
        }
        BrowserChatToolCall::GetText { max_length } => {
            match runtime.get_text(Some(max_length as u64)).await {
                Ok(text) => {
                    if text.is_empty() {
                        "页面没有文本内容".to_string()
                    } else {
                        text
                    }
                }
                Err(error) => {
                    if is_browser_not_connected_error(&error) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 获取页面文本失败: {}", error)
                    }
                }
            }
        }
        BrowserChatToolCall::Screenshot => match runtime.screenshot().await {
            Ok(base64_data) => {
                format!(
                    "截图已捕获（base64 PNG，长度 {} 字符）。图片数据已保存，可直接展示给用户。",
                    base64_data.len()
                )
            }
            Err(error) => {
                if is_browser_not_connected_error(&error) {
                    browser_not_connected_message()
                } else {
                    format!("ERROR: 截图失败: {}", error)
                }
            }
        },
        BrowserChatToolCall::ExtractContent => match runtime.extract_content().await {
            Ok(content) => content,
            Err(error) => {
                if is_browser_not_connected_error(&error) {
                    browser_not_connected_message()
                } else {
                    format!("ERROR: 提取内容失败: {}", error)
                }
            }
        },
        BrowserChatToolCall::PressKey { key } => match runtime.press_key(key.clone()).await {
            Ok(_) => format!("已按下键 '{}'", key),
            Err(error) => {
                if is_browser_not_connected_error(&error) {
                    browser_not_connected_message()
                } else {
                    format!("ERROR: 按键失败: {}", error)
                }
            }
        },
        BrowserChatToolCall::Wait {
            seconds,
            wait_selector,
        } => match runtime.wait(seconds, wait_selector).await {
            Ok(message) => message,
            Err(error) => {
                if is_browser_not_connected_error(&error) {
                    browser_not_connected_message()
                } else {
                    format!("ERROR: 等待失败: {}", error)
                }
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::dom::InteractiveElement;

    fn sample_page_state() -> PageState {
        PageState {
            url: "https://example.com/dashboard".to_string(),
            title: "Dashboard".to_string(),
            navigation_id: "nav-42".to_string(),
            frame_count: 1,
            viewport: None,
            warnings: vec!["cross_origin_iframe_partial".to_string()],
            elements: vec![InteractiveElement {
                index: 1,
                backend_node_id: 101,
                frame_id: "root".to_string(),
                role: "button".to_string(),
                name: "Sync Now".to_string(),
                tag_name: Some("button".to_string()),
                bounds: None,
                is_visible: true,
                is_clickable: true,
                is_editable: false,
                selector_hint: Some("button[data-action=\"sync\"]".to_string()),
                text_hint: None,
                href: None,
                input_type: None,
            }],
            screenshot: None,
        }
    }

    #[test]
    fn parse_wait_selector_accepts_aliases() {
        let args = serde_json::json!({ "waitSelector": ".ready" });

        let call = parse_browser_chat_tool_call("browser_wait", &args)
            .unwrap()
            .unwrap();

        assert_eq!(
            call,
            BrowserChatToolCall::Wait {
                seconds: None,
                wait_selector: Some(".ready".to_string()),
            }
        );
    }

    #[test]
    fn serialize_page_state_uses_pretty_json() {
        let rendered = serialize_page_state_for_chat(&sample_page_state());

        assert!(rendered.starts_with("{\n"));
        assert!(rendered.contains("\"navigation_id\": \"nav-42\""));
    }

    #[test]
    fn target_from_args_accepts_alias_fields() {
        let args = serde_json::json!({
            "elementId": 7,
            "backendNodeId": 701,
            "navigationId": "nav-42"
        });

        let target = browser_target_from_args(&args, "browser_click").unwrap();

        assert_eq!(target, (Some(7), Some(701), Some("nav-42".to_string())));
    }
}
