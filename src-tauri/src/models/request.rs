/**
 * Request models for Tauri commands
 *
 * Defines all request types that can be received from the frontend
 */

use serde::Deserialize;

/**
 * Request to send a chat message
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SendMessageRequest {
    pub session_id: String,
    pub content: String,
}

/**
 * Request to execute code
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ExecuteCodeRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub language: Option<String>, // bash, python, node
}

/**
 * Request to read a file
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ReadFileRequest {
    pub path: String,
}

/**
 * Request to write a file
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

/**
 * Request for web automation
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct WebAutomationRequest {
    pub url: String,
    pub actions: Vec<String>, // e.g. ["click_button", "fill_input"]
}

/**
 * Request to execute a Claude command
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ClaudeExecuteRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub timeout: Option<u64>,
}

/**
 * Request to chat with Claude
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ClaudeChatRequest {
    pub message: String,
    pub system_prompt: Option<String>,
    pub history: Option<Vec<ChatMessageInput>>,
}

/**
 * Chat message input
 */
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ChatMessageInput {
    pub role: String,
    pub content: String,
}
