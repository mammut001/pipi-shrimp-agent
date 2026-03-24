/**
 * Chat commands
 *
 * Handles chat session management and message sending using SQLite
 */

use crate::database::{self, DbSession, DbMessage};
use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};

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
#[tauri::command]
pub async fn save_message_to_db(
    _app: AppHandle,
    session_id: String,
    role: String,
    content: String,
    reasoning: Option<String>,
    artifacts: Option<String>,
    tool_calls: Option<String>,
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
#[tauri::command]
pub async fn delete_session(_app: AppHandle, session_id: String) -> AppResult<()> {
    database::delete_session(&session_id)
        .map_err(|e| AppError::InternalError(format!("Failed to delete session: {}", e)))?;

    println!("🗑️ Deleted session: {}", session_id);
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
) -> AppResult<String> {
    println!("🔧 Executing tool: {} with args: {}", tool_name, arguments);

    // Parse arguments from JSON string
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::InternalError(format!("Invalid tool arguments: {}", e)))?;

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
        // 第一层防御：unknown tool 返回合法 JSON，让 Claude 自己 fallback 到文本回复
        _ => {
            let supported_tools = vec![
                "read_file", "write_file", "append_file", "list_files", "path_exists",
                "create_directory", "code_execution", "search_files", "glob_search",
                "grep_files", "get_current_workspace"
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
