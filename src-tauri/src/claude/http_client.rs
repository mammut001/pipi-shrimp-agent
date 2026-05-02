use tauri::Window;
use crate::utils::AppResult;

use super::http::{
    build_http_client, send_request_impl, send_streaming_request, validate_messages,
    ClaudeHttpError,
};
use super::message::{ChatResponse, Message};

pub use super::http::{has_running_request, stop_current_request};

/// Claude HTTP client using reqwest.
#[derive(Clone)]
pub struct ClaudeClient {
    client: reqwest::Client,
}

impl ClaudeClient {
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
        }
    }

    pub async fn chat(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
        allow_browser_tools: bool,
    ) -> AppResult<ChatResponse> {
        let normalized = validate_messages(messages, "chat")?;

        send_request(
            &self.client,
            &normalized,
            &api_key,
            &model,
            base_url.as_deref(),
            system_prompt.as_deref(),
            false,
            false,
            None,
            allow_browser_tools,
            None,
            None,
        )
        .await
        .map_err(Into::into)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn chat_streaming(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
        no_tools: bool,
        window: Window,
        allow_browser_tools: bool,
        session_id: String,
        api_format_hint: Option<String>,
    ) -> AppResult<ChatResponse> {
        let normalized = validate_messages(messages, "chat_streaming")?;

        send_streaming_request(
            &self.client,
            &normalized,
            &api_key,
            &model,
            base_url.as_deref(),
            system_prompt.as_deref(),
            no_tools,
            window,
            allow_browser_tools,
            &session_id,
            api_format_hint.as_deref(),
        )
        .await
        .map_err(Into::into)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn send_request(
    client: &reqwest::Client,
    messages: &[Message],
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system_prompt: Option<&str>,
    streaming: bool,
    no_tools: bool,
    window: Option<Window>,
    allow_browser_tools: bool,
    session_id: Option<&str>,
    api_format_hint: Option<&str>,
) -> Result<ChatResponse, ClaudeHttpError> {
    send_request_impl(
        client,
        messages,
        api_key,
        model,
        base_url,
        system_prompt,
        streaming,
        no_tools,
        window,
        allow_browser_tools,
        session_id,
        api_format_hint,
    )
}
