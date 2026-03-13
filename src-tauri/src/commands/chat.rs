/**
 * Chat commands
 *
 * Handles chat session management and message sending
 */

use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::utils::AppResult;
use uuid::Uuid;

/**
 * Start a new chat session
 *
 * Returns the new session ID
 */
#[tauri::command]
pub async fn start_session() -> AppResult<String> {
    let session_id = Uuid::new_v4().to_string();
    // TODO: Save session to storage
    Ok(session_id)
}

/**
 * Send a message to the chat
 *
 * Takes a message request and returns the assistant's response
 */
#[tauri::command]
pub async fn send_message(_req: SendMessageRequest) -> AppResult<SendMessageResponse> {
    // TODO: Call Claude SDK with the message
    Ok(SendMessageResponse {
        id: Uuid::new_v4().to_string(),
        content: "Hello from Rust!".to_string(),
        artifacts: vec![],
    })
}

/**
 * Get a session by ID
 *
 * Returns the session data as JSON
 */
#[tauri::command]
pub async fn get_session(session_id: String) -> AppResult<String> {
    // TODO: Load session from storage
    let _ = session_id; // Suppress unused warning
    Ok("{}".to_string())
}
