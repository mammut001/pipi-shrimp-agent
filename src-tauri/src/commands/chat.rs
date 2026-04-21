/**
 * Chat commands
 *
 * Handles chat session management and message sending using SQLite
 */

use crate::database::{self, DbSession, DbMessage};
use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::utils::{AppError, AppResult};
use crate::commands::web::{self, BrowserController};
use async_trait::async_trait;
use crate::browser::dom::PageState;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/**
 * Session data structure for API responses
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionData {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub cwd: Option<String>,
    pub messages: Vec<Message>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub artifacts: Option<String>,
    pub tool_calls: Option<String>,
    pub token_usage: Option<String>,
    pub tool_call_id: Option<String>,
    pub timestamp: u64,
}

/**
 * Get current timestamp
 */
fn get_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn is_browser_not_connected_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("未连接") || normalized.contains("not connected")
}

fn browser_not_connected_message() -> String {
    "ERROR: 浏览器未连接。请先在界面中点击「连接 Chrome」，然后再重试此操作。".to_string()
}

fn serialize_page_state_for_chat(page_state: &crate::browser::dom::PageState) -> String {
    serde_json::to_string_pretty(page_state).unwrap_or_else(|_| "{}".to_string())
}

fn browser_target_from_args(
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
struct BrowserToolTarget {
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
}

impl BrowserToolTarget {
    fn from_args(args: &serde_json::Value, tool_name: &str) -> AppResult<Self> {
        let (element_id, backend_node_id, navigation_id) = browser_target_from_args(args, tool_name)?;
        Ok(Self {
            element_id,
            backend_node_id,
            navigation_id,
        })
    }

    fn label(&self) -> String {
        describe_browser_target(self.element_id, self.backend_node_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum BrowserChatToolCall {
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
    args
        .get("selector")
        .or_else(|| args.get("wait_selector"))
        .or_else(|| args.get("waitSelector"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn parse_browser_chat_tool_call(
    tool_name: &str,
    args: &serde_json::Value,
) -> AppResult<Option<BrowserChatToolCall>> {
    let call = match tool_name {
        "browser_navigate" => {
            let url = args.get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'url' argument for browser_navigate".to_string()))?;

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
            let text = args.get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'text' argument for browser_type".to_string()))?;

            Some(BrowserChatToolCall::Type {
                target: BrowserToolTarget::from_args(args, "browser_type")?,
                text: text.to_string(),
            })
        }
        "browser_scroll" => {
            let direction = args.get("direction")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'direction' argument for browser_scroll".to_string()))?;
            let pixels = args.get("pixels")
                .and_then(|v| v.as_i64())
                .unwrap_or(600);

            Some(BrowserChatToolCall::Scroll {
                direction: direction.to_string(),
                pixels,
            })
        }
        "browser_get_text" => Some(BrowserChatToolCall::GetText {
            max_length: args.get("max_length")
                .and_then(|v| v.as_u64())
                .unwrap_or(3000) as usize,
        }),
        "browser_screenshot" => Some(BrowserChatToolCall::Screenshot),
        "browser_extract_content" => Some(BrowserChatToolCall::ExtractContent),
        "browser_press_key" => {
            let key = args.get("key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'key' argument for browser_press_key".to_string()))?;

            Some(BrowserChatToolCall::PressKey {
                key: key.to_string(),
            })
        }
        "browser_wait" => Some(BrowserChatToolCall::Wait {
            seconds: args.get("seconds")
                .and_then(|v| v.as_u64()),
            wait_selector: browser_wait_selector_from_args(args),
        }),
        _ => None,
    };

    Ok(call)
}

#[async_trait]
trait BrowserChatRuntime {
    async fn navigate_and_wait(&self, url: String, wait_selector: Option<String>) -> Result<(), String>;
    async fn resync_page(&self) -> Result<(), String>;
    async fn get_page_state(&self) -> Result<PageState, String>;
    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String>;
    async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String>;
    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String>;
    async fn get_text(&self, max_length: Option<u64>) -> Result<String, String>;
    async fn screenshot(&self) -> Result<String, String>;
    async fn extract_content(&self) -> Result<String, String>;
    async fn press_key(&self, key: String) -> Result<String, String>;
    async fn wait(&self, seconds: Option<u64>, wait_selector: Option<String>) -> Result<String, String>;

    async fn delay_after_click(&self) {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }
}

struct LiveBrowserChatRuntime<'a> {
    browser_state: tauri::State<'a, Arc<Mutex<BrowserController>>>,
}

#[async_trait]
impl BrowserChatRuntime for LiveBrowserChatRuntime<'_> {
    async fn navigate_and_wait(&self, url: String, wait_selector: Option<String>) -> Result<(), String> {
        web::navigate_and_wait(url, wait_selector, self.browser_state.clone())
            .await
            .map(|_| ())
    }

    async fn resync_page(&self) -> Result<(), String> {
        web::resync_page(self.browser_state.clone()).await.map(|_| ())
    }

    async fn get_page_state(&self) -> Result<PageState, String> {
        web::get_page_state(self.browser_state.clone()).await
    }

    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
        web::browser_click(
            target.element_id,
            target.backend_node_id,
            target.navigation_id.clone(),
            self.browser_state.clone(),
        )
        .await
    }

    async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String> {
        web::browser_type(
            target.element_id,
            target.backend_node_id,
            target.navigation_id.clone(),
            text,
            self.browser_state.clone(),
        )
        .await
    }

    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
        web::browser_scroll(direction, pixels, self.browser_state.clone()).await
    }

    async fn get_text(&self, max_length: Option<u64>) -> Result<String, String> {
        web::browser_get_text(max_length, self.browser_state.clone()).await
    }

    async fn screenshot(&self) -> Result<String, String> {
        web::browser_screenshot(self.browser_state.clone()).await
    }

    async fn extract_content(&self) -> Result<String, String> {
        web::browser_extract_content(self.browser_state.clone()).await
    }

    async fn press_key(&self, key: String) -> Result<String, String> {
        web::browser_press_key(key, self.browser_state.clone()).await
    }

    async fn wait(&self, seconds: Option<u64>, wait_selector: Option<String>) -> Result<String, String> {
        web::browser_wait(seconds, wait_selector, self.browser_state.clone()).await
    }
}

async fn execute_browser_chat_tool_call<R>(
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
                    if let Err(e) = runtime.resync_page().await {
                        eprintln!("[browser_navigate] resync_page warning: {}", e);
                    }
                    let title = runtime
                        .get_page_state()
                        .await
                        .map(|page_state| page_state.title)
                        .unwrap_or_else(|_| "Unknown".to_string());
                    format!("已导航到: {}，页面标题: {}", url, title)
                }
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 导航失败（{}s）。URL: {}。可能是网络问题或页面需要认证。", 30, url)
                    }
                }
            }
        }
        BrowserChatToolCall::GetPage => {
            match runtime.get_page_state().await {
                Ok(page_state) => serialize_page_state_for_chat(&page_state),
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 获取页面元素失败: {}", e)
                    }
                }
            }
        }
        BrowserChatToolCall::Click { target } => {
            let target_label = target.label();

            match runtime.click(&target).await {
                Ok(_) => {
                    runtime.delay_after_click().await;
                    format!("已点击{}，页面可能已更新，请使用 browser_get_page 查看新状态", target_label)
                }
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 点击{}失败: {}", target_label, e)
                    }
                }
            }
        }
        BrowserChatToolCall::Type { target, text } => {
            let target_label = target.label();

            match runtime.type_text(&target, text).await {
                Ok(msg) => msg,
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 向{}输入失败: {}", target_label, e)
                    }
                }
            }
        }
        BrowserChatToolCall::Scroll { direction, pixels } => {
            match runtime.scroll(direction.clone(), pixels).await {
                Ok(_) => format!("已向{}滚动 {}px", direction, pixels),
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 滚动失败: {}", e)
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
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 获取页面文本失败: {}", e)
                    }
                }
            }
        }
        BrowserChatToolCall::Screenshot => {
            match runtime.screenshot().await {
                Ok(base64_data) => {
                    format!("截图已捕获（base64 PNG，长度 {} 字符）。图片数据已保存，可直接展示给用户。", base64_data.len())
                }
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 截图失败: {}", e)
                    }
                }
            }
        }
        BrowserChatToolCall::ExtractContent => {
            match runtime.extract_content().await {
                Ok(content) => content,
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 提取内容失败: {}", e)
                    }
                }
            }
        }
        BrowserChatToolCall::PressKey { key } => {
            match runtime.press_key(key.clone()).await {
                Ok(_) => format!("已按下键 '{}'", key),
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 按键失败: {}", e)
                    }
                }
            }
        }
        BrowserChatToolCall::Wait { seconds, wait_selector } => {
            match runtime.wait(seconds, wait_selector).await {
                Ok(message) => message,
                Err(e) => {
                    if is_browser_not_connected_error(&e) {
                        browser_not_connected_message()
                    } else {
                        format!("ERROR: 等待失败: {}", e)
                    }
                }
            }
        }
    }
}

