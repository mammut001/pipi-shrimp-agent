/**
 * Claude HTTP Client
 *
 * Pure Rust implementation for calling Anthropic API directly
 * Replaces Node.js subprocess approach
 */

use crate::utils::{AppResult, AppError};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
use tauri::Window;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::message::{Artifact, ChatResponse, ErrorResponse, Message, ToolCall, UsageInfo};

/// Global cancellation token for stopping in-flight requests
static CANCEL_TOKEN: Lazy<Mutex<Option<CancellationToken>>> =
    Lazy::new(|| Mutex::new(None));

/// Claude HTTP client using reqwest
pub struct ClaudeClient {
    client: reqwest::Client,
}

impl ClaudeClient {
    /// Create a new Claude client (no node script path needed)
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("Failed to build HTTP client");
        Self { client }
    }
}

/**
 * Tool definitions for Anthropic Function Calling
 * Matches the 9 tools from claude-sdk.js
 */
pub fn get_tools() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "read_file",
            "description": "Read the contents of a file from the filesystem. Use this when you need to see what is inside a file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The absolute path to the file to read"
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "write_file",
            "description": "Write content to a file. Use this to create new files or overwrite existing ones.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The absolute path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "The content to write to the file"
                    }
                },
                "required": ["path", "content"]
            }
        }),
        serde_json::json!({
            "name": "execute_command",
            "description": "Execute a bash command in the terminal. Use this to run shell commands, git operations, npm commands, etc.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "The working directory for the command (optional)"
                    }
                },
                "required": ["command"]
            }
        }),
        serde_json::json!({
            "name": "list_files",
            "description": "List files in a directory. Use this to explore the file structure.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The directory path to list"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Optional glob pattern to filter files (e.g., \"*.ts\", \"src/**\")"
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "create_directory",
            "description": "Create a new directory (and parent directories if needed).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The directory path to create"
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "path_exists",
            "description": "Check if a file or directory exists.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The path to check"
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "search_files",
            "description": "Search for a pattern in files using ripgrep (rg). Supports regex patterns and file type filtering.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "The search pattern (supports regex)"
                    },
                    "path": {
                        "type": "string",
                        "description": "The directory path to search in"
                    },
                    "extensions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional list of file extensions to filter (e.g., [\"rs\", \"ts\"])"
                    }
                },
                "required": ["pattern", "path"]
            }
        }),
        serde_json::json!({
            "name": "glob_search",
            "description": "Find files matching a glob pattern (e.g., \"**/*.rs\", \"src/**/*.ts\").",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "The glob pattern (e.g., \"**/*.rs\", \"*.ts\")"
                    },
                    "path": {
                        "type": "string",
                        "description": "The directory path to search in"
                    }
                },
                "required": ["pattern", "path"]
            }
        }),
        serde_json::json!({
            "name": "grep_files",
            "description": "Fallback grep search when ripgrep is not available. Search for a pattern in files.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "The search pattern"
                    },
                    "path": {
                        "type": "string",
                        "description": "The file path or directory to search in"
                    }
                },
                "required": ["pattern", "path"]
            }
        }),
    ]
}

/**
 * Convert Anthropic-format tools to OpenAI-compatible format.
 * Anthropic: { "name", "description", "input_schema": {...} }
 * OpenAI:    { "type": "function", "function": { "name", "description", "parameters": {...} } }
 */
pub fn convert_tools_to_openai_format(tools: &[serde_json::Value]) -> Vec<serde_json::Value> {
    tools.iter().map(|tool| {
        let name = tool["name"].clone();
        let description = tool["description"].clone();
        let parameters = tool.get("input_schema").cloned()
            .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));
        serde_json::json!({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters
            }
        })
    }).collect()
}

/**
 * Detect artifacts from response content
 * - Code blocks > 200 chars
 * - HTML documents
 * - Mermaid diagrams
 */
