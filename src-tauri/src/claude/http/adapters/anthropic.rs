use crate::claude::message::{ChatResponse, ErrorResponse, Message, ToolCall, UsageInfo};
use crate::claude::provider::{ApiFormat, ProviderId, ResolvedProviderConfig};
use crate::utils::{AppError, AppResult};

use super::super::request_builder;
use super::{detect_artifacts, ProviderAdapter, StreamContext, StreamEvent};

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
        if let Ok(error_resp) = serde_json::from_value::<ErrorResponse>(body.clone()) {
            return Err(AppError::InternalError(format!(
                "Claude API error: {} ({})",
                error_resp.error, error_resp.code
            )));
        }

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

        let event_type = json
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        #[allow(unreachable_patterns)]
        match event_type {
            "content_block_delta" => {
                if let Some(delta) = json.get("delta") {
                    if delta.get("type").and_then(|value| value.as_str())
                        == Some("input_json_delta")
                    {
                        if let Some(arg_text) =
                            delta.get("partial_json").and_then(|value| value.as_str())
                        {
                            if let Some(last) = ctx.tool_calls.last_mut() {
                                last.arguments.push_str(arg_text);
                            }
                        }
                    } else {
                        if let Some(text) = delta.get("text").and_then(|value| value.as_str()) {
                            ctx.content.push_str(text);
                            ctx.emit_token(text);
                            events.push(StreamEvent::Token(text.to_string()));
                        }

                        if let Some(thinking) =
                            delta.get("thinking").and_then(|value| value.as_str())
                        {
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
                            tool_call_id: id,
                            name,
                            arguments: String::new(),
                        });
                    }
                }
            }
            "content_block_stop" => {
                events.extend(ctx.emit_pending_tool_calls()?);
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
