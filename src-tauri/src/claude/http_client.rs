use tauri::Window;
use crate::utils::AppResult;

use super::http::{
    build_http_client, send_request_impl, send_streaming_request, validate_messages,
    ClaudeHttpError,
};
use super::message::{ChatResponse, Message};
use super::provider::ProviderCapabilities;

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
        response_format: Option<serde_json::Value>,
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
            None,
            None,
            response_format,
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
        provider_hint: Option<String>,
        api_format_hint: Option<String>,
        provider_capabilities: Option<ProviderCapabilities>,
        response_format: Option<serde_json::Value>,
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
            provider_hint.as_deref(),
            api_format_hint.as_deref(),
            provider_capabilities,
            response_format,
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
    provider_hint: Option<&str>,
    api_format_hint: Option<&str>,
    provider_capabilities: Option<ProviderCapabilities>,
    response_format: Option<serde_json::Value>,
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
        provider_hint,
        api_format_hint,
        provider_capabilities,
        response_format,
    )
    .await
}
