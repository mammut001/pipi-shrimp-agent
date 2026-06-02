#![allow(dead_code)]
/**
 * Provider Adapter
 *
 * Abstracts provider-specific protocol handling.
 * Each provider has its own adapter implementing the ProviderAdapter trait.
 *
 * Design:
 * - Provider-specific request building
 * - Provider-specific response parsing
 * - Unified error handling
 */
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};

use super::http::request_builder;
use super::http::stream::split_think_content;
use super::message::{Artifact, ChatResponse, Message, ToolCall, UsageInfo};
use super::provider::{ApiFormat, ProviderId, ResolvedProviderConfig};

/// Unified streaming events emitted to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum StreamEvent {
    /// Text token
    Token(String),
    /// Reasoning/thinking token
    Reasoning(String),
    /// Tool call detected
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// Tool use complete
    ToolCallComplete { id: String, name: String },
    /// Artifact detected
    Artifact(Artifact),
    /// Usage information
    Usage {
        input_tokens: i32,
        output_tokens: i32,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
    },
    /// Error occurred
    Error(String),
    /// Stream complete
    Done,
}

/// Context for streaming responses
#[derive(Debug)]
pub struct StreamContext {
    /// Estimated input tokens (for fallback if API doesn't report)
    pub estimated_input: i32,
    /// Window to emit events to
    pub window: Option<Window>,
    /// Full accumulated content
    pub content: String,
    /// Full accumulated reasoning
    pub reasoning: String,
    /// Detected tool calls
    pub tool_calls: Vec<ToolCall>,
    /// Detected artifacts
    pub artifacts: Vec<Artifact>,
    /// Usage info
    pub usage: UsageInfo,
    /// Model name
    pub model: String,
    /// Session id for frontend event routing
    pub session_id: Option<String>,
    /// Whether an inline <think> block is currently open
    pub in_think_tag: bool,
    /// Number of tool calls already emitted to the frontend
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
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
            },
            model: String::new(),
            session_id,
            in_think_tag: false,
            emitted_tool_calls: 0,
        }
    }

    pub fn emit_token(&self, content: &str) {
        if let Some(ref w) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "content": content,
            });
            let _ = w.emit("claude-token", payload);
        }
    }

    pub fn emit_reasoning(&self, content: &str) {
        if let Some(ref w) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "content": content,
            });
            let _ = w.emit("claude-reasoning", payload);
        }
    }

    pub fn emit_tool_use(&self, tool_call_id: &str, name: &str, arguments: &str) {
        if let Some(ref w) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "tool_call_id": tool_call_id,
                "name": name,
                "arguments": arguments,
            });
            let _ = w.emit("claude-tool-use", payload);
        }
    }

    pub fn emit_usage(&self) {
        if let Some(ref w) = self.window {
            let payload = serde_json::json!({
                "session_id": self.session_id.clone().unwrap_or_default(),
                "input_tokens": self.usage.input_tokens,
                "output_tokens": self.usage.output_tokens,
            });
            let _ = w.emit("claude-usage", payload);
        }
    }

    pub fn emit_pending_tool_calls(&mut self) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        let pending_calls: Vec<ToolCall> = self.tool_calls[self.emitted_tool_calls..].to_vec();

        for tool_call in &pending_calls {
            self.emit_tool_use(&tool_call.tool_call_id, &tool_call.name, &tool_call.arguments);
            events.push(StreamEvent::ToolCall {
                id: tool_call.tool_call_id.clone(),
                name: tool_call.name.clone(),
                arguments: tool_call.arguments.clone(),
            });
            events.push(StreamEvent::ToolCallComplete {
                id: tool_call.tool_call_id.clone(),
                name: tool_call.name.clone(),
            });
        }

        self.emitted_tool_calls = self.tool_calls.len();
        events
    }
}

/// Provider adapter trait - implemented by each provider
pub trait ProviderAdapter: Send + Sync {
    /// Get the provider ID
    fn provider_id(&self) -> ProviderId;

    /// Get API format
    fn api_format(&self) -> ApiFormat;

    /// Build the full HTTP request URL
    fn build_url(&self, config: &ResolvedProviderConfig) -> String;

    /// Build request headers
    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap;

    /// Build request body for non-streaming
    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value;

    /// Build request body for streaming
    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value;