pub fn detect_artifacts(content: &str) -> Vec<Artifact> {
    let mut artifacts = Vec::new();

    // Code blocks: ```language\ncode\n```
    let code_block_regex = Regex::new(r"```(\w+)?\n([\s\S]*?)\n```").unwrap();
    for cap in code_block_regex.captures_iter(content) {
        let language = cap.get(1).map_or("plaintext", |m| m.as_str());
        let code = cap.get(2).map_or("", |m| m.as_str());

        // Only include code blocks > 200 chars
        if code.len() > 200 {
            artifacts.push(Artifact {
                artifact_type: "code".to_string(),
                content: code.to_string(),
                title: Some(format!("{} code", language)),
                language: Some(language.to_string()),
            });
        }
    }

    // HTML: <!DOCTYPE or <html>...</html>
    if content.contains("<!DOCTYPE") || content.contains("<html") {
        if let Some(html_match) = Regex::new(r"<html[\s\S]*?</html>").unwrap().find(content) {
            artifacts.push(Artifact {
                artifact_type: "html".to_string(),
                content: html_match.as_str().to_string(),
                title: Some("HTML Document".to_string()),
                language: None,
            });
        }
    }

    // Mermaid: ```mermaid\ndiagram\n```
    let mermaid_regex = Regex::new(r"```mermaid\n([\s\S]*?)\n```").unwrap();
    for cap in mermaid_regex.captures_iter(content) {
        if let Some(diagram) = cap.get(1) {
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

/**
 * Format messages for Anthropic API
 * Handles tool results and assistant tool calls
 */
pub fn format_messages_for_anthropic(messages: &[Message]) -> Vec<serde_json::Value> {
    let mut formatted = Vec::new();

    for msg in messages {
        // 1. Handle tool results (role: user with tool_call_id)
        if msg.role == "user" && (msg.content.starts_with("__TOOL_RESULT__:") || msg.tool_call_id.is_some()) {
            let (tool_call_id, content) = if let Some(ref id) = msg.tool_call_id {
                (id.clone(), msg.content.clone())
            } else if let Some(cap) = msg.content.strip_prefix("__TOOL_RESULT__:").and_then(|s| {
                let parts: Vec<&str> = s.splitn(2, ':').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            }) {
                cap
            } else {
                continue;
            };

            formatted.push(serde_json::json!({
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": content
                    }
                ]
            }));
            continue;
        }

        // 2. Handle assistant messages with tool calls
        if msg.role == "assistant" && msg.tool_calls.is_some() {
            let tool_calls = msg.tool_calls.as_ref().unwrap();
            let mut content = Vec::new();

            if !msg.content.is_empty() {
                content.push(serde_json::json!({
                    "type": "text",
                    "text": msg.content
                }));
            }

            for tc in tool_calls {
                let input: serde_json::Value = serde_json::from_str(&tc.arguments)
                    .unwrap_or(serde_json::json!({}));
                content.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tc.tool_call_id,
                    "name": tc.name,
                    "input": input
                }));
            }

            formatted.push(serde_json::json!({
                "role": "assistant",
                "content": content
            }));
            continue;
        }

        // 3. Standard messages
        formatted.push(serde_json::json!({
            "role": if msg.role == "assistant" { "assistant" } else { "user" },
            "content": msg.content
        }));
    }

    formatted
}

/**
 * Format messages for OpenAI-compatible API
 */
pub fn format_messages_for_openai(messages: &[Message]) -> Vec<serde_json::Value> {
    let mut formatted = Vec::new();

    for msg in messages {
        // 1. Handle tool results
        if msg.role == "user" && (msg.content.starts_with("__TOOL_RESULT__:") || msg.tool_call_id.is_some()) {
            let (tool_call_id, content) = if let Some(ref id) = msg.tool_call_id {
                (id.clone(), msg.content.clone())
            } else if let Some(cap) = msg.content.strip_prefix("__TOOL_RESULT__:").and_then(|s| {
                let parts: Vec<&str> = s.splitn(2, ':').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            }) {
                cap
            } else {
                continue;
            };

            formatted.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": content
            }));
            continue;
        }

        // 2. Handle assistant messages with tool calls
        if msg.role == "assistant" && msg.tool_calls.is_some() {
            let tool_calls = msg.tool_calls.as_ref().unwrap();
            formatted.push(serde_json::json!({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": tool_calls.iter().map(|tc| {
                    serde_json::json!({
                        "id": tc.tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": tc.arguments
                        }
                    })
                }).collect::<Vec<_>>()
            }));
            continue;
        }

        // 3. Standard messages
        formatted.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    formatted
}

