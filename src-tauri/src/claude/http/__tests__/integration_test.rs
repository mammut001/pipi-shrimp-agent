use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use serde_json::json;
use wiremock::{
    matchers::{method, path},
    Match, Mock, MockServer, Request, Respond, ResponseTemplate,
};

use crate::claude::http::ClaudeHttpError;
use crate::claude::http_client::send_request;
use crate::claude::message::Message;
use crate::claude::provider;

struct ResponseFormatMatcher;

impl Match for ResponseFormatMatcher {
    fn matches(&self, request: &Request) -> bool {
        serde_json::from_slice::<serde_json::Value>(&request.body)
            .ok()
            .and_then(|body| body.get("response_format").cloned())
            == Some(json!({
                "type": "json_object"
            }))
    }
}

struct ResponseFormatAbsentMatcher;

impl Match for ResponseFormatAbsentMatcher {
    fn matches(&self, request: &Request) -> bool {
        serde_json::from_slice::<serde_json::Value>(&request.body)
            .ok()
            .map(|body| body.get("response_format").is_none())
            .unwrap_or(false)
    }
}

struct DeepSeekFilteredToolsMatcher {
    expected_names: Vec<&'static str>,
}

impl Match for DeepSeekFilteredToolsMatcher {
    fn matches(&self, request: &Request) -> bool {
        let Ok(body) = serde_json::from_slice::<serde_json::Value>(&request.body) else {
            return false;
        };

        let Some(tools) = body.get("tools").and_then(|value| value.as_array()) else {
            return false;
        };

        let tool_names = tools
            .iter()
            .filter_map(|tool| {
                tool.get("function")
                    .and_then(|value| value.get("name"))
                    .and_then(|value| value.as_str())
            })
            .collect::<Vec<_>>();

        body.get("response_format").is_none()
            && body.get("reasoning").is_none()
            && body.get("reasoning_effort").is_none()
            && body.get("tool_choice") == Some(&json!("auto"))
            && tool_names == self.expected_names
    }
}

fn sample_messages() -> Vec<Message> {
    vec![Message {
        role: "user".to_string(),
        content: "hello".to_string(),
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
    }]
}

struct FlakyOpenAIResponder {
    calls: Arc<AtomicUsize>,
}

impl Respond for FlakyOpenAIResponder {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            ResponseTemplate::new(500).set_body_string("temporary upstream failure")
        } else {
            ResponseTemplate::new(200).set_body_json(json!({
                "id": "chatcmpl-2",
                "model": "gpt-4o",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "retry worked"
                    },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": 8,
                    "completion_tokens": 3,
                    "total_tokens": 11
                }
            }))
        }
    }
}

#[tokio::test]
async fn send_request_parses_openai_response_from_mock_server() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl-1",
            "model": "gpt-4o",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "hello back"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 6,
                "completion_tokens": 2,
                "total_tokens": 8
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("openai"),
        Some("openai"),
        None,
        None,
        None,
    )
    .await
    .expect("mocked request should succeed");

    assert_eq!(response.content, "hello back");
    assert_eq!(response.model, "gpt-4o");
    assert_eq!(response.usage.input_tokens, 6);
    assert_eq!(response.usage.output_tokens, 2);
}

#[tokio::test]
async fn send_request_retries_retryable_http_failures() {
    let server = MockServer::start().await;
    let calls = Arc::new(AtomicUsize::new(0));

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(FlakyOpenAIResponder {
            calls: Arc::clone(&calls),
        })
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        None,
        false,
        false,
        None,
        false,
        None,
        Some("openai"),
        Some("openai"),
        None,
        None,
        None,
    )
    .await
    .expect("request should succeed after retry");

    assert_eq!(response.content, "retry worked");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn send_request_forwards_openai_response_format() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(ResponseFormatMatcher)
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl-3",
            "model": "gpt-4o",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "json mode enabled"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 3,
                "total_tokens": 8
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("openai"),
        Some("openai"),
        None,
        Some(json!({
            "type": "json_object"
        })),
        None,
    )
    .await
    .expect("request should include response_format");

    assert_eq!(response.content, "json mode enabled");
}

