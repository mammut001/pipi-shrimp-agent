use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use super::error_mapping::ClaudeHttpError;
use super::provider_adapter::{ProviderCapabilities, ProviderId, ResolvedProviderConfig};
use super::telemetry::sanitize_endpoint;
use super::tool_catalog::{convert_tools_to_openai_format, get_tools, merge_system_prompt};
use crate::claude::message::{Artifact, Message, ToolCall};

static ARTIFACT_CODE_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```(\w+)?\n([\s\S]*?)\n```").unwrap());
static ARTIFACT_HTML_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<html[\s\S]*?</html>").unwrap());
static ARTIFACT_MERMAID_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```mermaid\n([\s\S]*?)\n```").unwrap());

const OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM: &str = r#"## Tool Calling Protocol
You MUST invoke tools via the OpenAI function-calling channel named tool_calls.
Do NOT write tool calls as text.
Do NOT emit <tool_calls>, <invoke>, <parameter>, XML, pseudo-XML, JSON snippets, or markdown code blocks to call tools.
Tool calls written in message content will be ignored by the runtime and counted as a failed turn.
If you need to use a tool, use the structured tool_calls channel only."#;

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
        if message.role == "user"
            && (message.content.starts_with("__TOOL_RESULT__:") || message.tool_call_id.is_some())
        {
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
                let input: Value = serde_json::from_str(&tool_call.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));
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
        if message.role == "user"
            && (message.content.starts_with("__TOOL_RESULT__:") || message.tool_call_id.is_some())
        {
            let (tool_call_id, content) = extract_tool_result(message);
            if let Some((tool_call_id, content)) = tool_call_id.zip(content) {
                formatted.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content,
                }));
            } else {
                eprintln!(
                    "[request_builder] Dropping unparseable tool result (content_prefix={:?})",
                    message.content.chars().take(80).collect::<String>()
                );
            }
            continue;
        }

        if let Some(tool_calls) = &message.tool_calls {
            let mut assistant = serde_json::json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": tool_calls.iter().map(format_openai_tool_call).collect::<Vec<_>>(),
            });
            if let Some(reasoning) = message
                .reasoning
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                assistant
                    .as_object_mut()
                    .expect("assistant message object")
                    .insert(
                        "reasoning_content".to_string(),
                        Value::String(reasoning.to_string()),
                    );
            }
            formatted.push(assistant);
            continue;
        }

        let mut formatted_message = serde_json::json!({
            "role": message.role,
            "content": if message.role == "user" && has_image_attachments(message) {
                build_openai_user_content(message)
            } else {
                Value::String(message.content.clone())
            },
        });
        if message.role == "assistant" {
            if let Some(reasoning) = message
                .reasoning
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                formatted_message
                    .as_object_mut()
                    .expect("formatted message object")
                    .insert(
                        "reasoning_content".to_string(),
                        Value::String(reasoning.to_string()),
                    );
            }
        }
        formatted.push(formatted_message);
    }

    formatted
}

fn sanitize_openai_history_messages(messages: &mut [Value], capabilities: &ProviderCapabilities) {
    for message in messages {
        let Some(record) = message.as_object_mut() else {
            continue;
        };

        let role = record
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if role == "assistant" {
            let sanitized = sanitize_assistant_message_for_openai_record(record, capabilities);
            *record = sanitized;
            continue;
        }

        if !capabilities.accepts_reasoning_param {
            remove_hidden_reasoning_fields(record);
        }
    }
}

fn remove_hidden_reasoning_fields(record: &mut Map<String, Value>) {
    record.remove("reasoning");
    record.remove("reasoning_effort");
    record.remove("reasoning_content");
    record.remove("thinking");
    record.remove("reasoning_trace");
}

fn sanitize_assistant_message_for_openai_record(
    record: &Map<String, Value>,
    capabilities: &ProviderCapabilities,
) -> Map<String, Value> {
    let mut sanitized = Map::new();
    sanitized.insert("role".to_string(), Value::String("assistant".to_string()));
    sanitized.insert(
        "content".to_string(),
        record
            .get("content")
            .cloned()
            .unwrap_or_else(|| Value::String(String::new())),
    );

    if let Some(tool_calls) = record.get("tool_calls") {
        sanitized.insert("tool_calls".to_string(), tool_calls.clone());
    }
    if let Some(name) = record.get("name") {
        sanitized.insert("name".to_string(), name.clone());
    }
    if let Some(tool_call_id) = record.get("tool_call_id") {
        sanitized.insert("tool_call_id".to_string(), tool_call_id.clone());
    }

    // DeepSeek (and similar OpenAI-compatible reasoners) require the prior
    // assistant turn's reasoning_content to be passed back on tool continuation
    // rounds. Preserve non-empty history passback even when supports_reasoning
    // is false (e.g. Custom openai-compatible + deepseek-flash), distinct from
    // request-level reasoning/reasoning_effort params gated by
    // accepts_reasoning_param.
    if let Some(reasoning_content) = record.get("reasoning_content") {
        let keep = match reasoning_content {
            Value::String(s) => !s.trim().is_empty(),
            Value::Null => false,
            _ => true,
        };
        if keep {
            sanitized.insert("reasoning_content".to_string(), reasoning_content.clone());
        }
    }

    if capabilities.accepts_reasoning_param {
        if let Some(reasoning) = record.get("reasoning") {
            sanitized.insert("reasoning".to_string(), reasoning.clone());
        }
        if let Some(reasoning_effort) = record.get("reasoning_effort") {
            sanitized.insert("reasoning_effort".to_string(), reasoning_effort.clone());
        }
    }

    sanitized
}

