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

use super::message::{Artifact, ChatResponse, Message, ToolCall, UsageInfo};
use super::provider::{ApiFormat, ProviderCapabilities, ProviderId, ResolvedProviderConfig};

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
    ToolCallComplete {
        id: String,
        name: String,
    },
    /// Artifact detected
    Artifact(Artifact),
    /// Usage information
    Usage { input_tokens: i32, output_tokens: i32 },
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
}

impl StreamContext {
    pub fn new(estimated_input: i32, window: Option<Window>) -> Self {
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
        }
    }

    /// Emit an event to the frontend
    pub fn emit(&self, event_type: &str, payload: &str) {
        if let Some(ref w) = self.window {
            let _ = w.emit(event_type, payload);
        }
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
    ) -> serde_json::Value;

    /// Build request body for streaming
    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
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
        config: &ResolvedProviderConfig,
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
        let base = if config.capabilities.supports_thinking {
            config.capabilities.thinking_budget.unwrap_or(5000) + 1000
        } else {
            2048
        };
        base
    }
}

/// Detect artifacts in content
fn detect_artifacts(content: &str) -> Vec<Artifact> {
    let mut artifacts = Vec::new();

    // Simple pattern detection for code blocks, mermaid, etc.
    // This is a simplified version - the full implementation is in http_client.rs

    // Detect HTML artifacts
    if content.contains("<html") || content.contains("<!DOCTYPE") {
        if let Some(start) = content.find("<html") {
            let end = content[start..].find("</html>")
                .map(|i| start + i + 7)
                .unwrap_or(content.len());
            let html = &content[start..end];
            if html.len() > 100 {
                artifacts.push(Artifact {
                    artifact_type: "html".to_string(),
                    content: html.to_string(),
                    title: Some("HTML Document".to_string()),
                    language: Some("html".to_string()),
                });
            }
        }
    }

    // Detect mermaid diagrams
    let mermaid_re = regex::Regex::new(r"```mermaid\s*([\s\S]*?)```").ok();
    if let Some(re) = mermaid_re {
        for cap in re.captures_iter(content) {
            if let Some(code) = cap.get(1) {
                artifacts.push(Artifact {
                    artifact_type: "mermaid".to_string(),
                    content: code.as_str().to_string(),
                    title: Some("Mermaid Diagram".to_string()),
                    language: Some("mermaid".to_string()),
                });
            }
        }
    }

    artifacts
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
        "https://api.anthropic.com/v1/messages".to_string()
    }

    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", config.api_key.parse().unwrap());
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());

        if config.capabilities.supports_thinking {
            headers.insert("anthropic-beta", "interleaved-thinking-2025-05-14".parse().unwrap());
        }

        headers
    }

    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
    ) -> serde_json::Value {
        use super::http_client::{format_messages_for_anthropic, get_tools, merge_system_prompt};

        let max_tokens = self.get_max_tokens(config);

        let mut body = serde_json::json!({
            "model": config.model,
            "max_tokens": max_tokens,
            "stream": false,
            "messages": format_messages_for_anthropic(messages),
            "tools": get_tools(),
        });

        // Add system prompt
        let merged_system = merge_system_prompt(system_prompt);
        body["system"] = serde_json::json!(merged_system);

        // Add thinking config if supported
        if config.capabilities.supports_thinking {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": config.capabilities.thinking_budget.unwrap_or(5000)
            });
        }

        body
    }

    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
    ) -> serde_json::Value {
        let mut body = self.build_body(config, messages, system_prompt);
        body["stream"] = serde_json::json!(true);
        body
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

        match event_type {
            "content_block_delta" => {
                if let Some(delta) = json.get("delta") {
                    // Text delta
                    if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                        ctx.content.push_str(text);
                        ctx.emit("claude-token", text);
                        events.push(StreamEvent::Token(text.to_string()));
                    }

                    // Thinking delta
                    if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                        ctx.reasoning.push_str(thinking);
                        ctx.emit("claude-reasoning", thinking);
                        events.push(StreamEvent::Reasoning(thinking.to_string()));
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

                        ctx.emit("claude-tool-use", &serde_json::json!({
                            "id": id,
                            "name": name
                        }).to_string());

                        events.push(StreamEvent::ToolCall {
                            id,
                            name,
                            arguments: String::new(),
                        });
                    }
                }
            }
            "content_block_delta" => {
                // Tool input delta
                if let Some(delta) = json.get("delta") {
                    if delta.get("type").and_then(|v| v.as_str()) == Some("input_json_delta") {
                        if let Some(arg_text) = delta.get("partial_json").and_then(|v| v.as_str()) {
                            if let Some(last) = ctx.tool_calls.last_mut() {
                                last.arguments.push_str(arg_text);
                            }
                        }
                    }
                }
            }
            "message_delta" => {
                if let Some(usage) = json.get("usage") {
                    ctx.usage.output_tokens = usage["output_tokens"].as_i64().unwrap_or(0) as i32;
                    ctx.emit("claude-usage", &serde_json::json!({
                        "output_tokens": ctx.usage.output_tokens
                    }).to_string());
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
        config: &ResolvedProviderConfig,
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
        Self { provider: ProviderId::MiniMax }
    }

    pub fn openai() -> Self {
        Self { provider: ProviderId::OpenAI }
    }

    pub fn custom() -> Self {
        Self { provider: ProviderId::Custom }
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
        format!("{}/chat/completions", config.base_url.trim_end_matches('/'))
    }

    fn build_headers(&self, config: &ResolvedProviderConfig) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Authorization", format!("Bearer {}", config.api_key).parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());
        headers
    }

    fn build_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
    ) -> serde_json::Value {
        use super::http_client::{convert_tools_to_openai_format, format_messages_for_openai, get_tools};

        let tools = Some(convert_tools_to_openai_format(&get_tools()));
        let openai_messages = format_messages_for_openai(messages);

        // Build request body
        let mut body = serde_json::json!({
            "model": config.model,
            "messages": openai_messages,
            "stream": false,
        });

        if let Some(system) = system_prompt {
            // Add system message at the front
            if let Some(msgs) = body["messages"].as_array_mut() {
                msgs.insert(0, serde_json::json!({
                    "role": "system",
                    "content": system
                }));
            }
        }

        if self.provider == ProviderId::MiniMax || self.provider == ProviderId::Custom {
            // MiniMax and custom providers typically need tools
            body["tools"] = serde_json::json!(tools);
        } else {
            // OpenAI and others: only add tools if supported
            if config.capabilities.supports_tool_calls {
                body["tools"] = serde_json::json!(tools);
            }
        }

        body
    }

    fn build_stream_body(
        &self,
        config: &ResolvedProviderConfig,
        messages: &[Message],
        system_prompt: Option<&str>,
    ) -> serde_json::Value {
        let mut body = self.build_body(config, messages, system_prompt);
        body["stream"] = serde_json::json!(true);
        body
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
        };

        // Detect tool calls
        let mut tool_calls = Vec::new();
        if let Some(choices) = body.get("choices").and_then(|c| c.as_array()) {
            for choice in choices {
                if let Some(tool_call) = choice.get("message").and_then(|m| m.get("tool_calls")) {
                    if let Some(calls) = tool_call.as_array() {
                        for call in calls {
                            tool_calls.push(ToolCall {
                                tool_call_id: call.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                name: call.get("function").and_then(|f| f.get("name")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                arguments: call.get("function").and_then(|f| f.get("arguments")).and_then(|v| v.as_str()).unwrap_or("{}").to_string(),
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
                    // Text token
                    if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
                        ctx.content.push_str(text);
                        ctx.emit("claude-token", text);
                        events.push(StreamEvent::Token(text.to_string()));
                    }

                    // MiniMax/OpenAI reasoning format
                    if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                        ctx.reasoning.push_str(thinking);
                        ctx.emit("claude-reasoning", thinking);
                        events.push(StreamEvent::Reasoning(thinking.to_string()));
                    }

                    // Tool calls
                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in tool_calls {
                            let id = tc["id"].as_str().unwrap_or("").to_string();
                            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                            let args = tc["function"]["arguments"].as_str().unwrap_or("{}").to_string();

                            // Check if this is a continuation
                            if let Some(last) = ctx.tool_calls.last_mut() {
                                if last.tool_call_id == id {
                                    // Continuation
                                    last.arguments.push_str(&args);
                                    continue;
                                }
                            }

                            // New tool call
                            ctx.tool_calls.push(ToolCall {
                                tool_call_id: id.clone(),
                                name: name.clone(),
                                arguments: args,
                            });

                            ctx.emit("claude-tool-use", &serde_json::json!({
                                "id": id,
                                "name": name
                            }).to_string());

                            events.push(StreamEvent::ToolCall {
                                id,
                                name,
                                arguments: String::new(),
                            });
                        }
                    }
                }

                // Handle finish reason
                if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                    if finish_reason == "tool_calls" {
                        for tc in &ctx.tool_calls {
                            events.push(StreamEvent::ToolCallComplete {
                                id: tc.tool_call_id.clone(),
                                name: tc.name.clone(),
                            });
                        }
                    }
                }
            }
        }

        // Handle usage
        if let Some(usage) = json.get("usage").and_then(|v| v.as_object()) {
            ctx.usage.input_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            ctx.usage.output_tokens = usage.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
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