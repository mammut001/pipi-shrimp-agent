use crate::browser::dom::PageState;
use crate::commands::web::BrowserController;
/**
 * Chat commands
 *
 * Handles chat session management and message sending using SQLite
 */
use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::services::chat::browser_tool_service::{
    execute_browser_chat_tool_call, parse_browser_chat_tool_call, BrowserChatRuntime,
    BrowserToolTarget,
};
use crate::services::chat::session_service::{
    delete_session_service, get_session_service, list_sessions_service,
    reset_token_estimate_service, save_message_to_db_service, send_message_service,
    start_session_service, update_session_cwd_service, update_session_title_service,
};
use crate::commands::legacy_execute_tool::{
    build_legacy_tool_request, is_legacy_chat_only_tool, reject_legacy_execute_tool,
    LEGACY_EXECUTE_TOOL_DISABLED_MSG,
};
use crate::commands::tools::ToolRegistryState;
use crate::tools::ToolExecutionSource;
use crate::utils::{AppError, AppResult};
use async_trait::async_trait;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

mod legacy_tool_dispatch;

pub use crate::services::chat::session_service::SessionData;

#[cfg(test)]
use crate::services::chat::browser_tool_service::{
    browser_not_connected_message, browser_target_from_args, serialize_page_state_for_chat,
    BrowserChatToolCall,
};

/**
 * Start a new chat session
 *
 * Creates a new session in SQLite database
 */
#[tauri::command]
pub async fn start_session(_app: AppHandle) -> AppResult<String> {
    start_session_service().await
}

/**
 * Send a message to the chat
 *
 * Saves message to database and returns assistant's response
 */
#[tauri::command]
pub async fn send_message(
    _app: AppHandle,
    req: SendMessageRequest,
) -> AppResult<SendMessageResponse> {
    send_message_service(req).await
}

/**
 * Save a message to database (called from frontend after streaming)
 */
#[allow(dead_code)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_message_to_db(
    _app: AppHandle,
    session_id: String,
    role: String,
    content: String,
    reasoning: Option<String>,
    attachments: Option<String>,
    artifacts: Option<String>,
    tool_calls: Option<String>,
    token_usage: Option<String>,
) -> AppResult<String> {
    save_message_to_db_service(
        session_id,
        role,
        content,
        reasoning,
        attachments,
        artifacts,
        tool_calls,
        token_usage,
    )
    .await
}

/**
 * Get a session by ID
 *
 * Returns the session data with messages from database
 */
#[tauri::command]
pub async fn get_session(_app: AppHandle, session_id: String) -> AppResult<String> {
    get_session_service(session_id).await
}

/**
 * List all sessions
 *
 * Returns all session IDs and their basic info (without messages)
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn list_sessions(_app: AppHandle) -> AppResult<Vec<SessionData>> {
    list_sessions_service().await
}

/**
 * Delete a session
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn delete_session(_app: AppHandle, session_id: String) -> AppResult<()> {
    delete_session_service(session_id).await
}

/**
 * Delete all token usage records
 */
#[tauri::command]
pub async fn reset_token_estimate(_app: AppHandle) -> AppResult<()> {
    reset_token_estimate_service().await
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
    update_session_title_service(session_id, title).await
}

/**
 * Update session working directory
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn update_session_cwd(_app: AppHandle, session_id: String, cwd: String) -> AppResult<()> {
    update_session_cwd_service(session_id, cwd).await
}


/// Resolve a typst source/destination path under the bound work_dir (R2-05).
/// Same sandbox as write_file_for_tool / read_file_for_tool.
fn resolve_typst_path(path: &str, work_dir: Option<&str>) -> AppResult<std::path::PathBuf> {
    crate::commands::file::resolve_path(path, work_dir)
}

/**
 * Legacy chat-scoped tool entry point (browser, Typst, Skill).
 *
 * Registry-backed tools are rejected here (R2-01). Production callers must
 * use `execute_single_tool` or `execute_tool_batch`.
 */
#[tauri::command]
pub async fn execute_tool(
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    browser_state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
    font_state: tauri::State<'_, crate::FontDbState>,
    state: tauri::State<'_, ToolRegistryState>,
    #[allow(non_snake_case)] toolCallId: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    source: Option<ToolExecutionSource>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] apiKey: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    provider: Option<String>,
    #[allow(non_snake_case)] apiFormat: Option<String>,
    #[allow(non_snake_case)] providerCapabilities: Option<
        crate::claude::provider::ProviderCapabilities,
    >,
) -> AppResult<String> {
    legacy_tool_dispatch::execute_tool_impl(
        tool_name,
        arguments,
        work_dir,
        browser_state,
        font_state,
        state,
        toolCallId,
        sessionId,
        approvalToken,
        source,
        executionMode,
        apiKey,
        model,
        baseUrl,
        provider,
        apiFormat,
        providerCapabilities,
    )
    .await
}
#[cfg(test)]
#[path = "chat/test_support.rs"]
mod test_support;

#[cfg(test)]
#[path = "chat/tests.rs"]
mod tests;