/**
 * Convert DbSession to SessionData with messages
 */
fn db_session_to_session_data(db_session: DbSession) -> AppResult<SessionData> {
    let messages = database::get_messages_for_session(&db_session.id)
        .map_err(|e| AppError::InternalError(format!("Failed to get messages: {}", e)))?
        .into_iter()
        .map(|m| Message {
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            artifacts: m.artifacts,
            tool_calls: m.tool_calls,
            token_usage: m.token_usage,
            tool_call_id: None, // This field is used for API requests, not persisted in DB for every msg role yet (in prefix)
            timestamp: m.created_at as u64,
        })
        .collect();

    Ok(SessionData {
        id: db_session.id,
        title: db_session.title,
        created_at: db_session.created_at as u64,
        updated_at: db_session.updated_at as u64,
        cwd: db_session.cwd,
        messages,
    })
}

/**
 * Start a new chat session
 *
 * Creates a new session in SQLite database
 */
#[tauri::command]
pub async fn start_session(_app: AppHandle) -> AppResult<String> {
    let session_id = Uuid::new_v4().to_string();
    let timestamp = get_timestamp() as i64;

    let session = DbSession {
        id: session_id.clone(),
        title: "New Chat".to_string(),
        created_at: timestamp,
        updated_at: timestamp,
        cwd: None,
        project_id: None,
        model: None,
        work_dir: None,
        working_files: None,
        permission_mode: Some("standard".to_string()),
    };

    database::save_session(&session)
        .map_err(|e| AppError::InternalError(format!("Failed to save session: {}", e)))?;

    println!("📝 Created new session in database: {}", session_id);
    Ok(session_id)
}

/**
 * Send a message to the chat
 *
 * Saves message to database and returns assistant's response
 */