fn build_openai_system_prompt(
    config: &ResolvedProviderConfig,
    system_prompt: Option<&str>,
    allow_browser_tools: bool,
    no_tools: bool,
) -> String {
    let mut merged = merge_system_prompt(system_prompt, allow_browser_tools);
    if !no_tools && config.capabilities.supports_tool_openai {
        merged.push_str("\n\n");
        merged.push_str(OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM);
    }
    merged
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
    // The Anthropic endpoint is always <host>/v1/messages. Some callers supply
    // the conventional "https://api.anthropic.com/v1" base URL (with a trailing
    // "/v1"), which would otherwise produce a doubled "/v1/v1/messages" path.
    // Strip a trailing "/v1" so both "https://api.anthropic.com" and
    // "https://api.anthropic.com/v1" resolve to the same correct endpoint.
    let base = sanitize_endpoint(base_url);
    let base = base
        .strip_suffix("/v1")
        .map(str::to_string)
        .unwrap_or(base);
    format!("{}/v1/messages", base)
}

pub fn build_openai_url(config: &ResolvedProviderConfig) -> String {
    format!("{}/chat/completions", sanitize_endpoint(&config.base_url))
}

pub fn build_anthropic_headers(
    api_key: &str,
    thinking_enabled: bool,
) -> Result<reqwest::header::HeaderMap, ClaudeHttpError> {
    let mut headers = reqwest::header::HeaderMap::new();
    // AUDIT-FIX [fix-2#18] — `clean_key` was filtering out *all* non-ASCII
    // characters. The HTTP header parser (`reqwest::header`) already rejects
    // control characters and whitespace, and Bearer headers (RFC 6750)
    // allow any printable ASCII (or even BASE64URL with extended charset in
    // some cases). We now keep printable non-control non-whitespace
    // characters and only strip CR/LF/TAB/null, which is what the header
    // parser would have rejected anyway. This means non-ASCII provider keys
    // (some regional providers use them) are no longer silently truncated.
    let clean_key: String = sanitize_header_value(api_key);

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
        headers.insert(
            "anthropic-beta",
            "interleaved-thinking-2025-05-14".parse().unwrap(),
        );
    }
    Ok(headers)
}

pub fn build_openai_headers(api_key: &str) -> Result<reqwest::header::HeaderMap, ClaudeHttpError> {
    let mut headers = reqwest::header::HeaderMap::new();
    // See [fix-2#18] above.
    let clean_key: String = sanitize_header_value(api_key);

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

/// Strip only the characters that HTTP header values explicitly forbid
/// (CR, LF, NUL) plus leading/trailing whitespace and a `Bearer ` prefix.
/// Other characters — including non-ASCII — are preserved so international
/// providers are not silently broken.
fn sanitize_header_value(api_key: &str) -> String {
    let trimmed = api_key.trim();
    let trimmed = if trimmed.to_lowercase().starts_with("bearer ") {
        trimmed[7..].trim()
    } else {
        trimmed
    };
    trimmed
        .chars()
        .filter(|c| !matches!(*c, '\r' | '\n' | '\t' | '\0'))
        .collect()
}

pub fn build_anthropic_body(
    config: &ResolvedProviderConfig,
    messages: &[Message],
    system_prompt: Option<&str>,
    allow_browser_tools: bool,
    no_tools: bool,
    streaming: bool,
) -> Value {
    let thinking_enabled = config.capabilities.supports_thinking;
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
    let system_content =
        build_openai_system_prompt(config, system_prompt, allow_browser_tools, no_tools);
    let mut openai_messages = format_messages_for_openai(messages);
    openai_messages.insert(
        0,
        serde_json::json!({
            "role": "system",
            "content": system_content,
        }),
    );
    sanitize_openai_history_messages(&mut openai_messages, &config.capabilities);

    let mut body = serde_json::json!({
        "model": config.model,
        "messages": openai_messages,
        "max_tokens": config.capabilities.max_output_tokens.unwrap_or(32_768),
        "stream": streaming,
    });

    if streaming {
        body["stream_options"] = serde_json::json!({
            "include_usage": true
        });
    }

    if !no_tools {
        let tool_strict = config.capabilities.supports_response_format_json_schema;
        body["tools"] = serde_json::json!(convert_tools_to_openai_format(
            &get_tools(allow_browser_tools),
            tool_strict,
        ));
        body["tool_choice"] = serde_json::json!("auto");
    }

    if config.provider_id == ProviderId::MiniMax && config.capabilities.supports_reasoning {
        body["reasoning_split"] = serde_json::json!(true);
    }

    // DeepSeek flash/v4 default to thinking mode. With tools, the API then requires
    // every assistant reasoning_content to be replayed. Disable thinking for
    // DeepSeek-like OpenAI-compatible requests so tool rounds stay reliable;
    // reasoning passback remains implemented for providers that leave thinking on.
    if should_disable_deepseek_thinking(config) {
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }

    body
}

fn should_disable_deepseek_thinking(config: &ResolvedProviderConfig) -> bool {
    if config.provider_id == ProviderId::DeepSeek {
        return true;
    }
    let model = config.model.to_ascii_lowercase();
    let base = config.base_url.to_ascii_lowercase();
    base.contains("deepseek.com")
        || model.contains("deepseek")
        || (config.provider_id == ProviderId::Custom
            && (model.contains("flash") || model.contains("v4") || model.contains("reasoner")))
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
            estimate_messages_tokens(&formatted)
                + estimate_tokens(&merge_system_prompt(system_prompt, allow_browser_tools))
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
mod tests;