    /// Parse non-streaming response
    fn parse_response(
        &self,
        body: serde_json::Value,
        config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse>;

    /// Parse streaming chunk - returns events to emit
    fn parse_stream_chunk(
        &self,
        data: &str,
        ctx: &mut StreamContext,
    ) -> AppResult<Vec<StreamEvent>>;

    /// Finalize streaming response
    fn finalize_stream(
        &self,
        mut ctx: StreamContext,
        _config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        // Detect artifacts from final content
        let artifacts = detect_artifacts(&ctx.content);

        // Fallback usage to estimated if not provided
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

    /// Get max tokens for this provider
    fn get_max_tokens(&self, config: &ResolvedProviderConfig) -> i32 {
        if config.capabilities.supports_thinking {
            config.capabilities.thinking_budget.unwrap_or(5000) + 1000
        } else {
            2048
        }
    }
}

/// Detect artifacts in content
fn detect_artifacts(content: &str) -> Vec<Artifact> {
    request_builder::detect_artifacts(content)
}

// =============================================================================
// Anthropic Adapter
// =============================================================================

pub struct AnthropicAdapter;

impl AnthropicAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for AnthropicAdapter {
    fn provider_id(&self) -> ProviderId {
        ProviderId::Anthropic
    }

    fn api_format(&self) -> ApiFormat {
        ApiFormat::Anthropic
    }

    fn build_url(&self, config: &ResolvedProviderConfig) -> String {
        request_builder::build_anthropic_url(&config.base_url)
    }

    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap {
        request_builder::build_anthropic_headers(
            &config.api_key,
            config.capabilities.supports_thinking,
        )
        .unwrap_or_default()
    }

    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value {
        request_builder::build_anthropic_body(
            config,
            messages,
            system_prompt,
            allow_browser_tools,
            no_tools,
            false,
        )
    }

    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value {
        request_builder::build_anthropic_body(
            config,
            messages,
            system_prompt,
            allow_browser_tools,
            no_tools,
            true,
        )
    }

    fn parse_response(
        &self,
        body: serde_json::Value,
        config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        use super::message::ErrorResponse;

        // Check for errors
        if let Ok(error_resp) = serde_json::from_value::<ErrorResponse>(body.clone()) {
            return Err(AppError::InternalError(format!(
                "Claude API error: {} ({})",
                error_resp.error, error_resp.code
            )));
        }

        // Parse content
        let content = body["content"]
            .as_array()
            .and_then(|arr| arr.iter().find(|c| c["type"] == "text"))
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let model_name = body["model"].as_str().unwrap_or(&config.model).to_string();

        let usage = UsageInfo {
            input_tokens: body["usage"]["input_tokens"].as_i64().unwrap_or(0) as i32,
            output_tokens: body["usage"]["output_tokens"].as_i64().unwrap_or(0) as i32,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        };

        // Detect tool calls
        let mut tool_calls = Vec::new();
        if let Some(content_arr) = body["content"].as_array() {
            for block in content_arr {
                if block["type"] == "tool_use" {
                    tool_calls.push(ToolCall {
                        tool_call_id: block["id"].as_str().unwrap_or("").to_string(),
                        name: block["name"].as_str().unwrap_or("").to_string(),
                        arguments: serde_json::to_string(&block["input"]).unwrap_or_default(),
                    });
                }
            }
        }

        // Detect artifacts
        let artifacts = detect_artifacts(&content);

        Ok(ChatResponse {
            content,
            artifacts,
            model: model_name,
            usage,
            tool_calls,
        })
    }

    fn parse_stream_chunk(
        &self,
        data: &str,
        ctx: &mut StreamContext,
    ) -> AppResult<Vec<StreamEvent>> {
        let mut events = Vec::new();
        let json: serde_json::Value = serde_json::from_str(data)
            .map_err(|e| AppError::InternalError(format!("Parse error: {}", e)))?;

        let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

        #[allow(unreachable_patterns)]
        match event_type {
            "content_block_delta" => {
                if let Some(delta) = json.get("delta") {
                    if delta.get("type").and_then(|v| v.as_str()) == Some("input_json_delta") {
                        if let Some(arg_text) = delta.get("partial_json").and_then(|v| v.as_str()) {
                            if let Some(last) = ctx.tool_calls.last_mut() {
                                last.arguments.push_str(arg_text);
                            }
                        }
                    } else {
                        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                            ctx.content.push_str(text);
                            ctx.emit_token(text);
                            events.push(StreamEvent::Token(text.to_string()));
                        }

                        if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                            ctx.reasoning.push_str(thinking);
                            ctx.emit_reasoning(thinking);
                            events.push(StreamEvent::Reasoning(thinking.to_string()));
                        }
                    }
                }
            }
            "content_block_start" => {
                if let Some(content_block) = json.get("content_block") {
                    if content_block["type"] == "tool_use" {
                        let id = content_block["id"].as_str().unwrap_or("").to_string();
                        let name = content_block["name"].as_str().unwrap_or("").to_string();

                        ctx.tool_calls.push(ToolCall {
                            tool_call_id: id.clone(),
                            name: name.clone(),
                            arguments: String::new(),
                        });
                    }
                }
            }
            "content_block_stop" => {
                events.extend(ctx.emit_pending_tool_calls());
            }
            "message_delta" => {
                if let Some(usage) = json.get("usage") {
                    ctx.usage.output_tokens = usage["output_tokens"].as_i64().unwrap_or(0) as i32;
                    ctx.emit_usage();
                }
            }
            "message_stop" => {
                events.push(StreamEvent::Done);
            }
            _ => {}
        }

        Ok(events)
    }