#[tauri::command]
pub async fn send_message(_app: AppHandle, req: SendMessageRequest) -> AppResult<SendMessageResponse> {
    let timestamp = get_timestamp() as i64;
    let message_id = Uuid::new_v4().to_string();

    // Save user message to database
    let user_message = DbMessage {
        id: message_id,
        session_id: req.session_id.clone(),
        role: "user".to_string(),
        content: req.content.clone(),
        reasoning: None,
        artifacts: None,
        tool_calls: None,
        token_usage: None,
        created_at: timestamp,
    };

    database::save_message(&user_message)
        .map_err(|e| AppError::InternalError(format!("Failed to save user message: {}", e)))?;

    // Update session's updated_at timestamp
    if let Ok(sessions) = database::get_all_sessions() {
        if let Some(session) = sessions.iter().find(|s| s.id == req.session_id) {
            let mut updated_session = session.clone();
            updated_session.updated_at = timestamp;
            let _ = database::save_session(&updated_session);
        }
    }

    // Return response - actual Claude response will be saved by frontend
    // The frontend will call save_message after receiving streaming tokens
    Ok(SendMessageResponse {
        id: Uuid::new_v4().to_string(),
        content: String::new(), // Empty - frontend will populate via streaming
        artifacts: vec![],
    })
}

/**
 * Save a message to database (called from frontend after streaming)
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn save_message_to_db(
    _app: AppHandle,
    session_id: String,
    role: String,
    content: String,
    reasoning: Option<String>,
    artifacts: Option<String>,
    tool_calls: Option<String>,
    token_usage: Option<String>,
) -> AppResult<String> {
    let timestamp = get_timestamp() as i64;
    let message_id = Uuid::new_v4().to_string();

    let message = DbMessage {
        id: message_id.clone(),
        session_id,
        role,
        content,
        reasoning,
        artifacts,
        tool_calls,
        token_usage,
        created_at: timestamp,
    };

    database::save_message(&message)
        .map_err(|e| AppError::InternalError(format!("Failed to save message: {}", e)))?;

    Ok(message_id)
}

/**
 * Get a session by ID
 *
 * Returns the session data with messages from database
 */
#[tauri::command]
pub async fn get_session(_app: AppHandle, session_id: String) -> AppResult<String> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    let session = sessions
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| AppError::NotFound(format!("Session {} not found", session_id)))?;

    let session_data = db_session_to_session_data(session)?;

    serde_json::to_string(&session_data)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize session: {}", e)))
}

/**
 * List all sessions
 *
 * Returns all session IDs and their basic info (without messages)
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn list_sessions(_app: AppHandle) -> AppResult<Vec<SessionData>> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    let mut result = Vec::new();
    for session in sessions {
        result.push(SessionData {
            id: session.id,
            title: session.title,
            created_at: session.created_at as u64,
            updated_at: session.updated_at as u64,
            cwd: session.cwd,
            messages: vec![], // Don't load messages for list view
        });
    }

    // Sort by updated_at descending (newest first)
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(result)
}

/**
 * Delete a session
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn delete_session(_app: AppHandle, session_id: String) -> AppResult<()> {
    database::delete_session(&session_id)
        .map_err(|e| AppError::InternalError(format!("Failed to delete session: {}", e)))?;

    println!("🗑️ Deleted session: {}", session_id);
    Ok(())
}

/**
 * Delete all token usage records
 */
#[tauri::command]
pub async fn reset_token_estimate(_app: AppHandle) -> AppResult<()> {
    database::delete_all_token_usage()
        .map_err(|e| AppError::InternalError(format!("Failed to reset token estimate: {}", e)))?;

    println!("🔄 Token estimate reset successfully");
    Ok(())
}

/**
 * Update session title
 */
#[tauri::command]
pub async fn update_session_title(
    _app: AppHandle,
    session_id: String,
    title: String,
) -> AppResult<()> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    if let Some(mut session) = sessions.into_iter().find(|s| s.id == session_id) {
        session.title = title;
        session.updated_at = get_timestamp() as i64;
        database::save_session(&session)
            .map_err(|e| AppError::InternalError(format!("Failed to update session: {}", e)))?;
    }

    Ok(())
}

/**
 * Update session working directory
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn update_session_cwd(
    _app: AppHandle,
    session_id: String,
    cwd: String,
) -> AppResult<()> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    if let Some(mut session) = sessions.into_iter().find(|s| s.id == session_id) {
        session.work_dir = Some(cwd);
        session.updated_at = get_timestamp() as i64;
        database::save_session(&session)
            .map_err(|e| AppError::InternalError(format!("Failed to update cwd: {}", e)))?;
    }

    Ok(())
}

/**
 * Execute a tool (function call)
 */
