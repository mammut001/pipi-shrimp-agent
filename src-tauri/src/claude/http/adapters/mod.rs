use crate::claude::message::{Artifact, ChatResponse, Message, ToolCall, UsageInfo};
use crate::claude::provider::{ApiFormat, ProviderId, ResolvedProviderConfig};
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};

mod anthropic;
mod openai;

pub use anthropic::AnthropicAdapter;
pub use openai::OpenAIAdapter;

/// Unified streaming events emitted to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum StreamEvent {
    Token(String),
    Reasoning(String),
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    ToolCallComplete { id: String, name: String },
    Artifact(Artifact),
    Usage {
        input_tokens: i32,
        output_tokens: i32,
    },
    Error(String),
    Done,
}

/// Context for streaming responses.
#[derive(Debug)]
pub struct StreamContext {
    pub estimated_input: i32,
    pub window: Option<Window>,
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    #[allow(dead_code)]
    pub artifacts: Vec<Artifact>,
    pub usage: UsageInfo,
    pub model: String,
    pub session_id: Option<String>,
    pub in_think_tag: bool,
    pub emitted_tool_calls: usize,
}

impl StreamContext {
    pub fn new(estimated_input: i32, window: Option<Window>, session_id: Option<String>) -> Self {
        Self {
            estimated_input,
            window,
            content: String::new(),
            reasoning: String::new(),
            tool_calls: Vec::new(),
            artifacts: Vec::new(),
            usage: UsageInfo {
                input_tokens: estimated_input,
                output_tokens: 0,
            },
            model: String::new(),
            session_id,
            in_think_tag: false,
            emitted_tool_calls: 0,
        }
    }

    pub fn emit_token(&self, content: &str) {
        if let Some(ref window) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "content": content,
            });
            let _ = window.emit("claude-token", payload);
        }
    }

    pub fn emit_reasoning(&self, content: &str) {
        if let Some(ref window) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "content": content,
            });
            let _ = window.emit("claude-reasoning", payload);
        }
    }

    pub fn emit_tool_use(&self, tool_call_id: &str, name: &str, arguments: &str) {
        if let Some(ref window) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "tool_call_id": tool_call_id,
                "name": name,
                "arguments": arguments,
            });
            let _ = window.emit("claude-tool-use", payload);
        }
    }

    pub fn emit_usage(&self) {
        if let Some(ref window) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "input_tokens": self.usage.input_tokens,
                "output_tokens": self.usage.output_tokens,
            });
            let _ = window.emit("claude-usage", payload);
        }
    }

    pub fn has_unfinalized_tool_calls(&self) -> bool {
        self.emitted_tool_calls < self.tool_calls.len()
    }

    pub fn emit_pending_tool_calls(&mut self) -> AppResult<Vec<StreamEvent>> {
        let mut events = Vec::new();
        let start_index = self.emitted_tool_calls;

        for pending_offset in 0..(self.tool_calls.len().saturating_sub(start_index)) {
            let tool_index = start_index + pending_offset;
            let tool_call = &mut self.tool_calls[tool_index];
            finalize_pending_tool_call(tool_call, tool_index)?;

            let tool_call_id = tool_call.tool_call_id.clone();
            let name = tool_call.name.clone();
            let arguments = tool_call.arguments.clone();

            self.emit_tool_use(&tool_call_id, &name, &arguments);
            events.push(StreamEvent::ToolCall {
                id: tool_call_id.clone(),
                name: name.clone(),
                arguments: arguments.clone(),
            });
            events.push(StreamEvent::ToolCallComplete {
                id: tool_call_id,
                name,
            });
        }

        self.emitted_tool_calls = self.tool_calls.len();
        Ok(events)
    }
}

fn finalize_pending_tool_call(tool_call: &mut ToolCall, fallback_index: usize) -> AppResult<()> {
    let name = tool_call.name.trim();
    if name.is_empty() {
        return Err(AppError::ProcessError(
            "malformed_tool_call: Missing function name in streamed tool call.".to_string(),
        ));
    }

    let arguments = tool_call.arguments.trim();
    if arguments.is_empty() {
        return Err(AppError::ProcessError(format!(
            "malformed_tool_call: Missing JSON arguments for streamed tool call '{}'.",
            name
        )));
    }

    let parsed_arguments = serde_json::from_str::<serde_json::Value>(arguments).map_err(|error| {
        AppError::ProcessError(format!(
            "malformed_tool_call: Incomplete or invalid JSON arguments for streamed tool call '{}': {}",
            name, error
        ))
    })?;

    if !parsed_arguments.is_object() {
        return Err(AppError::ProcessError(format!(
            "malformed_tool_call: Streamed tool call '{}' arguments must decode to a JSON object.",
            name
        )));
    }

    if tool_call.tool_call_id.trim().is_empty() {
        tool_call.tool_call_id = format!("generated_tool_call_{}", fallback_index);
    }

    Ok(())
}

/// Provider adapter trait implemented by each protocol family.
pub trait ProviderAdapter: Send + Sync {
    #[allow(dead_code)]
    fn provider_id(&self) -> ProviderId;

    #[allow(dead_code)]
    fn api_format(&self) -> ApiFormat;

    fn build_url(&self, config: &ResolvedProviderConfig) -> String;

    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap;

    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value;

    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value;

    fn parse_response(
        &self,
        body: serde_json::Value,
        config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse>;

    fn parse_stream_chunk(
        &self,
        data: &str,
        ctx: &mut StreamContext,
    ) -> AppResult<Vec<StreamEvent>>;

    fn finalize_stream(
        &self,
        mut ctx: StreamContext,
        _config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        let artifacts = detect_artifacts(&ctx.content);

        if ctx.usage.input_tokens == 0 {
            ctx.usage.input_tokens = ctx.estimated_input;
        }

        Ok(ChatResponse {
            content: ctx.content,
            artifacts,
            model: ctx.model,
            usage: ctx.usage,
            tool_calls: ctx.tool_calls,
        })
    }

    #[allow(dead_code)]
    fn get_max_tokens(&self, config: &ResolvedProviderConfig) -> i32 {
        if config.capabilities.supports_thinking {
            config.capabilities.thinking_budget.unwrap_or(5000) + 1000
        } else {
            2048
        }
    }
}

pub fn detect_artifacts(content: &str) -> Vec<Artifact> {
    super::request_builder::detect_artifacts(content)
}

pub fn get_adapter(provider: ProviderId) -> Box<dyn ProviderAdapter> {
    match provider {
        ProviderId::Anthropic => Box::new(AnthropicAdapter::new()),
        ProviderId::OpenAI => Box::new(OpenAIAdapter::openai()),
        ProviderId::MiniMax => Box::new(OpenAIAdapter::minimax()),
        ProviderId::Gemini => Box::new(OpenAIAdapter::custom()),
        ProviderId::DeepSeek => Box::new(OpenAIAdapter::new(ProviderId::DeepSeek)),
        ProviderId::Custom => Box::new(OpenAIAdapter::custom()),
    }
}

pub fn get_adapter_for_config(config: &ResolvedProviderConfig) -> Box<dyn ProviderAdapter> {
    get_adapter(config.provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_adapter_variants() {
        assert_eq!(get_adapter(ProviderId::Anthropic).provider_id(), ProviderId::Anthropic);
        assert_eq!(get_adapter(ProviderId::MiniMax).provider_id(), ProviderId::MiniMax);
        assert_eq!(get_adapter(ProviderId::OpenAI).provider_id(), ProviderId::OpenAI);
    }
}
