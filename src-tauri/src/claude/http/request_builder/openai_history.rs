use serde_json::{Map, Value};

use super::super::provider_adapter::ProviderCapabilities;
use crate::claude::message::Message;

pub(super) fn build_openai_user_content(message: &Message) -> Value {
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

pub(super) fn sanitize_openai_history_messages(
    messages: &mut [Value],
    capabilities: &ProviderCapabilities,
) {
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