/**
 * Check if model supports extended thinking
 */
pub fn supports_thinking(model: &str) -> bool {
    model.contains("claude-3-7")
        || model.contains("claude-opus-4")
        || model.contains("claude-sonnet-4")
        || model.contains("claude-haiku-4")
}

/**
 * Send a message to stop/kill the current request
 */
pub async fn stop_current_request() -> AppResult<()> {
    let mut token_guard = CANCEL_TOKEN.lock().await;
    if let Some(token) = token_guard.take() {
        println!("🔴 Cancelling current request");
        token.cancel();
    }
    Ok(())
}

/**
 * Check if there's a running request
 */
pub async fn has_running_request() -> bool {
    let token_guard = CANCEL_TOKEN.lock().await;
    token_guard.is_some()
}

// ============ SSE Response Types ============

#[derive(Debug, Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    delta: Option<AnthropicDelta>,
    #[serde(default)]
    content_block: Option<AnthropicContentBlock>,
    #[serde(default)]
    message: Option<AnthropicMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AnthropicDelta {
    Text { text: Option<String> },
    Thinking { thinking: Option<String> },
    InputJson { input_json: Option<String> },
    Other(serde_json::Value),
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
    #[serde(default)]
    content: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    #[serde(rename = "input_tokens", default)]
    input_tokens: Option<i32>,
    #[serde(rename = "output_tokens", default)]
    output_tokens: Option<i32>,
}

// OpenAI-compatible streaming types
#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    delta: Option<OpenAIDelta>,
    #[serde(rename = "finish_reason", default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    choices: Vec<OpenAIStreamChoice>,
    #[serde(default)]
    usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(rename = "reasoning_content", default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OpenAIToolCall {
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type", default)]
    call_type: Option<String>,
    #[serde(default)]
    function: Option<OpenAIFunction>,
}

#[derive(Debug, Deserialize)]
struct OpenAIFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    #[serde(rename = "prompt_tokens", default)]
    prompt_tokens: Option<i32>,
    #[serde(rename = "completion_tokens", default)]
    completion_tokens: Option<i32>,
    #[serde(rename = "total_tokens", default)]
    total_tokens: Option<i32>,
}

impl ClaudeClient {
    /**
     * Send a chat message to Claude (non-streaming)
     */
    pub async fn chat(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
    ) -> AppResult<ChatResponse> {
        if let Some(url) = base_url {
            self.chat_openai(&messages, &api_key, &model, Some(url), system_prompt.as_deref(), false, None).await
        } else {
            self.chat_anthropic(&messages, &api_key, &model, system_prompt.as_deref(), false, None).await
        }
    }