#[tokio::test]
async fn send_request_uses_explicit_capability_hints_for_anthropic() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "content": [{
                "type": "text",
                "text": "thinking disabled"
            }],
            "model": "claude-3-7-sonnet-20250219",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 4
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "claude-3-7-sonnet-20250219",
        Some(&server.uri()),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("anthropic"),
        Some("anthropic"),
        Some(provider::ProviderCapabilities {
            supports_thinking: false,
            supports_reasoning: false,
            supports_reasoning_stream: false,
            supports_tool_calls: true,
            supports_tool_openai: false,
            supports_streaming: true,
            supports_response_format: false,
            supports_response_format_json_schema: false,
            supports_json_mode: false,
            accepts_response_format: false,
            accepts_reasoning_param: false,
            supports_vision: true,
            uses_responses_api: false,
            requires_tool_ordering: false,
            thinking_budget: None,
            max_output_tokens: None,
        }),
        None,
        None,
    )
    .await
    .expect("request should honor explicit provider capabilities");

    assert_eq!(response.content, "thinking disabled");
}

#[tokio::test]
async fn send_request_filters_deepseek_tools_and_omits_unsupported_fields() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .and(DeepSeekFilteredToolsMatcher {
            expected_names: vec![
                "read_file",
                "write_file",
                "execute_command",
                "get_current_workspace",
            ],
        })
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl-deepseek-1",
            "model": "deepseek-v4-pro",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "structured tools preserved"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 7,
                "completion_tokens": 3,
                "total_tokens": 10
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let allowed_tools = vec![
        "get_current_workspace".to_string(),
        "execute_command".to_string(),
        "read_file".to_string(),
        "write_file".to_string(),
    ];

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "deepseek-v4-pro",
        Some(&server.uri()),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("deepseek"),
        Some("openai"),
        Some(provider::ProviderCapabilities {
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
        }),
        Some(json!({ "type": "json_object" })),
        Some(&allowed_tools),
    )
    .await
    .expect("deepseek request should preserve filtered tools");

    assert_eq!(response.content, "structured tools preserved");
}

#[tokio::test]
async fn send_request_parses_openai_tool_calls_from_mock_server() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl-tool-1",
            "model": "gpt-4o",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"README.md\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }],
            "usage": {
                "prompt_tokens": 9,
                "completion_tokens": 4,
                "total_tokens": 13
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("openai"),
        Some("openai"),
        None,
        None,
        None,
    )
    .await
    .expect("tool call response should parse");

    assert_eq!(response.tool_calls.len(), 1);
    assert_eq!(response.tool_calls[0].tool_call_id, "call_1");
    assert_eq!(response.tool_calls[0].name, "read_file");
}

#[tokio::test]
async fn send_request_maps_openai_4xx_into_validation_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(400).set_body_string("invalid request payload"))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let error = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        None,
        false,
        false,
        None,
        false,
        None,
        Some("openai"),
        Some("openai"),
        None,
        None,
        None,
    )
    .await
    .expect_err("400 should fail fast");

    assert!(matches!(error, ClaudeHttpError::Validation { .. }));
}

#[tokio::test]
async fn send_request_finalizes_truncated_openai_stream() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(concat!(
                    "data: {\"id\":\"chatcmpl-stream-1\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n",
                    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"}}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n"
                )),
        )
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "gpt-4o",
        Some(&base_url),
        Some("system"),
        true,
        false,
        None,
        false,
        Some("stream-truncated"),
        Some("openai"),
        Some("openai"),
        None,
        None,
        None,
    )
    .await
    .expect("truncated stream should still finalize");

    assert_eq!(response.content, "hello world");
    assert_eq!(response.usage.input_tokens, 5);
    assert_eq!(response.usage.output_tokens, 2);
}

#[tokio::test]
async fn send_request_skips_response_format_when_capability_disables_it() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(ResponseFormatAbsentMatcher)
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl-4",
            "model": "deepseek-chat",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "ok"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 1,
                "total_tokens": 6
            }
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let base_url = format!("{}/v1", server.uri());

    let response = send_request(
        &client,
        &sample_messages(),
        "test-token",
        "deepseek-chat",
        Some(&base_url),
        Some("system"),
        false,
        false,
        None,
        false,
        None,
        Some("deepseek"),
        Some("openai"),
        Some(provider::ProviderCapabilities {
            supports_thinking: false,
            supports_reasoning: false,
            supports_reasoning_stream: false,
            supports_tool_calls: true,
            supports_tool_openai: true,
            supports_streaming: true,
            supports_response_format: false,
            supports_response_format_json_schema: false,
            supports_json_mode: false,
            accepts_response_format: false,
            accepts_reasoning_param: false,
            supports_vision: false,
            uses_responses_api: false,
            requires_tool_ordering: false,
            thinking_budget: None,
            max_output_tokens: Some(8192),
        }),
        Some(json!({ "type": "json_object" })),
        None,
    )
    .await
    .expect("request should succeed without response_format");

    assert_eq!(response.content, "ok");
}
