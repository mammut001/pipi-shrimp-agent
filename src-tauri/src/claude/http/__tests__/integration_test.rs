use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use serde_json::json;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, Request, Respond, ResponseTemplate,
};

use super::super::super::http_client::send_request;
use super::super::super::message::Message;

fn sample_messages() -> Vec<Message> {
    vec![Message {
        role: "user".to_string(),
        content: "hello".to_string(),
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
    )
    .await
    .expect("request should succeed after retry");

    assert_eq!(response.content, "retry worked");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}
