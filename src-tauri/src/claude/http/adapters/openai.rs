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
                        events.extend(ctx.emit_pending_tool_calls());
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
}
