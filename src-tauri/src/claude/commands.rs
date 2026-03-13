#![allow(dead_code)]

/**
 * Claude Commands Module
 *
 * Tauri commands for Claude Code integration
 */

use crate::claude::client::{ClaudeClient, ClaudeCommandRequest, ClaudeChatRequest, ChatMessage};
use crate::models::request::{ClaudeExecuteRequest, ClaudeChatRequest as TauriClaudeChatRequest};
use crate::models::response::{ClaudeExecuteResponse, ClaudeChatResponse};
use std::collections::HashMap;
use std::sync::Mutex;

/// Claude client state
pub struct ClaudeState {
    client: Mutex<Option<ClaudeClient>>,
}

impl Default for ClaudeState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }
}

/// Check if Claude Code is available
#[tauri::command]
pub fn check_claude_available() -> Result<bool, String> {
    let client = ClaudeClient::new();
    Ok(client.is_available())
}

/// Get Claude Code version
#[tauri::command]
pub fn get_claude_version() -> Result<Option<String>, String> {
    let client = ClaudeClient::new();
    Ok(client.get_version())
}

/// Execute a Claude command
#[tauri::command]
pub fn execute_claude_command(
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout: Option<u64>,
) -> Result<String, String> {
    let client = ClaudeClient::new();

    let request = ClaudeCommandRequest {
        command,
        cwd,
        env,
        timeout,
    };

    client.execute_command(request)
        .map_err(|e| e.to_string())
}

/// Send a chat message to Claude
#[tauri::command]
pub fn send_claude_chat(
    message: String,
    system_prompt: Option<String>,
    history: Option<Vec<ChatMessage>>,
) -> Result<String, String> {
    let client = ClaudeClient::new();

    let request = ClaudeChatRequest {
        message,
        system_prompt,
        history,
    };

    client.chat(request)
        .map_err(|e| e.to_string())
}

/// Execute Claude with prompt from request
#[tauri::command]
pub fn claude_execute(
    request: ClaudeExecuteRequest,
) -> Result<ClaudeExecuteResponse, String> {
    let client = ClaudeClient::new();

    let cmd_request = ClaudeCommandRequest {
        command: request.command,
        cwd: request.cwd,
        env: request.env,
        timeout: request.timeout,
    };

    let output = client.execute_command(cmd_request)
        .map_err(|e| e.to_string())?;

    Ok(ClaudeExecuteResponse {
        success: true,
        output,
        error: None,
    })
}

/// Chat with Claude using request model
#[tauri::command]
pub fn claude_chat(
    request: TauriClaudeChatRequest,
) -> Result<ClaudeChatResponse, String> {
    let client = ClaudeClient::new();

    let chat_request = ClaudeChatRequest {
        message: request.message,
        system_prompt: request.system_prompt,
        history: request.history.map(|h| {
            h.into_iter().map(|m| ChatMessage {
                role: m.role,
                content: m.content,
            }).collect()
        }),
    };

    let response = client.chat(chat_request)
        .map_err(|e| e.to_string())?;

    Ok(ClaudeChatResponse {
        message: response,
    })
}