    fn finalize_stream(
        &self,
        ctx: StreamContext,
        _config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        let artifacts = detect_artifacts(&ctx.content);

        Ok(ChatResponse {
            content: ctx.content,
            artifacts,
            model: ctx.model,
            usage: ctx.usage,
            tool_calls: ctx.tool_calls,
        })
    }
}

// =============================================================================
// OpenAI Adapter (also used for MiniMax, Gemini, Custom)
// =============================================================================

pub struct OpenAIAdapter {
    /// The actual provider this adapter represents
    provider: ProviderId,
}

impl OpenAIAdapter {
    pub fn new(provider: ProviderId) -> Self {
        Self { provider }
    }

    pub fn minimax() -> Self {
        Self {
            provider: ProviderId::MiniMax,
        }
    }

    pub fn openai() -> Self {
        Self {
            provider: ProviderId::OpenAI,
        }
    }

    pub fn custom() -> Self {
        Self {
            provider: ProviderId::Custom,
        }
    }
}

impl ProviderAdapter for OpenAIAdapter {
    fn provider_id(&self) -> ProviderId {
        self.provider
    }

    fn api_format(&self) -> ApiFormat {
        ApiFormat::OpenAI
    }

    fn build_url(&self, config: &ResolvedProviderConfig) -> String {
        request_builder::build_openai_url(config)
    }

    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap {
        request_builder::build_openai_headers(&config.api_key).unwrap_or_default()
    }

    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value {
        request_builder::build_openai_body(
            config,
            messages,
            system_prompt,
            allow_browser_tools,
            no_tools,
            false,
        )
    }

    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
        no_tools: bool,
        allow_browser_tools: bool,
    ) -> serde_json::Value {
        request_builder::build_openai_body(
            config,
            messages,
            system_prompt,
            allow_browser_tools,
            no_tools,
            true,
        )
    }

    fn parse_response(
        &self,
        body: serde_json::Value,
        config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        let content = body
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        let model_name = body
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&config.model)
            .to_string();

        let usage = UsageInfo {
            input_tokens: body
                .get("usage")
                .and_then(|u| u.get("prompt_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            output_tokens: body
                .get("usage")
                .and_then(|u| u.get("completion_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        };

        // Detect tool calls
        let mut tool_calls = Vec::new();
        if let Some(choices) = body.get("choices").and_then(|c| c.as_array()) {
            for choice in choices {
                if let Some(tool_call) = choice.get("message").and_then(|m| m.get("tool_calls")) {
                    if let Some(calls) = tool_call.as_array() {
                        for call in calls {
                            tool_calls.push(ToolCall {
                                tool_call_id: call
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                name: call
                                    .get("function")
                                    .and_then(|f| f.get("name"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                arguments: call
                                    .get("function")
                                    .and_then(|f| f.get("arguments"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("{}")
                                    .to_string(),
                            });
                        }
                    }
                }
            }
        }

        let artifacts = detect_artifacts(&content);

        Ok(ChatResponse {
            content,
            artifacts,
            model: model_name,
            usage,
            tool_calls,
        })
    }

    fn parse_stream_chunk(
        &self,
        data: &str,
        ctx: &mut StreamContext,
    ) -> AppResult<Vec<StreamEvent>> {
        let mut events = Vec::new();
        let json: serde_json::Value = serde_json::from_str(data)
            .map_err(|e| AppError::InternalError(format!("Parse error: {}", e)))?;

        // Get model from first response
        if ctx.model.is_empty() {
            if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
                ctx.model = m.to_string();
            }
        }

        if let Some(choices) = json.get("choices").and_then(|v| v.as_array()) {
            for choice in choices {
                // Handle delta content
                if let Some(delta) = choice.get("delta") {
                    if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
                        for (segment, is_reasoning) in split_think_content(text, &mut ctx.in_think_tag) {
                            if segment.is_empty() {
                                continue;
                            }

                            if is_reasoning {
                                ctx.reasoning.push_str(&segment);
                                ctx.emit_reasoning(&segment);
                                events.push(StreamEvent::Reasoning(segment));
                            } else {
                                ctx.content.push_str(&segment);
                                ctx.emit_token(&segment);
                                events.push(StreamEvent::Token(segment));
                            }
                        }
                    }

                    if let Some(thinking) = delta
                        .get("thinking")
                        .and_then(|v| v.as_str())
                        .or_else(|| delta.get("reasoning_content").and_then(|v| v.as_str()))
                    {
                        ctx.reasoning.push_str(thinking);
                        ctx.emit_reasoning(thinking);
                        events.push(StreamEvent::Reasoning(thinking.to_string()));
                    }

                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in tool_calls {
                            let index = tc.get("index").and_then(|v| v.as_u64()).map(|v| v as usize);
                            let id = tc["id"].as_str().unwrap_or("").to_string();
                            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                            let args = tc["function"]["arguments"]
                                .as_str()
                                .unwrap_or("{}")
                                .to_string();

                            if let Some(index) = index {
                                while ctx.tool_calls.len() <= index {
                                    ctx.tool_calls.push(ToolCall {
                                        tool_call_id: String::new(),
                                        name: String::new(),
                                        arguments: String::new(),
                                    });
                                }

                                let entry = &mut ctx.tool_calls[index];
                                if !id.is_empty() {
                                    entry.tool_call_id = id.clone();
                                }
                                if !name.is_empty() {
                                    entry.name = name.clone();
                                }
                                entry.arguments.push_str(&args);
                                continue;
                            }

                            if let Some(last) = ctx.tool_calls.last_mut() {
                                if id.is_empty() || last.tool_call_id == id {
                                    if last.name.is_empty() && !name.is_empty() {
                                        last.name = name.clone();
                                    }
                                    last.arguments.push_str(&args);
                                    continue;
                                }
                            }

                            ctx.tool_calls.push(ToolCall {
                                tool_call_id: id.clone(),
                                name: name.clone(),
                                arguments: args,
                            });
                        }
                    }
                }

                if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                    if finish_reason == "tool_calls" {
                        events.extend(ctx.emit_pending_tool_calls());
                    }
                }
            }
        }

        if let Some(usage) = json.get("usage").and_then(|v| v.as_object()) {
            ctx.usage.input_tokens = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;
            ctx.usage.output_tokens = usage
                .get("completion_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;
            ctx.emit_usage();
        }

        Ok(events)
    }
}

// =============================================================================
// Adapter Factory
// =============================================================================

/// Get the appropriate adapter for a provider
pub fn get_adapter(provider: ProviderId) -> Box<dyn ProviderAdapter> {
    match provider {
        ProviderId::Anthropic => Box::new(AnthropicAdapter::new()),
        ProviderId::OpenAI => Box::new(OpenAIAdapter::openai()),
        ProviderId::MiniMax => Box::new(OpenAIAdapter::minimax()),
        ProviderId::Gemini => Box::new(OpenAIAdapter::custom()), // Gemini uses different API
        ProviderId::DeepSeek => Box::new(OpenAIAdapter::custom()), // DeepSeek is OpenAI-compatible
        ProviderId::Custom => Box::new(OpenAIAdapter::custom()),
    }
}

/// Get adapter from resolved config
pub fn get_adapter_for_config(config: &ResolvedProviderConfig) -> Box<dyn ProviderAdapter> {
    get_adapter(config.provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anthropic_adapter_provider_id() {
        let adapter = AnthropicAdapter::new();
        assert_eq!(adapter.provider_id(), ProviderId::Anthropic);
        assert_eq!(adapter.api_format(), ApiFormat::Anthropic);
    }

    #[test]
    fn test_openai_adapter_provider_id() {
        let adapter = OpenAIAdapter::openai();
        assert_eq!(adapter.provider_id(), ProviderId::OpenAI);
        assert_eq!(adapter.api_format(), ApiFormat::OpenAI);
    }

    #[test]
    fn test_minimax_adapter_provider_id() {
        let adapter = OpenAIAdapter::minimax();
        assert_eq!(adapter.provider_id(), ProviderId::MiniMax);
        assert_eq!(adapter.api_format(), ApiFormat::OpenAI);
    }

    #[test]
    fn test_get_adapter() {
        let adapter = get_adapter(ProviderId::Anthropic);
        assert_eq!(adapter.provider_id(), ProviderId::Anthropic);

        let adapter = get_adapter(ProviderId::MiniMax);
        assert_eq!(adapter.provider_id(), ProviderId::MiniMax);
    }
}
