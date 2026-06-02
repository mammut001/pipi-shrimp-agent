use crate::claude::message::{ChatResponse, Message, ToolCall, UsageInfo};
use crate::claude::provider::{ApiFormat, ProviderId, ResolvedProviderConfig};
use crate::utils::{AppError, AppResult};

use super::{detect_artifacts, ProviderAdapter, StreamContext, StreamEvent};
use super::super::{request_builder, stream::split_think_content};

pub struct OpenAIAdapter {
    #[allow(dead_code)]
    provider: ProviderId,
}

impl OpenAIAdapter {
    #[allow(dead_code)]
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

fn contains_xml_tool_call_text(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("<tool_calls>")
        || lower.contains("<invoke name=")
        || lower.contains("<parameter name=")
}

fn validate_structured_tool_call_content(content: &str, tool_calls: &[ToolCall]) -> AppResult<()> {
    if tool_calls.is_empty() && contains_xml_tool_call_text(content) {
        return Err(AppError::ProcessError(
            "malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.".to_string(),
        ));
    }

    Ok(())
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
            .and_then(|choices| choices.as_array())
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
            .unwrap_or("")
            .to_string();

        let model_name = body
            .get("model")
            .and_then(|model| model.as_str())
            .unwrap_or(&config.model)
            .to_string();

        let usage = UsageInfo {
            input_tokens: body
                .get("usage")
                .and_then(|usage| usage.get("prompt_tokens"))
                .and_then(|value| value.as_i64())
                .unwrap_or(0) as i32,
            output_tokens: body
                .get("usage")
                .and_then(|usage| usage.get("completion_tokens"))
                .and_then(|value| value.as_i64())
                .unwrap_or(0) as i32,
            // OpenAI-compatible endpoints don't surface Anthropic-style
            // prompt-cache buckets; default both to 0 so the JSON shape
            // stays stable for downstream consumers.
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        };

        let mut tool_calls = Vec::new();
        if let Some(choices) = body.get("choices").and_then(|value| value.as_array()) {
            for choice in choices {
                if let Some(tool_call) = choice.get("message").and_then(|message| message.get("tool_calls")) {
                    if let Some(calls) = tool_call.as_array() {
                        for call in calls {
                            tool_calls.push(ToolCall {
                                tool_call_id: call
                                    .get("id")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                name: call
                                    .get("function")
                                    .and_then(|function| function.get("name"))
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                arguments: call
                                    .get("function")
                                    .and_then(|function| function.get("arguments"))
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("{}")
                                    .to_string(),
                            });
                        }
                    }
                }
            }
        }

        let artifacts = detect_artifacts(&content);
        validate_structured_tool_call_content(&content, &tool_calls)?;

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
            .map_err(|error| AppError::InternalError(format!("Parse error: {}", error)))?;

        if ctx.model.is_empty() {
            if let Some(model) = json.get("model").and_then(|value| value.as_str()) {
                ctx.model = model.to_string();
            }
        }

        if let Some(choices) = json.get("choices").and_then(|value| value.as_array()) {
            for choice in choices {
                if let Some(delta) = choice.get("delta") {
                    if let Some(text) = delta.get("content").and_then(|value| value.as_str()) {
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
                        .and_then(|value| value.as_str())
                        .or_else(|| delta.get("reasoning_content").and_then(|value| value.as_str()))
                    {
                        ctx.reasoning.push_str(thinking);
                        ctx.emit_reasoning(thinking);
                        events.push(StreamEvent::Reasoning(thinking.to_string()));
                    }

                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|value| value.as_array()) {
                        for tool_call in tool_calls {
                            let index = tool_call.get("index").and_then(|value| value.as_u64()).map(|value| value as usize);
                            let id = tool_call["id"].as_str().unwrap_or("").to_string();
                            let name = tool_call["function"]["name"].as_str().unwrap_or("").to_string();
                            let args = tool_call["function"]["arguments"]
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
                                tool_call_id: id,
                                name,
                                arguments: args,
                            });
                        }
                    }
                }

                if let Some(finish_reason) = choice.get("finish_reason").and_then(|value| value.as_str()) {
                    if finish_reason == "tool_calls" {
                        events.extend(ctx.emit_pending_tool_calls()?);
                    }
                }
            }
        }

        if let Some(usage) = json.get("usage").and_then(|value| value.as_object()) {
            ctx.usage.input_tokens = usage
                .get("prompt_tokens")
                .and_then(|value| value.as_i64())
                .unwrap_or(0) as i32;
            ctx.usage.output_tokens = usage
                .get("completion_tokens")
                .and_then(|value| value.as_i64())
                .unwrap_or(0) as i32;
            ctx.emit_usage();
        }

        Ok(events)
    }

    fn finalize_stream(
        &self,
        mut ctx: StreamContext,
        _config: &ResolvedProviderConfig,
    ) -> AppResult<ChatResponse> {
        let artifacts = detect_artifacts(&ctx.content);

        if ctx.has_unfinalized_tool_calls() {
            return Err(AppError::ProcessError(
                "malformed_tool_call: Stream ended before tool_calls were finalized by finish_reason.".to_string(),
            ));
        }

        if ctx.usage.input_tokens == 0 {
            ctx.usage.input_tokens = ctx.estimated_input;
        }

        validate_structured_tool_call_content(&ctx.content, &ctx.tool_calls)?;

        Ok(ChatResponse {
            content: ctx.content,
            artifacts,
            model: ctx.model,
            usage: ctx.usage,
            tool_calls: ctx.tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::provider::ProviderCapabilities;

    fn deepseek_config() -> ResolvedProviderConfig {
        ResolvedProviderConfig {
            provider_id: ProviderId::DeepSeek,
            api_format: ApiFormat::OpenAI,
            base_url: "https://api.deepseek.com".to_string(),
            api_key: "test-token".to_string(),
            model: "deepseek-chat".to_string(),
            capabilities: ProviderCapabilities {
                supports_thinking: false,
                supports_reasoning: true,
                supports_reasoning_stream: true,
                supports_tool_calls: true,
                supports_tool_openai: true,
                supports_streaming: true,
                supports_response_format: false,
                supports_response_format_json_schema: false,
                supports_json_mode: true,
                accepts_response_format: false,
                accepts_reasoning_param: false,
                supports_vision: false,
                uses_responses_api: false,
                requires_tool_ordering: false,
                thinking_budget: None,
                max_output_tokens: Some(8192),
            },
        }
    }

    #[test]
    fn parses_deepseek_reasoning_stream_without_leaking_reasoning_into_final_content() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(12, None, Some("session-1".to_string()));

        let first_chunk = serde_json::json!({
            "model": "deepseek-chat",
            "choices": [{
                "index": 0,
                "delta": {
                    "reasoning_content": "internal reasoning ",
                    "content": "visible "
                }
            }]
        });
        let second_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": {
                            "name": "execute_command",
                            "arguments": "{\"command\":\"ls -la\"}"
                        }
                    }]
                }
            }]
        });
        let third_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "content": "answer"
                },
                "finish_reason": "tool_calls"
            }],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 3
            }
        });

        let first_events = adapter
            .parse_stream_chunk(&first_chunk.to_string(), &mut ctx)
            .expect("first chunk should parse");
        assert!(matches!(first_events[0], StreamEvent::Reasoning(ref chunk) if chunk == "internal reasoning "));
        assert!(matches!(first_events[1], StreamEvent::Token(ref chunk) if chunk == "visible "));

        let second_events = adapter
            .parse_stream_chunk(&second_chunk.to_string(), &mut ctx)
            .expect("second chunk should parse");
        assert!(second_events.is_empty());

        let third_events = adapter
            .parse_stream_chunk(&third_chunk.to_string(), &mut ctx)
            .expect("third chunk should parse");
        assert!(third_events.iter().any(|event| matches!(event, StreamEvent::Token(chunk) if chunk == "answer")));
        assert!(third_events.iter().any(|event| matches!(event, StreamEvent::ToolCall { id, name, arguments } if id == "call_1" && name == "execute_command" && arguments == "{\"command\":\"ls -la\"}")));

        let response = adapter
            .finalize_stream(ctx, &deepseek_config())
            .expect("stream should finalize");

        assert_eq!(response.content, "visible answer");
        assert!(!response.content.contains("internal reasoning"));
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].tool_call_id, "call_1");
        assert_eq!(response.tool_calls[0].name, "execute_command");
        assert_eq!(response.tool_calls[0].arguments, "{\"command\":\"ls -la\"}");
        assert_eq!(response.usage.input_tokens, 10);
        assert_eq!(response.usage.output_tokens, 3);
    }

    #[test]
    fn rejects_xml_tool_calls_without_structured_tool_call_channel() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(8, None, Some("session-xml".to_string()));

        let chunk = serde_json::json!({
            "model": "deepseek-v4-pro",
            "choices": [{
                "index": 0,
                "delta": {
                    "content": "<tool_calls><invoke name=\"execute_command\"><parameter name=\"command\" string=\"ls -la\"/></invoke></tool_calls>"
                },
                "finish_reason": "stop"
            }]
        });

        adapter
            .parse_stream_chunk(&chunk.to_string(), &mut ctx)
            .expect("chunk should parse before final validation");

        let error = adapter
            .finalize_stream(ctx, &deepseek_config())
            .expect_err("xml tool calls should be rejected");

        assert!(error.to_string().contains("malformed_tool_call"));
    }

    #[test]
    fn merges_streaming_tool_calls_by_index() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(6, None, Some("session-tools".to_string()));

        let first_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_indexed",
                        "type": "function",
                        "function": {
                            "name": "execute_command",
                            "arguments": "{\"command\":\"ls"
                        }
                    }]
                }
            }]
        });
        let second_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "type": "function",
                        "function": {
                            "arguments": " -la\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        });

        adapter
            .parse_stream_chunk(&first_chunk.to_string(), &mut ctx)
            .expect("first chunk should parse");
        let events = adapter
            .parse_stream_chunk(&second_chunk.to_string(), &mut ctx)
            .expect("second chunk should parse");

        assert!(events.iter().any(|event| matches!(event, StreamEvent::ToolCall { id, name, arguments } if id == "call_indexed" && name == "execute_command" && arguments == "{\"command\":\"ls -la\"}")));
    }

    #[test]
    fn generates_fallback_id_only_after_streamed_tool_call_finalizes() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(4, None, Some("session-generated-id".to_string()));

        let partial_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"src"
                        }
                    }]
                }
            }]
        });
        let final_chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "type": "function",
                        "function": {
                            "arguments": "/main.ts\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        });

        let partial_events = adapter
            .parse_stream_chunk(&partial_chunk.to_string(), &mut ctx)
            .expect("partial chunk should parse without emitting tool execution");
        assert!(partial_events.is_empty());
        assert!(ctx.tool_calls[0].tool_call_id.is_empty());

        let final_events = adapter
            .parse_stream_chunk(&final_chunk.to_string(), &mut ctx)
            .expect("final chunk should finalize the tool call");

        assert!(final_events.iter().any(|event| matches!(event, StreamEvent::ToolCall { id, name, arguments } if id == "generated_tool_call_0" && name == "read_file" && arguments == "{\"path\":\"src/main.ts\"}")));
    }

    #[test]
    fn rejects_streamed_tool_call_without_function_name() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(4, None, Some("session-missing-name".to_string()));

        let chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_missing_name",
                        "type": "function",
                        "function": {
                            "arguments": "{\"command\":\"pwd\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        });

        let error = adapter
            .parse_stream_chunk(&chunk.to_string(), &mut ctx)
            .expect_err("missing function name should fail before execution");

        assert!(error.to_string().contains("malformed_tool_call"));
        assert!(error.to_string().contains("Missing function name"));
    }

    #[test]
    fn rejects_streamed_tool_call_with_malformed_json_arguments() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(4, None, Some("session-bad-json".to_string()));

        let chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_bad_json",
                        "type": "function",
                        "function": {
                            "name": "execute_command",
                            "arguments": "{\"command\":"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        });

        let error = adapter
            .parse_stream_chunk(&chunk.to_string(), &mut ctx)
            .expect_err("malformed JSON arguments should fail before execution");

        assert!(error.to_string().contains("malformed_tool_call"));
        assert!(error.to_string().contains("Incomplete or invalid JSON arguments"));
    }

    #[test]
    fn rejects_stream_end_when_tool_calls_never_reach_finish_reason() {
        let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
        let mut ctx = StreamContext::new(4, None, Some("session-no-finish".to_string()));

        let chunk = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_no_finish",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"README.md\"}"
                        }
                    }]
                },
                "finish_reason": "stop"
            }]
        });

        adapter
            .parse_stream_chunk(&chunk.to_string(), &mut ctx)
            .expect("chunk should parse before finalization");

        let error = adapter
            .finalize_stream(ctx, &deepseek_config())
            .expect_err("unfinished tool call stream should fail");

        assert!(error.to_string().contains("malformed_tool_call"));
        assert!(error.to_string().contains("finish_reason"));
    }
}
