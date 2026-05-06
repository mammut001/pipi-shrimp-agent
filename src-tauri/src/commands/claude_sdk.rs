use std::sync::Arc;

use tauri::Window;
use tokio::sync::Mutex;

use crate::claude::{self, ChatResponse, ClaudeClient, Message};

/// State for the Claude-compatible SDK client.
pub struct ClaudeState {
    pub client: ClaudeClient,
}

/// Send a chat message using Claude SDK (Anthropic API).
#[tauri::command]
pub async fn send_claude_sdk_chat(
    messages: Vec<Message>,
    api_key: String,
    model: String,
    base_url: Option<String>,
    system_prompt: Option<String>,
    #[allow(non_snake_case)] allowBrowserTools: Option<bool>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<ChatResponse, String> {
    let base_url = base_url.filter(|s| !s.is_empty());
    let allow_browser_tools = allowBrowserTools.unwrap_or(false);
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };

    client
        .chat(
            messages,
            api_key,
            model,
            base_url,
            system_prompt,
            allow_browser_tools,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Send a chat message using Claude SDK with streaming events.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_claude_sdk_chat_streaming(
    messages: Vec<Message>,
    #[allow(non_snake_case)] apiKey: String,
    model: String,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    #[allow(non_snake_case)] systemPrompt: Option<String>,
    #[allow(non_snake_case)] noTools: Option<bool>,
    #[allow(non_snake_case)] allowBrowserTools: Option<bool>,
    #[allow(non_snake_case)] sessionId: String,
    apiFormat: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
    window: Window,
) -> Result<ChatResponse, String> {
    let base_url = baseUrl.filter(|s| !s.is_empty());
    let no_tools = noTools.unwrap_or(false);
    let allow_browser_tools = allowBrowserTools.unwrap_or(false);
    let api_format = apiFormat.filter(|s| !s.is_empty());
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };

    client
        .chat_streaming(
            messages,
            apiKey,
            model,
            base_url,
            systemPrompt,
            no_tools,
            window,
            allow_browser_tools,
            sessionId,
            api_format,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Stop the current running request (cancel generation).
#[tauri::command]
#[allow(non_snake_case)]
pub async fn stop_subprocess(sessionId: Option<String>) -> Result<(), String> {
    claude::stop_current_request(sessionId)
        .await
        .map_err(|e| e.to_string())
}

/// Test API connection against the active provider settings.
#[tauri::command]
pub async fn test_connection(
    #[allow(non_snake_case)] apiKey: String,
    model: String,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<bool, String> {
    let base_url = baseUrl.filter(|s| !s.is_empty());
    let messages = vec![Message {
        role: "user".to_string(),
        content: "Hi".to_string(),
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
    }];
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };

    match client.chat(messages, apiKey, model, base_url, None, false).await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}