    /**
     * Send a chat message with streaming (emits events to window)
     */
    pub async fn chat_streaming(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
        window: Window,
    ) -> AppResult<ChatResponse> {
        // Create cancellation token and store globally
        let cancel_token = CancellationToken::new();
        {
            let mut token_guard = CANCEL_TOKEN.lock().await;
            *token_guard = Some(cancel_token.clone());
        }

        // Use tokio::select! to handle cancellation
        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                // User cancelled
                Ok(ChatResponse {
                    content: String::new(),
                    artifacts: vec![],
                    model: String::new(),
                    usage: UsageInfo {
                        input_tokens: 0,
                        output_tokens: 0,
                    },
                    tool_calls: vec![],
                })
            }
            result = async {
                if let Some(url) = base_url {
                    self.chat_openai(&messages, &api_key, &model, Some(url), system_prompt.as_deref(), true, Some(window)).await
                } else {
                    self.chat_anthropic(&messages, &api_key, &model, system_prompt.as_deref(), true, Some(window)).await
                }
            } => result
        };

        // Clear the cancellation token
        {
            let mut token_guard = CANCEL_TOKEN.lock().await;
            *token_guard = None;
        }

        result
    }

    /**
     * Call Anthropic API
     */
    async fn chat_anthropic(
        &self,
        messages: &[Message],
        api_key: &str,
        model: &str,
        system_prompt: Option<&str>,
        streaming: bool,
        window: Option<Window>,
    ) -> AppResult<ChatResponse> {
        let thinking = supports_thinking(model);
        let thinking_budget = 5000;
        let max_tokens = if thinking {
            std::cmp::max(2048, thinking_budget + 1000)
        } else {
            2048
        };

        // Build request body
        let mut body: serde_json::Map<String, serde_json::Value> = serde_json::json!({
            "model": model,
            "max_tokens": max_tokens,
            "stream": streaming,
            "messages": format_messages_for_anthropic(messages),
            "tools": get_tools(),
        }).as_object().cloned().unwrap();

        if let Some(system) = system_prompt {
            body.insert("system".to_string(), serde_json::json!(system));
        }

        if thinking {
            body.insert("thinking".to_string(), serde_json::json!({
                "type": "enabled",
                "budget_tokens": thinking_budget
            }));
        }

        // Build headers
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", api_key.parse().unwrap());
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());

        if thinking {
            headers.insert("anthropic-beta", "interleaved-thinking-2025-05-14".parse().unwrap());
        }

        // Send request
        let mut request = self.client
            .post("https://api.anthropic.com/v1/messages")
            .headers(headers)
            .json(&body);

        if streaming {
            let response = request.send().await.map_err(|e| {
                AppError::ProcessError(format!("Failed to send request: {}", e))
            })?;

            // Check response status
            let status = response.status();
            if !status.is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(AppError::ProcessError(format!("Anthropic API error ({}): {}", status, error_text)));
            }

            self.stream_anthropic_response(response, window).await
        } else {
            let response = request.send().await.map_err(|e| {
                AppError::ProcessError(format!("Failed to send request: {}", e))
            })?;

            // Parse non-streaming response
            let value: serde_json::Value = response.json().await.map_err(|e| {
                AppError::InternalError(format!("Failed to parse response: {}", e))
            })?;

            // Check for errors
            if let Ok(error_resp) = serde_json::from_value::<ErrorResponse>(value.clone()) {
                return Err(AppError::InternalError(format!(
                    "Claude API error: {} ({})",
                    error_resp.error, error_resp.code
                )));
            }

            // Parse successful response
            let content = value["content"]
                .as_array()
                .and_then(|arr| arr.iter().find(|c| c["type"] == "text"))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            let model_name = value["model"].as_str().unwrap_or(model).to_string();
            let usage = UsageInfo {
                input_tokens: value["usage"]["input_tokens"].as_i64().unwrap_or(0) as i32,
                output_tokens: value["usage"]["output_tokens"].as_i64().unwrap_or(0) as i32,
            };

            // Detect tool calls
            let mut tool_calls = Vec::new();
            if let Some(content_arr) = value["content"].as_array() {
                for block in content_arr {
                    if block["type"] == "tool_use" {
                        let tool_call = ToolCall {
                            tool_call_id: block["id"].as_str().unwrap_or("").to_string(),
                            name: block["name"].as_str().unwrap_or("").to_string(),
                            arguments: serde_json::to_string(&block["input"]).unwrap_or_default(),
                        };
                        tool_calls.push(tool_call);
                    }
                }
            }

            // Detect artifacts
            let artifacts = detect_artifacts(&content);

            Ok(ChatResponse {
                content,
                artifacts,
                model: model_name,
                usage,
                tool_calls,
            })
        }
    }

    /**
     * Stream Anthropic response and emit events
     */
    async fn stream_anthropic_response(
        &self,
        response: reqwest::Response,
        window: Option<Window>,
    ) -> AppResult<ChatResponse> {
        let mut full_content = String::new();
        let mut full_reasoning = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut current_tool_call: Option<(String, String, String)> = None; // (id, name, arguments)
        let mut model = String::new();
        let mut usage = UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        };
        let mut artifacts: Vec<Artifact> = Vec::new();

        // Stream response body
        use futures::stream::StreamExt;
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Err(AppError::ProcessError(format!("Stream error: {}", e)));
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            let lines: Vec<&str> = text.lines().collect();

            for line in lines {
                let line = line.trim();
                if !line.starts_with("data: ") {
                    continue;
                }

                let data_str = &line[6..];
                if data_str.is_empty() || data_str == "[DONE]" {
                    continue;
                }

                // Parse as generic JSON object to extract fields
                let json: serde_json::Value = match serde_json::from_str(data_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match event_type {
                    "content_block_delta" => {
                        if let Some(delta_obj) = json.get("delta") {
                            // Text delta
                            if let Some(text) = delta_obj.get("text").and_then(|v| v.as_str()) {
                                full_content.push_str(text);
                                if let Some(ref w) = window {
                                    let _ = w.emit("claude-token", text);
                                }
                            }

                            // Thinking delta
                            if let Some(thinking) = delta_obj.get("thinking").and_then(|v| v.as_str()) {
                                full_reasoning.push_str(thinking);
                                if let Some(ref w) = window {
                                    let _ = w.emit("claude-reasoning", thinking);
                                }
                            }

                            // Input JSON delta (tool call arguments)
                            if let Some(input_json) = delta_obj.get("input_json").and_then(|v| v.as_str()) {
                                if let Some(ref mut tc) = current_tool_call {
                                    tc.2.push_str(input_json);
                                }
                            }
                        }
                    }
                    "content_block_start" => {
                        if let Some(block) = json.get("content_block") {
                            if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                                current_tool_call = Some((
                                    block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                    block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                    String::new(),
                                ));
                            }
                        }
                    }
                    "content_block_stop" => {
                        if let Some((id, name, args)) = current_tool_call.take() {
                            let tool_call = ToolCall {
                                tool_call_id: id,
                                name,
                                arguments: args,
                            };
                            tool_calls.push(tool_call.clone());
                            if let Some(ref w) = window {
                                let _ = w.emit("claude-tool-use", tool_call);
                            }
                        }
                    }
                    "message_delta" => {
                        if let Some(msg) = json.get("message") {
                            if let Some(reason) = msg.get("stop_reason").and_then(|v| v.as_str()) {
                                if reason == "tool_calls" {
                                    // Tool calls will come from content blocks
                                }
                            }
                            if let Some(u) = msg.get("usage") {
                                usage = UsageInfo {
                                    input_tokens: u.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                                    output_tokens: u.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                                };
                            }
                        }
                    }
                    "message_stop" => {
                        // End of stream
                    }
                    _ => {}
                }
            }
        }

        // Handle final content
        let message_str = full_content.clone();
        if !full_reasoning.is_empty() && window.is_some() {
            // Emit final reasoning
        }

        // Detect artifacts from final content
        artifacts = detect_artifacts(&message_str);

        Ok(ChatResponse {
            content: message_str,
            artifacts,
            model,
            usage,
            tool_calls,
        })
    }

    /**
     * Call OpenAI-compatible API (Minimax, etc.)
     */
    async fn chat_openai(
        &self,
        messages: &[Message],
        api_key: &str,
        model: &str,
        base_url: Option<String>,
        system_prompt: Option<&str>,
        streaming: bool,
        window: Option<Window>,
    ) -> AppResult<ChatResponse> {
        let base_url = base_url.unwrap_or_default();
        let is_reasoning_model = model.to_lowercase().contains("reasoner") || model.to_lowercase().contains("r1");
        // 将 Anthropic 格式的 tools 转换为 OpenAI 兼容格式（MiniMax 等需要此格式）
        let tools = if is_reasoning_model {
            None
        } else {
            Some(convert_tools_to_openai_format(&get_tools()))
        };

        // Build messages list，system prompt 放到 messages 数组的第一条（OpenAI 兼容格式）
        let mut openai_messages = format_messages_for_openai(messages);
        if let Some(system) = system_prompt {
            openai_messages.insert(0, serde_json::json!({
                "role": "system",
                "content": system
            }));
        }

        // Build request body
        let mut body: serde_json::Map<String, serde_json::Value> = serde_json::json!({
            "model": model,
            "messages": openai_messages,
            "max_tokens": 2048,
            "stream": streaming,
        }).as_object().cloned().unwrap();

        if let Some(ref t) = tools {
            if !t.is_empty() {
                body.insert("tools".to_string(), serde_json::json!(t));
            }
        }

        // Build headers
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Authorization", format!("Bearer {}", api_key).parse().unwrap());
        headers.insert("Content-Type", "application/json".parse().unwrap());

        // Send request
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        println!("📡 Sending request to: {}", url);
        let response = self.client
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::ProcessError(format!("Failed to send request: {}", e)))?;

        // Check response status
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::ProcessError(format!("API error ({}): {}", status, error_text)));
        }

        if streaming {
            self.stream_openai_response(response, window).await
        } else {
            // Non-streaming response
            let value: serde_json::Value = response.json().await.map_err(|e| {
                AppError::InternalError(format!("Failed to parse response: {}", e))
            })?;

            let message = value["choices"]
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("message"));

            let content = message
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            let model_name = value["model"].as_str().unwrap_or(model).to_string();
            let usage = UsageInfo {
                input_tokens: value["usage"]["prompt_tokens"].as_i64().unwrap_or(0) as i32,
                output_tokens: value["usage"]["completion_tokens"].as_i64().unwrap_or(0) as i32,
            };

            let artifacts = detect_artifacts(&content);

            Ok(ChatResponse {
                content,
                artifacts,
                model: model_name,
                usage,
                tool_calls: vec![],
            })
        }
    }

    /**
     * Stream OpenAI-compatible response
     */
    async fn stream_openai_response(
        &self,
        response: reqwest::Response,
        window: Option<Window>,
    ) -> AppResult<ChatResponse> {
        let mut full_content = String::new();
        let mut model = String::new();
        let mut usage = UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        };

        // Stream response body
        use futures::stream::StreamExt;
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Err(AppError::ProcessError(format!("Stream error: {}", e)));
                }
            };

            let text = String::from_utf8_lossy(&chunk);
            // Debug: print raw chunk
            if !text.is_empty() {
                println!("📥 Stream chunk: {}", text.trim().chars().take(200).collect::<String>());
            }
            let lines: Vec<&str> = text.lines().collect();

            for line in lines {
                let line = line.trim();
                if !line.starts_with("data: ") {
                    continue;
                }

                let data_str = &line[6..];
                if data_str.is_empty() || data_str == "[DONE]" {
                    continue;
                }

                let event: OpenAIStreamResponse = match serde_json::from_str(data_str) {
                    Ok(e) => e,
                    Err(e) => {
                        println!("⚠️ Failed to parse stream event: {}", e);
                        continue;
                    }
                };

                for choice in event.choices {
                    if let Some(delta) = choice.delta {
                        // Reasoning content (DeepSeek)
                        if let Some(reasoning) = delta.reasoning_content {
                            if let Some(ref w) = window {
                                let _ = w.emit("claude-reasoning", reasoning);
                            }
                        }

                        // Content
                        if let Some(content) = delta.content {
                            full_content.push_str(&content);
                            if let Some(ref w) = window {
                                let _ = w.emit("claude-token", content);
                            }
                        }
                    }
                }

                // Get model from first response
                if model.is_empty() {
                    model = event.model.unwrap_or_default();
                }
            }
        }

        let artifacts = detect_artifacts(&full_content);

        Ok(ChatResponse {
            content: full_content,
            artifacts,
            model,
            usage,
            tool_calls: vec![],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_tools_count() {
        let tools = get_tools();
        assert_eq!(tools.len(), 9);
    }

    #[test]
    fn test_get_tools_schema_valid() {
        let tools = get_tools();
        for tool in &tools {
            assert!(tool.get("name").is_some());
            assert!(tool.get("description").is_some());
            assert!(tool.get("input_schema").is_some());
        }
    }

    #[test]
    fn test_detect_artifacts_code_block() {
        let content = "Hello\n```rust\nfn main() {\n    println!(\"Hello, world!\");\n    println!(\"More lines to exceed 200 chars threshold for artifact detection\");\n    println!(\"Even more content to make sure we hit the threshold\");\n    println!(\"Adding more lines for safety margin in this test\");\n}\n```\nWorld";
        let artifacts = detect_artifacts(content);
        assert!(!artifacts.is_empty());
        assert_eq!(artifacts[0].artifact_type, "code");
    }

    #[test]
    fn test_detect_artifacts_short_code_ignored() {
        let content = "Hello\n```rust\nfn main() {}\n```\nWorld";
        let artifacts = detect_artifacts(content);
        // Short code blocks should be ignored
        assert!(artifacts.is_empty());
    }

    #[test]
    fn test_detect_artifacts_html() {
        let content = "<!DOCTYPE html>\n<html><body>Hello</body></html>";
        let artifacts = detect_artifacts(content);
        assert!(!artifacts.is_empty());
        assert_eq!(artifacts[0].artifact_type, "html");
    }

    #[test]
    fn test_detect_artifacts_mermaid() {
        let content = "```mermaid\ngraph TD;\nA-->B;\n```";
        let artifacts = detect_artifacts(content);
        assert!(!artifacts.is_empty());
        assert_eq!(artifacts[0].artifact_type, "mermaid");
    }

    #[test]
    fn test_supports_thinking_claude_3_7() {
        assert!(supports_thinking("claude-3-7-sonnet-20250219"));
    }

    #[test]
    fn test_supports_thinking_claude_sonnet_4() {
        assert!(supports_thinking("claude-sonnet-4-5-20250501"));
    }

    #[test]
    fn test_supports_thinking_claude_3_5() {
        assert!(!supports_thinking("claude-3-5-sonnet-20241022"));
    }

    #[test]
    fn test_client_new() {
        let client = ClaudeClient::new();
        // Just ensure it doesn't panic
        assert!(true);
    }

    #[test]
    fn test_format_messages_standard() {
        let messages = vec![
            Message {
                role: "user".to_string(),
                content: "Hello".to_string(),
                tool_calls: None,
                tool_call_id: None,
            },
            Message {
                role: "assistant".to_string(),
                content: "Hi there!".to_string(),
                tool_calls: None,
                tool_call_id: None,
            },
        ];
        let formatted = format_messages_for_anthropic(&messages);
        assert_eq!(formatted.len(), 2);
    }

    #[test]
    fn test_format_messages_tool_result() {
        let messages = vec![
            Message {
                role: "user".to_string(),
                content: "file content".to_string(),
                tool_calls: None,
                tool_call_id: Some("tool_123".to_string()),
            },
        ];
        let formatted = format_messages_for_anthropic(&messages);
        assert_eq!(formatted.len(), 1);
        let msg = &formatted[0];
        assert_eq!(msg["role"], "user");
        assert!(msg["content"].is_array());
    }

    #[test]
    fn test_format_messages_assistant_tool_calls() {
        let messages = vec![
            Message {
                role: "assistant".to_string(),
                content: "I'll read that file.".to_string(),
                tool_calls: Some(vec![
                    ToolCall {
                        tool_call_id: "tool_123".to_string(),
                        name: "read_file".to_string(),
                        arguments: r#"{"path": "/test.txt"}"#.to_string(),
                    }
                ]),
                tool_call_id: None,
            },
        ];
        let formatted = format_messages_for_anthropic(&messages);
        assert_eq!(formatted.len(), 1);
        let msg = &formatted[0];
        assert_eq!(msg["role"], "assistant");
        assert!(msg["content"].is_array());
    }
}
