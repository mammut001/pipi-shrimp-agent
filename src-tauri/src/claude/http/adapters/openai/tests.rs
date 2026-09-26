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
    assert!(
        matches!(first_events[0], StreamEvent::Reasoning(ref chunk) if chunk == "internal reasoning ")
    );
    assert!(matches!(first_events[1], StreamEvent::Token(ref chunk) if chunk == "visible "));

    let second_events = adapter
        .parse_stream_chunk(&second_chunk.to_string(), &mut ctx)
        .expect("second chunk should parse");
    assert!(second_events.is_empty());

    let third_events = adapter
        .parse_stream_chunk(&third_chunk.to_string(), &mut ctx)
        .expect("third chunk should parse");
    assert!(third_events
        .iter()
        .any(|event| matches!(event, StreamEvent::Token(chunk) if chunk == "answer")));
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
fn minimax_streaming_tool_call_with_finish_reason_stop() {
    let adapter = OpenAIAdapter::minimax();
    let mut ctx = StreamContext::new(6, None, Some("session-minimax".to_string()));

    let first_chunk = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "id": "call_minimax_1",
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "arguments": ""
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
                    "function": {
                        "arguments": "{\"path\":\"02_scaffold.py\",\"content\":\"print(1)\"}"
                    }
                }]
            },
            "finish_reason": "stop"
        }]
    });

    adapter
        .parse_stream_chunk(&first_chunk.to_string(), &mut ctx)
        .expect("first chunk should parse");
    let events = adapter
        .parse_stream_chunk(&second_chunk.to_string(), &mut ctx)
        .expect("second chunk should parse");

    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ToolCall { id, name, arguments }
            if id == "call_minimax_1"
            && name == "write_file"
            && arguments == "{\"path\":\"02_scaffold.py\",\"content\":\"print(1)\"}"
    )));

    let response = adapter
        .finalize_stream(ctx, &deepseek_config())
        .expect("stream should finalize cleanly");

    assert_eq!(response.tool_calls.len(), 1);
    assert_eq!(response.tool_calls[0].tool_call_id, "call_minimax_1");
    assert_eq!(response.tool_calls[0].name, "write_file");
    assert_eq!(
        response.tool_calls[0].arguments,
        "{\"path\":\"02_scaffold.py\",\"content\":\"print(1)\"}"
    );
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
    assert!(error
        .to_string()
        .contains("Incomplete or invalid JSON arguments"));
}

#[test]
fn rejects_stream_end_when_tool_calls_never_reach_finish_reason() {
    let adapter = OpenAIAdapter::new(ProviderId::DeepSeek);
    let mut ctx = StreamContext::new(5, None, Some("session-no-finish".to_string()));

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
            }
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

#[test]
fn emits_done_on_finish_reason_stop_and_marks_clean() {
    let adapter = OpenAIAdapter::openai();
    let mut ctx = StreamContext::new(3, None, Some("session-done".to_string()));

    let chunk = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": { "content": "ping-ok" },
            "finish_reason": "stop"
        }]
    });

    let events = adapter
        .parse_stream_chunk(&chunk.to_string(), &mut ctx)
        .expect("chunk should parse");
    assert!(events
        .iter()
        .any(|event| matches!(event, StreamEvent::Done)));
    assert_eq!(ctx.finish_reason.as_deref(), Some("stop"));

    let response = adapter
        .finalize_stream(ctx, &deepseek_config())
        .expect("stream should finalize cleanly");
    assert_eq!(response.content, "ping-ok");
    assert_eq!(response.finish_reason.as_deref(), Some("stop"));
    assert!(!response.truncated);
}

#[test]
fn marks_length_finish_reason_as_truncated() {
    let adapter = OpenAIAdapter::openai();
    let mut ctx = StreamContext::new(3, None, Some("session-length".to_string()));

    let chunk = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": { "content": "ping" },
            "finish_reason": "length"
        }]
    });

    adapter
        .parse_stream_chunk(&chunk.to_string(), &mut ctx)
        .expect("chunk should parse");

    let response = adapter
        .finalize_stream(ctx, &deepseek_config())
        .expect("length finish should still finalize");
    assert_eq!(response.content, "ping");
    assert_eq!(response.finish_reason.as_deref(), Some("length"));
    assert!(response.truncated);
}

#[test]
fn marks_eof_without_finish_reason_as_truncated() {
    let adapter = OpenAIAdapter::openai();
    let mut ctx = StreamContext::new(3, None, Some("session-eof".to_string()));

    let chunk = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": { "content": "half" }
        }]
    });

    adapter
        .parse_stream_chunk(&chunk.to_string(), &mut ctx)
        .expect("chunk should parse");

    let response = adapter
        .finalize_stream(ctx, &deepseek_config())
        .expect("eof finalize should succeed with truncated flag");
    assert_eq!(response.content, "half");
    assert!(response.finish_reason.is_none());
    assert!(response.truncated);
}
