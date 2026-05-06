use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use super::error_mapping::ClaudeHttpError;
use super::provider_adapter::{ProviderId, ResolvedProviderConfig};
use super::telemetry::sanitize_endpoint;
use super::tool_catalog::{convert_tools_to_openai_format, get_tools, merge_system_prompt};
use crate::claude::message::{Artifact, Message, ToolCall};

static ARTIFACT_CODE_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```(\w+)?\n([\s\S]*?)\n```").unwrap());
static ARTIFACT_HTML_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<html[\s\S]*?</html>").unwrap());
static ARTIFACT_MERMAID_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```mermaid\n([\s\S]*?)\n```").unwrap());

pub fn estimate_tokens(text: &str) -> i32 {
    crate::utils::token::estimate_tokens(text)
}

pub fn estimate_messages_tokens(messages: &[Value]) -> i32 {
    messages
        .iter()
        .map(|message| {
            let content = message.get("content").cloned().unwrap_or(Value::Null);
            estimate_tokens(&content.to_string()) + 4
        })
        .sum::<i32>()
        + 2
}

fn has_image_attachments(message: &Message) -> bool {
    message
        .attachments
        .as_ref()
        .map(|attachments| !attachments.is_empty())
        .unwrap_or(false)
}

fn build_anthropic_user_content(message: &Message) -> Value {
    let mut content = Vec::new();

    if !message.content.is_empty() {
        content.push(serde_json::json!({
            "type": "text",
            "text": message.content,
        }));
    }

    if let Some(attachments) = &message.attachments {
        for attachment in attachments {
            content.push(serde_json::json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": attachment.mime,
                    "data": attachment.data,
                }
            }));
        }
    }

    if content.is_empty() {
        Value::String(message.content.clone())
    } else {
        Value::Array(content)
    }
}

fn build_openai_user_content(message: &Message) -> Value {
    let mut content = Vec::new();

    if !message.content.is_empty() {
        content.push(serde_json::json!({
            "type": "text",
            "text": message.content,
        }));
    }

    if let Some(attachments) = &message.attachments {
        for attachment in attachments {
            content.push(serde_json::json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", attachment.mime, attachment.data),
                }
            }));
        }
    }

    if content.is_empty() {
        Value::String(message.content.clone())
    } else {
        Value::Array(content)
    }
}

pub fn supports_thinking(model: &str) -> bool {
    model.contains("claude-3-7")
        || model.contains("claude-opus-4")
        || model.contains("claude-sonnet-4")
        || model.contains("claude-haiku-4")
}

pub fn detect_artifacts(content: &str) -> Vec<Artifact> {
    let mut artifacts = Vec::new();

    for captures in ARTIFACT_CODE_REGEX.captures_iter(content) {
        let language = captures.get(1).map_or("plaintext", |value| value.as_str());
        let code = captures.get(2).map_or("", |value| value.as_str());
        if code.len() > 200 {
            artifacts.push(Artifact {
                artifact_type: "code".to_string(),
                content: code.to_string(),
                title: Some(format!("{} code", language)),
                language: Some(language.to_string()),
            });
        }
    }

    if content.contains("<!DOCTYPE") || content.contains("<html") {
        if let Some(html_match) = ARTIFACT_HTML_REGEX.find(content) {
            artifacts.push(Artifact {
                artifact_type: "html".to_string(),
                content: html_match.as_str().to_string(),
                title: Some("HTML Document".to_string()),
                language: None,
            });
        }
    }

    for captures in ARTIFACT_MERMAID_REGEX.captures_iter(content) {
        if let Some(diagram) = captures.get(1) {
            artifacts.push(Artifact {
                artifact_type: "mermaid".to_string(),
                content: diagram.as_str().to_string(),
                title: Some("Diagram".to_string()),
                language: None,
            });
        }
    }

    artifacts
}

