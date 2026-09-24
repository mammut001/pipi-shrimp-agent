//! Unit tests for request_builder.rs moved verbatim out of request_builder.rs.

use super::*;

fn sample_message(role: &str, content: &str) -> Message {
    Message {
        role: role.to_string(),
        content: content.to_string(),
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
        reasoning: None,
    }
}

#[test]
fn detects_artifacts_from_code_html_and_mermaid() {
    assert_eq!(
        detect_artifacts("```mermaid\nA-->B\n```")[0].artifact_type,
        "mermaid"
    );
    assert_eq!(
        detect_artifacts("<!DOCTYPE html><html><body>ok</body></html>")[0].artifact_type,
        "html"
    );
    let large_code = format!("```rust\n{}\n```", "x".repeat(240));
    assert_eq!(detect_artifacts(&large_code)[0].artifact_type, "code");
}

#[test]
fn formats_tool_calls_for_openai_and_anthropic() {
    let messages = vec![Message {
        role: "assistant".to_string(),
        content: "".to_string(),
        attachments: None,
        tool_calls: Some(vec![ToolCall {
            tool_call_id: "tool-1".to_string(),
            name: "read_file".to_string(),
            arguments: "{\"path\":\"/tmp/a\"}".to_string(),
        }]),
        tool_call_id: None,
        reasoning: None,
    }];
    let anthropic = format_messages_for_anthropic(&messages);
    let openai = format_messages_for_openai(&messages);
    assert_eq!(anthropic[0]["role"], "assistant");
    assert_eq!(openai[0]["role"], "assistant");
    assert!(openai[0]["tool_calls"].is_array());
}

#[test]
fn formats_image_attachments_for_anthropic_and_openai() {
    let messages = vec![Message {
        role: "user".to_string(),
        content: "describe this".to_string(),
        attachments: Some(vec![crate::claude::message::ImageAttachment {
            id: "img-1".to_string(),
            source: "upload".to_string(),
            mime: "image/png".to_string(),
            bytes: 42,
            width: None,
            height: None,
            encoding: "base64".to_string(),
            data: "ZmFrZQ==".to_string(),
            origPath: Some("a.png".to_string()),
            caption: None,
            createdAt: 1,
        }]),
        tool_calls: None,
        tool_call_id: None,
        reasoning: None,
    }];

    let anthropic = format_messages_for_anthropic(&messages);
    let openai = format_messages_for_openai(&messages);

    assert_eq!(anthropic[0]["content"][0]["type"], "text");
    assert_eq!(anthropic[0]["content"][1]["type"], "image");
    assert_eq!(openai[0]["content"][0]["type"], "text");
    assert_eq!(openai[0]["content"][1]["type"], "image_url");
}

#[test]
fn builds_provider_specific_urls_and_headers() {
    let config = ResolvedProviderConfig::resolve(
        "gpt-4o",
        "token",
        Some("https://api.example.com/v1"),
        None,
    );
    assert_eq!(
        build_openai_url(&config),
        "https://api.example.com/v1/chat/completions"
    );
    assert!(build_openai_headers("token").is_ok());
    assert_eq!(
        build_anthropic_url("https://api.anthropic.com/"),
        "https://api.anthropic.com/v1/messages"
    );
    // Callers that supply the conventional ".../v1" base URL must NOT end
    // up with a doubled "/v1/v1/messages" path.
    assert_eq!(
        build_anthropic_url("https://api.anthropic.com/v1"),
        "https://api.anthropic.com/v1/messages"
    );
    assert_eq!(
        build_anthropic_url("https://api.anthropic.com/v1/"),
        "https://api.anthropic.com/v1/messages"
    );
    // A proxy mounted under a subpath is still handled correctly.
    assert_eq!(
        build_anthropic_url("https://proxy.example.com/anthropic/v1"),
        "https://proxy.example.com/anthropic/v1/messages"
    );
    assert!(build_anthropic_headers("sk-ant-test", true).is_ok());
}

#[test]
fn sanitizes_openai_history_keeps_reasoning_content_without_request_params() {
    let mut messages = vec![serde_json::json!({
        "role": "assistant",
        "content": "visible answer",
        "reasoning_content": "internal trace",
        "reasoning": { "type": "chain_of_thought" },
        "reasoning_effort": "high",
        "thinking": "draft",
        "reasoning_trace": ["a", "b"],
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "execute_command",
                "arguments": "{\"command\":\"ls -la\"}"
            }
        }]
    })];

    sanitize_openai_history_messages(
        &mut messages,
        &ProviderCapabilities {
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
        },
    );

    // Message-history reasoning_content must survive even when the provider
    // capability map says supports_reasoning=false (DeepSeek flash via Custom).
    assert_eq!(
        messages[0].get("reasoning_content"),
        Some(&serde_json::json!("internal trace"))
    );
    // Request-level / hidden reasoning params stay stripped.
    assert_eq!(messages[0].get("reasoning"), None);
    assert_eq!(messages[0].get("reasoning_effort"), None);
    assert_eq!(messages[0].get("thinking"), None);
    assert_eq!(messages[0].get("reasoning_trace"), None);
    assert_eq!(messages[0]["content"], "visible answer");
    assert_eq!(
        messages[0]["tool_calls"][0]["function"]["name"],
        "execute_command"
    );
}