#[tauri::command]
pub async fn execute_tool(
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    browser_state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
    font_state: tauri::State<'_, crate::FontDbState>,
) -> AppResult<String> {
    println!("🔧 Executing tool: {} with args: {}", tool_name, arguments);

    // Parse arguments from JSON string
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::InternalError(format!("Invalid tool arguments: {}", e)))?;

    // === Phase 6: Rust-side path/command validation (defense-in-depth) ===
    // This is a backup to the TypeScript-side preToolUseHooks validation
    use crate::commands::path_security;

    match tool_name.as_str() {
        "read_file" | "write_file" | "create_directory" | "path_exists" | "list_files" => {
            if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "search_files" | "glob_search" | "grep_files" => {
            if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "execute_command" => {
            if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_command(command) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        _ => {}
    }

    if let Some(browser_call) = parse_browser_chat_tool_call(&tool_name, &args)? {
        let runtime = LiveBrowserChatRuntime { browser_state };
        return Ok(execute_browser_chat_tool_call(browser_call, &runtime).await);
    }

    // Execute tool and convert result to JSON
    let result_json = match tool_name.as_str() {
        "read_file" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for read_file".to_string()))?;
            let result = crate::commands::file::read_file(path.to_string(), work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "write_file" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for write_file".to_string()))?;
            let content = args.get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'content' argument for write_file".to_string()))?;
            let result = crate::commands::file::write_file(path.to_string(), content.to_string(), work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "execute_command" => {
            let command = args.get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'command' argument for execute_command".to_string()))?;
            let cwd = args.get("cwd")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let result = crate::commands::code::execute_bash(command.to_string(), cwd, work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "create_directory" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for create_directory".to_string()))?;
            let result = crate::commands::file::create_directory(path.to_string(), work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "path_exists" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for path_exists".to_string()))?;
            let result = crate::commands::file::path_exists(path.to_string(), work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "list_files" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for list_files".to_string()))?;
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let result = crate::commands::file::list_files(path.to_string(), pattern, work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "search_files" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for search_files".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for search_files".to_string()))?;
            let extensions = args.get("extensions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|e| e.as_str().map(String::from)).collect());
            crate::commands::search::search_files(pattern.to_string(), path.to_string(), extensions, work_dir.clone()).await?
        }
        "glob_search" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for glob_search".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for glob_search".to_string()))?;
            crate::commands::search::glob_search(pattern.to_string(), path.to_string(), work_dir.clone()).await?
        }
        "grep_files" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for grep_files".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for grep_files".to_string()))?;
            crate::commands::search::grep_files(pattern.to_string(), path.to_string(), work_dir.clone()).await?
        }
        // get_current_workspace 由 TS 侧拦截（chatStore.ts executeTool），
        // 直接从内存中的 session.workDir 返回，不会走到 Rust 这里。
        // 这个分支是安全兜底：万一绕过 TS 直接调用 execute_tool，返回提示而不是崩溃。
        "get_current_workspace" => {
            serde_json::json!({
                "error": false,
                "message": "get_current_workspace is handled by the frontend. The workspace path is injected into the system prompt automatically."
            }).to_string()
        }

        "Skill" => {
            let skill_name = args.get("skill")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'skill' argument for Skill".to_string()))?;
            
            match crate::commands::skill::execute_skill(skill_name.to_string(), work_dir.clone()).await {
                Ok(res) => {
                    if res.success {
                        // Return the SKILL.md content directly so the AI can read and follow it
                        res.output.unwrap_or_else(|| format!("Skill '{}' loaded but has no content.", skill_name))
                    } else {
                        format!("Skill '{}' not found. Available skills: autoresearch, resume, pdf, docx, xlsx, web_research, form_fill. Error: {}",
                            skill_name,
                            res.error.unwrap_or_else(|| "unknown".to_string()))
                    }
                },
                Err(e) => format!("ERROR: Failed to execute skill '{}': {}", skill_name, e),
            }
        }

        "render_typst_to_svg" => {
            let source = args.get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'source' argument for render_typst_to_svg".to_string()))?;
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();
            let source_owned = source.to_string();
            let svg = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                crate::utils::typst::compile_typst_to_svg_with_prebuilt(&source_owned, &prebuilt)
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. Escape it as '\\@' in .typ files (e.g., user\\@example.com).";
                }
                AppError::InternalError(msg)
            })?;
            serde_json::json!({ "svg": svg }).to_string()
        }

        "render_typst_to_pdf" => {
            let source = args.get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'source' argument for render_typst_to_pdf".to_string()))?;
            let file_path = args.get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'file_path' argument for render_typst_to_pdf".to_string()))?;
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();
            let source_owned = source.to_string();
            let pdf_bytes = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                crate::utils::typst::compile_typst_to_pdf_with_prebuilt(&source_owned, &prebuilt)
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. Escape it as '\\@' in .typ files (e.g., user\\@example.com).";
                }
                AppError::InternalError(msg)
            })?;
            std::fs::write(&file_path, pdf_bytes)
                .map_err(|e| AppError::InternalError(format!("Failed to write PDF: {}", e)))?;
            serde_json::json!({ "file_path": file_path, "message": format!("PDF saved to {}", file_path) }).to_string()
        }

        "compile_typst_file" => {
            let typ_path = args.get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'file_path' argument for compile_typst_file".to_string()))?;
            let output_dir = args.get("output_dir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'output_dir' argument for compile_typst_file".to_string()))?;

            let typ_path_buf = std::path::PathBuf::from(typ_path);
            let output_dir_buf = std::path::PathBuf::from(output_dir);
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();

            let (svg_string, pdf_bytes) = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                let templates_dir = crate::utils::typst::find_templates_dir();
                crate::utils::typst::compile_typst_file(
                    &typ_path_buf,
                    &prebuilt,
                    templates_dir.as_deref(),
                )
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("file not found") || e.contains("not found") && e.contains("@preview") {
                    msg += "\n\nAvailable bundled @preview packages: basic-resume:0.2.9, grotesk-cv:1.0.5, nabcv:0.1.0, brilliant-cv:3.3.0, calligraphics:1.0.0. Do NOT invent package names. Call Skill(\"resume\") to load the correct code examples for each template.";
                }
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. You MUST escape it as '\\@' inside .typ files (e.g., user\\@example.com). Do NOT escape @ in .toml files.";
                }
                AppError::InternalError(msg)
            })?;

            // Write PDF
            let pdf_path = output_dir_buf.join("resume.pdf");
            std::fs::create_dir_all(&output_dir_buf)
                .map_err(|e| AppError::InternalError(format!("Failed to create output dir: {}", e)))?;
            std::fs::write(&pdf_path, pdf_bytes)
                .map_err(|e| AppError::InternalError(format!("Failed to write PDF: {}", e)))?;

            // Write SVG preview
            let svg_path = output_dir_buf.join("resume-preview.svg");
            std::fs::write(&svg_path, &svg_string)
                .map_err(|e| AppError::InternalError(format!("Failed to write SVG: {}", e)))?;

            serde_json::json!({
                "pdf_path": pdf_path.to_string_lossy(),
                "svg_path": svg_path.to_string_lossy(),
                "svg": svg_string,
                "message": format!("Resume compiled successfully. PDF: {}", pdf_path.display())
            }).to_string()
        }

        // 第一层防御：unknown tool 返回合法 JSON，让 Claude 自己 fallback 到文本回复
        _ => {
            let supported_tools = vec![
                "read_file", "write_file", "append_file", "list_files", "path_exists",
                "create_directory", "code_execution", "search_files", "glob_search",
                "grep_files", "get_current_workspace",
                "browser_navigate", "browser_get_page", "browser_click", "browser_type",
                "browser_scroll", "browser_get_text", "browser_screenshot",
                "browser_extract_content", "browser_press_key", "browser_wait",
                "Skill", "render_typst_to_svg", "render_typst_to_pdf", "compile_typst_file"
            ];
            return Ok(serde_json::json!({
                "error": true,
                "message": format!(
                    "工具 '{}' 不存在或暂不支持。可用工具: {}",
                    tool_name,
                    supported_tools.join(", ")
                )
            }).to_string());
        }
    };

    Ok(result_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::actions;
    use crate::browser::actions::test_support::{CheckoutFlowServer, LiveActionHarness, load_page_state_fixture, FixtureActionHarness};
    use crate::browser::actions::ElementReference;
    use crate::browser::actions::common::BrowserActionError;
    use crate::browser::dom::InteractiveElement;
    use anyhow::Result as AnyhowResult;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn browser_target_from_args_accepts_navigation_id_aliases() {
        let args = serde_json::json!({
            "elementId": 7,
            "backendNodeId": 701,
            "navigationId": "nav-42"
        });

        let target = browser_target_from_args(&args, "browser_click").unwrap();

        assert_eq!(target, (Some(7), Some(701), Some("nav-42".to_string())));
    }

    #[test]
    fn parse_browser_wait_accepts_selector_aliases() {
        let args = serde_json::json!({
            "waitSelector": ".checkout-ready"
        });

        let call = parse_browser_chat_tool_call("browser_wait", &args)
            .unwrap()
            .unwrap();

        assert_eq!(call, BrowserChatToolCall::Wait {
            seconds: None,
            wait_selector: Some(".checkout-ready".to_string()),
        });
    }

    #[test]
    fn serialize_page_state_for_chat_emits_pretty_json() {
        let page_state = sample_page_state();

        let rendered = serialize_page_state_for_chat(&page_state);

        assert!(rendered.starts_with("{\n"));
        assert!(rendered.contains("\"navigation_id\": \"nav-42\""));
        assert!(rendered.contains("\"backend_node_id\": 101"));
        assert!(rendered.contains("\"warnings\": [\n    \"cross_origin_iframe_partial\"\n  ]"));
    }

    #[tokio::test]
    async fn browser_get_page_returns_pretty_json_through_chat_dispatcher() {
        let runtime = FakeBrowserChatRuntime::default();

        let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

        assert!(rendered.contains("\"title\": \"Dashboard\""));
        assert!(rendered.contains("\"backend_node_id\": 101"));
    }

    #[tokio::test]
    async fn browser_click_formats_backend_node_target_labels() {
        let runtime = FakeBrowserChatRuntime::default();
        let call = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 701,
                "navigationId": "nav-42"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(
            rendered,
            "已点击backend_node_id 701，页面可能已更新，请使用 browser_get_page 查看新状态"
        );
        assert_eq!(
            runtime.last_click_target.lock().unwrap().clone(),
            Some(BrowserToolTarget {
                element_id: None,
                backend_node_id: Some(701),
                navigation_id: Some("nav-42".to_string()),
            })
        );
    }

    #[tokio::test]
    async fn browser_type_reports_targeted_failures_for_chat_tools() {
        let runtime = FakeBrowserChatRuntime {
            type_result: Err("browser.page_state_stale".to_string()),
            ..FakeBrowserChatRuntime::default()
        };
        let call = parse_browser_chat_tool_call(
            "browser_type",
            &serde_json::json!({
                "element_id": 7,
                "backend_node_id": 701,
                "text": "hello"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(
            rendered,
            "ERROR: 向元素 7 / backend_node_id 701输入失败: browser.page_state_stale"
        );
    }

    #[tokio::test]
    async fn browser_get_page_maps_not_connected_errors_to_user_guidance() {
        let runtime = FakeBrowserChatRuntime {
            page_state_result: Err("Browser not connected".to_string()),
            ..FakeBrowserChatRuntime::default()
        };

        let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

        assert_eq!(rendered, browser_not_connected_message());
    }

    #[tokio::test]
    async fn browser_navigate_uses_page_state_title_after_resync_warning() {
        let runtime = FakeBrowserChatRuntime {
            resync_result: Err("page replaced".to_string()),
            ..FakeBrowserChatRuntime::default()
        };

        let rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Navigate {
                url: "https://example.com/checkout".to_string(),
                wait_selector: Some(".checkout-ready".to_string()),
            },
            &runtime,
        )
        .await;

        assert_eq!(rendered, "已导航到: https://example.com/checkout，页面标题: Dashboard");
    }

    #[tokio::test]
    async fn browser_type_retries_with_fresh_iframe_fixture_through_action_context_harness() {
        let runtime = FixtureBrowserChatRuntime::new(
            Some(load_page_state_fixture("iframe-retry-cache")),
            vec![load_page_state_fixture("iframe-shadow")],
        )
        .await;
        let call = parse_browser_chat_tool_call(
            "browser_type",
            &serde_json::json!({
                "backendNodeId": 310,
                "navigationId": "loader-root-1",
                "text": "4242"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(rendered, "输入成功: backend_node_id 310，共 4 个字符");
        assert_eq!(runtime.capture_count().await, 1);
        assert_eq!(
            runtime.last_resolved_element().as_ref().map(|element| element.frame_id.as_str()),
            Some("frame-checkout")
        );
    }

    #[tokio::test]
    async fn browser_click_recovers_after_refreshing_navigation_id_from_browser_get_page() {
        let refreshed_page_state = load_page_state_fixture("navigation-refresh");
        let runtime = FixtureBrowserChatRuntime::new(
            Some(refreshed_page_state.clone()),
            vec![refreshed_page_state.clone(), refreshed_page_state.clone()],
        )
        .await;
        let stale_click = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 200,
                "navigationId": "loader-root-1"
            }),
        )
        .unwrap()
        .unwrap();

        let stale_rendered = execute_browser_chat_tool_call(stale_click, &runtime).await;

        assert!(stale_rendered.contains("browser.page_state_stale"));
        assert!(stale_rendered.contains("loader-root-2"));

        let page_state_json = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
        assert!(page_state_json.contains("\"navigation_id\": \"loader-root-2\""));
        assert!(page_state_json.contains("\"title\": \"Review Order\""));

        let fresh_click = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 200,
                "navigationId": "loader-root-2"
            }),
        )
        .unwrap()
        .unwrap();

        let fresh_rendered = execute_browser_chat_tool_call(fresh_click, &runtime).await;

        assert_eq!(
            fresh_rendered,
            "已点击backend_node_id 200，页面可能已更新，请使用 browser_get_page 查看新状态"
        );
        assert_eq!(runtime.capture_count().await, 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn live_browser_chat_tools_render_shadow_success_messages() -> AnyhowResult<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let live_result = async {
            let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
            let navigate_url = server.shadow_checkout_url();
            let navigate_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Navigate {
                    url: navigate_url.clone(),
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert_eq!(
                navigate_rendered,
                format!("已导航到: {}，页面标题: Shadow Checkout Flow", navigate_url)
            );

            let page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            let shadow_input = find_live_element(&page_state, "shadow chat input", |element| {
                element.frame_id != "root"
                    && element.is_editable
                    && element.selector_hint.as_deref() == Some("#shadow-card-number")
            })?;
            let shadow_button = find_live_element(&page_state, "shadow chat button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.tag_name.as_deref() == Some("button")
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

            let get_page_rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
            assert!(get_page_rendered.contains("\"title\": \"Shadow Checkout Flow\""));
            assert!(get_page_rendered.contains("\"selector_hint\": \"#shadow-confirm-payment\""));

            let typed_value = "7777 8888 9999 0000".to_string();
            let type_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_type",
                    &serde_json::json!({
                        "backendNodeId": shadow_input.backend_node_id,
                        "navigationId": page_state.navigation_id,
                        "text": typed_value,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert_eq!(
                type_rendered,
                format!(
                    "输入成功: backend_node_id {}，共 {} 个字符",
                    shadow_input.backend_node_id,
                    19
                )
            );

            let click_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_click",
                    &serde_json::json!({
                        "backendNodeId": shadow_button.backend_node_id,
                        "navigationId": page_state.navigation_id,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert_eq!(
                click_rendered,
                format!(
                    "已点击backend_node_id {}，页面可能已更新，请使用 browser_get_page 查看新状态",
                    shadow_button.backend_node_id
                )
            );

            let wait_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Wait {
                    seconds: None,
                    wait_selector: Some("#payment-status.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(wait_rendered.starts_with("等待完成，目标选择器已出现（"));

            let status_text = read_selector_text_live(&harness, "#payment-status").await?;
            assert!(status_text.contains("confirmed:"));
            assert!(status_text.contains("7777"));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        live_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn live_browser_chat_tools_map_shadow_stale_navigation_errors() -> AnyhowResult<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let live_result = async {
            let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
            let navigate_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Navigate {
                    url: server.shadow_checkout_url(),
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(navigate_rendered.contains("Shadow Checkout Flow"));

            let stale_page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            let stale_button = find_live_element(&stale_page_state, "stale shadow button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

            harness.page().reload().await.map_err(anyhow::Error::from)?;

            let reload_wait_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Wait {
                    seconds: None,
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(reload_wait_rendered.starts_with("等待完成，目标选择器已出现（"));

            let refreshed_page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            assert_ne!(refreshed_page_state.navigation_id, stale_page_state.navigation_id);

            let stale_click_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_click",
                    &serde_json::json!({
                        "backendNodeId": stale_button.backend_node_id,
                        "navigationId": stale_page_state.navigation_id,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert!(stale_click_rendered.contains(&format!("ERROR: 点击backend_node_id {}失败:", stale_button.backend_node_id)));
            assert!(stale_click_rendered.contains("browser.page_state_stale"));
            assert!(stale_click_rendered.contains(&refreshed_page_state.navigation_id));

            let get_page_rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
            assert!(get_page_rendered.contains(&format!("\"navigation_id\": \"{}\"", refreshed_page_state.navigation_id)));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        live_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    fn find_live_element<F>(
        page_state: &PageState,
        label: &str,
        predicate: F,
    ) -> AnyhowResult<InteractiveElement>
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

    async fn read_selector_text_live(harness: &LiveActionHarness, selector: &str) -> AnyhowResult<String> {
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

    fn sample_page_state() -> PageState {
        PageState {
            url: "https://example.com/dashboard".to_string(),
            title: "Dashboard".to_string(),
            navigation_id: "nav-42".to_string(),
            frame_count: 2,
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

    struct FixtureBrowserChatRuntime {
        harness: FixtureActionHarness,
        last_resolved_element: StdMutex<Option<InteractiveElement>>,
    }

    impl FixtureBrowserChatRuntime {
        async fn new(cached_page_state: Option<PageState>, queued_page_states: Vec<PageState>) -> Self {
            Self {
                harness: FixtureActionHarness::new(cached_page_state, queued_page_states).await,
                last_resolved_element: StdMutex::new(None),
            }
        }

        async fn capture_count(&self) -> usize {
            self.harness.capture_count().await
        }

        fn last_resolved_element(&self) -> Option<InteractiveElement> {
            self.last_resolved_element.lock().unwrap().clone()
        }

        fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
            ElementReference {
                index: target.element_id,
                backend_node_id: target.backend_node_id,
                navigation_id: target.navigation_id.clone(),
            }
        }

        async fn resolve_target(&self, target: &BrowserToolTarget) -> Result<InteractiveElement, String> {
            let element = self
                .harness
                .resolve_element(Self::to_element_reference(target))
                .await
                .map_err(|error| error.to_string())?;
            *self.last_resolved_element.lock().unwrap() = Some(element.clone());
            Ok(element)
        }
    }

    struct LiveHarnessBrowserChatRuntime<'a> {
        harness: &'a LiveActionHarness,
    }

    impl<'a> LiveHarnessBrowserChatRuntime<'a> {
        fn new(harness: &'a LiveActionHarness) -> Self {
            Self { harness }
        }

        fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
            ElementReference {
                index: target.element_id,
                backend_node_id: target.backend_node_id,
                navigation_id: target.navigation_id.clone(),
            }
        }
    }

    struct FakeBrowserChatRuntime {
        navigate_result: Result<(), String>,
        resync_result: Result<(), String>,
        page_state_result: Result<PageState, String>,
        click_result: Result<String, String>,
        type_result: Result<String, String>,
        scroll_result: Result<String, String>,
        text_result: Result<String, String>,
        screenshot_result: Result<String, String>,
        extract_result: Result<String, String>,
        press_key_result: Result<String, String>,
        wait_result: Result<String, String>,
        last_click_target: StdMutex<Option<BrowserToolTarget>>,
    }

    impl Default for FakeBrowserChatRuntime {
        fn default() -> Self {
            Self {
                navigate_result: Ok(()),
                resync_result: Ok(()),
                page_state_result: Ok(sample_page_state()),
                click_result: Ok("clicked".to_string()),
                type_result: Ok("输入成功: backend_node_id 701，共 5 个字符".to_string()),
                scroll_result: Ok("scrolled".to_string()),
                text_result: Ok("Page content".to_string()),
                screenshot_result: Ok("base64-image".to_string()),
                extract_result: Ok("structured content".to_string()),
                press_key_result: Ok("pressed".to_string()),
                wait_result: Ok("等待完成，目标选择器已出现（250ms）".to_string()),
                last_click_target: StdMutex::new(None),
            }
        }
    }

    #[async_trait]
    impl BrowserChatRuntime for FakeBrowserChatRuntime {
        async fn navigate_and_wait(&self, _url: String, _wait_selector: Option<String>) -> Result<(), String> {
            self.navigate_result.clone()
        }

        async fn resync_page(&self) -> Result<(), String> {
            self.resync_result.clone()
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            self.page_state_result.clone()
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            *self.last_click_target.lock().unwrap() = Some(target.clone());
            self.click_result.clone()
        }

        async fn type_text(&self, _target: &BrowserToolTarget, _text: String) -> Result<String, String> {
            self.type_result.clone()
        }

        async fn scroll(&self, _direction: String, _pixels: i64) -> Result<String, String> {
            self.scroll_result.clone()
        }

        async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
            self.text_result.clone()
        }

        async fn screenshot(&self) -> Result<String, String> {
            self.screenshot_result.clone()
        }

        async fn extract_content(&self) -> Result<String, String> {
            self.extract_result.clone()
        }

        async fn press_key(&self, _key: String) -> Result<String, String> {
            self.press_key_result.clone()
        }

        async fn wait(&self, _seconds: Option<u64>, _wait_selector: Option<String>) -> Result<String, String> {
            self.wait_result.clone()
        }

        async fn delay_after_click(&self) {}
    }

    #[async_trait]
    impl BrowserChatRuntime for FixtureBrowserChatRuntime {
        async fn navigate_and_wait(&self, _url: String, _wait_selector: Option<String>) -> Result<(), String> {
            Ok(())
        }

        async fn resync_page(&self) -> Result<(), String> {
            Ok(())
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            crate::browser::actions::get_page_state(self.harness.ctx())
                .await
                .map_err(|error| error.to_string())
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            let element = self.resolve_target(target).await?;
            if !element.is_visible || !element.is_clickable {
                return Err(BrowserActionError::element_not_interactable(format!(
                    "{} is not a visible clickable element.",
                    Self::to_element_reference(target).description()
                ))
                .to_string());
            }

            Ok(format!(
                "点击成功: backend_node_id {}{}",
                element.backend_node_id,
                element
                    .tag_name
                    .as_ref()
                    .map(|tag| format!(" <{}>", tag))
                    .unwrap_or_default()
            ))
        }

        async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String> {
            let element = self.resolve_target(target).await?;
            if !element.is_visible || !element.is_editable {
                return Err(BrowserActionError::element_not_interactable(format!(
                    "{} is not an editable visible element.",
                    Self::to_element_reference(target).description()
                ))
                .to_string());
            }

            Ok(format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                element.backend_node_id,
                text.chars().count()
            ))
        }

        async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
            Ok(format!("滚动: {} {}px", direction, pixels))
        }

        async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
            Ok(String::new())
        }

        async fn screenshot(&self) -> Result<String, String> {
            Ok("fixture-screenshot".to_string())
        }

        async fn extract_content(&self) -> Result<String, String> {
            Ok("fixture-content".to_string())
        }

        async fn press_key(&self, key: String) -> Result<String, String> {
            Ok(format!("已按下键 '{}'", key))
        }

        async fn wait(&self, seconds: Option<u64>, wait_selector: Option<String>) -> Result<String, String> {
            if wait_selector.is_some() {
                Ok("等待完成，目标选择器已出现（0ms）".to_string())
            } else {
                Ok(format!("已等待 {} 秒", seconds.unwrap_or(2)))
            }
        }

        async fn delay_after_click(&self) {}
    }

    #[async_trait]
    impl BrowserChatRuntime for LiveHarnessBrowserChatRuntime<'_> {
        async fn navigate_and_wait(&self, url: String, wait_selector: Option<String>) -> Result<(), String> {
            actions::navigate(
                self.harness.ctx(),
                actions::NavigateInput {
                    url: Some(url),
                    wait_selector,
                    timeout_ms: None,
                },
            )
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
        }

        async fn resync_page(&self) -> Result<(), String> {
            Ok(())
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            actions::get_page_state(self.harness.ctx())
                .await
                .map_err(|error| error.to_string())
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            let output = actions::click(
                self.harness.ctx(),
                actions::ClickInput {
                    target: Self::to_element_reference(target),
                },
            )
            .await
            .map_err(|error| error.to_string())?;

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

        async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String> {
            let text_len = text.chars().count();
            let output = actions::type_text(
                self.harness.ctx(),
                actions::TypeTextInput {
                    target: Self::to_element_reference(target),
                    text,
                },
            )
            .await
            .map_err(|error| error.to_string())?;

            Ok(format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                output.backend_node_id, text_len
            ))
        }

        async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
            actions::scroll(self.harness.ctx(), actions::ScrollInput { direction, pixels })
                .await
                .map(|_| "ok".to_string())
                .map_err(|error| error.to_string())
        }

        async fn get_text(&self, max_length: Option<u64>) -> Result<String, String> {
            actions::get_text_content(
                self.harness.ctx(),
                actions::GetTextContentInput {
                    max_length: max_length.unwrap_or(3_000) as usize,
                },
            )
            .await
            .map_err(|error| error.to_string())
        }

        async fn screenshot(&self) -> Result<String, String> {
            actions::screenshot(self.harness.ctx())
                .await
                .map(|screenshot| screenshot.value)
                .map_err(|error| error.to_string())
        }

        async fn extract_content(&self) -> Result<String, String> {
            actions::extract_content(self.harness.ctx(), actions::ExtractContentInput)
                .await
                .map_err(|error| error.to_string())
        }

        async fn press_key(&self, key: String) -> Result<String, String> {
            actions::press_key(self.harness.ctx(), actions::PressKeyInput { key })
                .await
                .map(|output| format!("已按下键 '{}'", output.key))
                .map_err(|error| error.to_string())
        }

        async fn wait(&self, seconds: Option<u64>, wait_selector: Option<String>) -> Result<String, String> {
            let output = actions::wait(
                self.harness.ctx(),
                actions::WaitInput {
                    seconds,
                    wait_selector,
                    timeout_ms: None,
                },
            )
            .await
            .map_err(|error| error.to_string())?;

            if output.selector_matched {
                Ok(format!("等待完成，目标选择器已出现（{}ms）", output.waited_ms))
            } else {
                Ok(format!("已等待 {} 秒", output.waited_ms / 1_000))
            }
        }

        async fn delay_after_click(&self) {}
    }
}