pub fn format_messages_for_anthropic(messages: &[Message]) -> Vec<Value> {
    let mut formatted = Vec::new();

    for message in messages {
        if message.role == "user" && (message.content.starts_with("__TOOL_RESULT__:") || message.tool_call_id.is_some()) {
            let (tool_call_id, content) = extract_tool_result(message);
            if let Some((tool_call_id, content)) = tool_call_id.zip(content) {
                formatted.push(serde_json::json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": content,
                    }]
                }));
            }
            continue;
        }

        if let Some(tool_calls) = &message.tool_calls {
            let mut content = Vec::new();
            if !message.content.is_empty() {
                content.push(serde_json::json!({ "type": "text", "text": message.content }));
            }
            for tool_call in tool_calls {
                let input: Value = serde_json::from_str(&tool_call.arguments).unwrap_or_else(|_| serde_json::json!({}));
                content.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tool_call.tool_call_id,
                    "name": tool_call.name,
                    "input": input,
                }));
            }
            formatted.push(serde_json::json!({ "role": "assistant", "content": content }));
            continue;
        }

        formatted.push(serde_json::json!({
            "role": if message.role == "assistant" { "assistant" } else { "user" },
            "content": if message.role == "user" && has_image_attachments(message) {
                build_anthropic_user_content(message)
            } else {
                Value::String(message.content.clone())
            },
        }));
    }

    formatted
}

pub fn format_messages_for_openai(messages: &[Message]) -> Vec<Value> {
    let mut formatted = Vec::new();

    for message in messages {
        if message.role == "user" && (message.content.starts_with("__TOOL_RESULT__:") || message.tool_call_id.is_some()) {
            let (tool_call_id, content) = extract_tool_result(message);
            if let Some((tool_call_id, content)) = tool_call_id.zip(content) {
                formatted.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content,
                }));
            }
            continue;
        }

        if let Some(tool_calls) = &message.tool_calls {
            formatted.push(serde_json::json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": tool_calls.iter().map(format_openai_tool_call).collect::<Vec<_>>(),
            }));
            continue;
        }

        formatted.push(serde_json::json!({
            "role": message.role,
            "content": if message.role == "user" && has_image_attachments(message) {
                build_openai_user_content(message)
            } else {
                Value::String(message.content.clone())
            },
        }));
    }

    formatted
}

fn format_openai_tool_call(tool_call: &ToolCall) -> Value {
    let arguments = if tool_call.arguments.trim().is_empty() {
        "{}".to_string()
    } else if serde_json::from_str::<Value>(&tool_call.arguments).is_ok() {
        tool_call.arguments.clone()
    } else if !tool_call.arguments.contains('{') && !tool_call.arguments.contains('}') {
        format!("\"{}\"", tool_call.arguments.replace('"', "\\\""))
    } else {
        "{}".to_string()
    };

    serde_json::json!({
        "id": tool_call.tool_call_id,
        "type": "function",
        "function": {
            "name": tool_call.name,
            "arguments": arguments,
        }
    })
}

fn extract_tool_result(message: &Message) -> (Option<String>, Option<String>) {
    if let Some(tool_call_id) = &message.tool_call_id {
        let clean_content = if let Some(rest) = message.content.strip_prefix("__TOOL_RESULT__:") {
            if let Some(colon_pos) = rest.find(':') {
                rest[colon_pos + 1..].to_string()
            } else {
                message.content.clone()
            }
        } else {
            message.content.clone()
        };
        return (Some(tool_call_id.clone()), Some(clean_content));
    }

    if let Some(rest) = message.content.strip_prefix("__TOOL_RESULT__:") {
        let parts: Vec<&str> = rest.splitn(2, ':').collect();
        if parts.len() == 2 {
            return (Some(parts[0].to_string()), Some(parts[1].to_string()));
        }
    }

    (None, None)
}

pub fn build_anthropic_url(base_url: &str) -> String {
    format!("{}/v1/messages", sanitize_endpoint(base_url))
}

pub fn build_openai_url(config: &ResolvedProviderConfig) -> String {
    format!("{}/chat/completions", sanitize_endpoint(&config.base_url))
}

pub fn build_anthropic_headers(
    api_key: &str,
    thinking_enabled: bool,
) -> Result<reqwest::header::HeaderMap, ClaudeHttpError> {
    let mut headers = reqwest::header::HeaderMap::new();
    let trimmed = api_key.trim();
    let trimmed = if trimmed.to_lowercase().starts_with("bearer ") {
        trimmed[7..].trim()
    } else {
        trimmed
    };
    let clean_key: String = trimmed
        .chars()
        .filter(|c| c.is_ascii() && !c.is_control() && !c.is_whitespace())
        .collect();

    headers.insert(
        "x-api-key",
        clean_key.parse().map_err(|_| ClaudeHttpError::Validation {
            field: "api_key".to_string(),
            message: "Invalid API key header".to_string(),
        })?,
    );
    headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
    headers.insert("content-type", "application/json".parse().unwrap());
    if thinking_enabled {
        headers.insert("anthropic-beta", "interleaved-thinking-2025-05-14".parse().unwrap());
    }
    Ok(headers)
}