#[test]
fn preserves_assistant_reasoning_content_for_deepseek_tool_continuation() {
    let messages = vec![
        sample_message("user", "list files"),
        Message {
            role: "assistant".to_string(),
            content: "".to_string(),
            attachments: None,
            tool_calls: Some(vec![ToolCall {
                tool_call_id: "call_1".to_string(),
                name: "execute_command".to_string(),
                arguments: "{\"command\":\"ls -la\"}".to_string(),
            }]),
            tool_call_id: None,
            reasoning: Some("I should list the directory.".to_string()),
        },
        Message {
            role: "user".to_string(),
            content: "__TOOL_RESULT__:call_1:README.md".to_string(),
            attachments: None,
            tool_calls: None,
            tool_call_id: Some("call_1".to_string()),
            reasoning: None,
        },
    ];

    let config = ResolvedProviderConfig {
        provider_id: ProviderId::DeepSeek,
        api_format: super::super::provider_adapter::ApiFormat::OpenAI,
        base_url: "https://api.deepseek.com".to_string(),
        api_key: "token".to_string(),
        model: "deepseek-v4-pro".to_string(),
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
    };

    let body = build_openai_body(&config, &messages, Some("system"), false, false, true);
    let history = body["messages"].as_array().expect("messages array");
    let assistant = history
        .iter()
        .find(|message| message.get("role") == Some(&serde_json::json!("assistant")))
        .expect("assistant message");

    assert_eq!(
        assistant.get("reasoning_content"),
        Some(&serde_json::json!("I should list the directory."))
    );
    assert!(assistant.get("tool_calls").is_some());
}

#[test]
fn keeps_assistant_reasoning_content_even_when_supports_reasoning_false() {
    let mut messages = vec![serde_json::json!({
        "role": "assistant",
        "content": null,
        "reasoning_content": "internal trace",
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "execute_command",
                "arguments": "{\"command\":\"ls -la\"}"
            }
        }]
    })];

    sanitize_openai_history_messages(
        &mut messages,
        &ProviderCapabilities {
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
        },
    );

    assert_eq!(
        messages[0].get("reasoning_content"),
        Some(&serde_json::json!("internal trace"))
    );
    assert!(messages[0].get("tool_calls").is_some());
}

#[test]
fn builds_deepseek_openai_body_with_tools_and_tool_choice() {
    let config = ResolvedProviderConfig {
        provider_id: ProviderId::DeepSeek,
        api_format: super::super::provider_adapter::ApiFormat::OpenAI,
        base_url: "https://api.deepseek.com".to_string(),
        api_key: "token".to_string(),
        model: "deepseek-v4-pro".to_string(),
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
    };

    let body = build_openai_body(
        &config,
        &[sample_message("user", "ping")],
        Some("system"),
        false,
        false,
        true,
    );

    assert_eq!(body["tool_choice"], "auto");
    assert!(body["tools"]
        .as_array()
        .is_some_and(|tools| !tools.is_empty()));
    let system_text = body["messages"][0]["content"].as_str().unwrap_or_default();
    assert!(system_text.contains("OpenAI function-calling channel named tool_calls"));
}

#[test]
fn builds_minimax_m3_body_with_reasoning_split() {
    let config = ResolvedProviderConfig::resolve(
        "minimax-m3",
        "token",
        Some("https://api.minimaxi.com/v1"),
        Some(ProviderId::MiniMax),
    );

    let body = build_openai_body(
        &config,
        &[sample_message("user", "ping")],
        None,
        false,
        true,
        true,
    );

    assert_eq!(body["reasoning_split"], serde_json::json!(true));
}

#[test]
fn builds_openai_body_with_strict_tools_when_supported() {
    let config = ResolvedProviderConfig::resolve("gpt-4o", "sk-test", None, None);

    let body = build_openai_body(
        &config,
        &[sample_message("user", "ping")],
        None,
        false,
        false,
        true,
    );

    let tools = body["tools"].as_array().expect("tools array");
    assert!(!tools.is_empty());
    assert!(
        tools
            .iter()
            .all(|tool| tool["function"]["strict"] == serde_json::json!(true)),
        "OpenAI provider should emit strict tool definitions"
    );
}