pub fn build_openai_headers(api_key: &str) -> Result<reqwest::header::HeaderMap, ClaudeHttpError> {
    let mut headers = reqwest::header::HeaderMap::new();
    let trimmed = api_key.trim();
    let trimmed = if trimmed.to_lowercase().starts_with("bearer ") {
        trimmed[7..].trim()
    } else {
        trimmed
    };
    let clean_key: String = trimmed
        .chars()
        .filter(|c| c.is_ascii() && !c.is_control() && !c.is_whitespace())
        .collect();

    let bearer = format!("Bearer {}", clean_key);
    headers.insert(
        "Authorization",
        bearer.parse().map_err(|_| ClaudeHttpError::Validation {
            field: "api_key".to_string(),
            message: "Invalid bearer token".to_string(),
        })?,
    );
    headers.insert("content-type", "application/json".parse().unwrap());
    Ok(headers)
}

pub fn build_anthropic_body(
    config: &ResolvedProviderConfig,
    messages: &[Message],
    system_prompt: Option<&str>,
    allow_browser_tools: bool,
    no_tools: bool,
    streaming: bool,
) -> Value {
    let thinking_enabled = config.capabilities.supports_thinking || supports_thinking(&config.model);
    let max_tokens = if thinking_enabled { 64_000 } else { 16_384 };
    let mut body = serde_json::json!({
        "model": config.model,
        "max_tokens": max_tokens,
        "stream": streaming,
        "messages": format_messages_for_anthropic(messages),
        "system": merge_system_prompt(system_prompt, allow_browser_tools),
    });

    if !no_tools {
        body["tools"] = serde_json::json!(get_tools(allow_browser_tools));
    }

    if thinking_enabled {
        body["thinking"] = serde_json::json!({
            "type": "enabled",
            "budget_tokens": config.capabilities.thinking_budget.unwrap_or(16_000),
        });
    }

    body
}

pub fn build_openai_body(
    config: &ResolvedProviderConfig,
    messages: &[Message],
    system_prompt: Option<&str>,
    allow_browser_tools: bool,
    no_tools: bool,
    streaming: bool,
) -> Value {
    let mut openai_messages = format_messages_for_openai(messages);
    openai_messages.insert(
        0,
        serde_json::json!({
            "role": "system",
            "content": merge_system_prompt(system_prompt, allow_browser_tools),
        }),
    );

    let mut body = serde_json::json!({
        "model": config.model,
        "messages": openai_messages,
        "max_tokens": config.capabilities.max_output_tokens.unwrap_or(32_768),
        "stream": streaming,
    });

    if !no_tools {
        body["tools"] = serde_json::json!(convert_tools_to_openai_format(&get_tools(allow_browser_tools)));
    }

    body
}

pub fn estimate_request_input_tokens(
    provider_id: ProviderId,
    messages: &[Message],
    system_prompt: Option<&str>,
    allow_browser_tools: bool,
) -> i32 {
    match provider_id {
        ProviderId::Anthropic => {
            let formatted = format_messages_for_anthropic(messages);
            estimate_messages_tokens(&formatted) + estimate_tokens(&merge_system_prompt(system_prompt, allow_browser_tools))
        }
        _ => {
            let mut formatted = format_messages_for_openai(messages);
            formatted.insert(
                0,
                serde_json::json!({
                    "role": "system",
                    "content": merge_system_prompt(system_prompt, allow_browser_tools),
                }),
            );
            estimate_messages_tokens(&formatted)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_message(role: &str, content: &str) -> Message {
        Message {
            role: role.to_string(),
            content: content.to_string(),
            attachments: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    #[test]
    fn detects_artifacts_from_code_html_and_mermaid() {
        assert_eq!(detect_artifacts("```mermaid\nA-->B\n```")[0].artifact_type, "mermaid");
        assert_eq!(detect_artifacts("<!DOCTYPE html><html><body>ok</body></html>")[0].artifact_type, "html");
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
        let config = ResolvedProviderConfig::resolve("gpt-4o", "token", Some("https://api.example.com/v1"), None);
        assert_eq!(build_openai_url(&config), "https://api.example.com/v1/chat/completions");
        assert!(build_openai_headers("token").is_ok());
        assert_eq!(build_anthropic_url("https://api.anthropic.com/"), "https://api.anthropic.com/v1/messages");
        assert!(build_anthropic_headers("sk-ant-test", true).is_ok());
    }
}
