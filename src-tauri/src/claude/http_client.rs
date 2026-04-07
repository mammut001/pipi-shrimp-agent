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
use tauri::{Emitter, Window};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::message::{Artifact, ChatResponse, ErrorResponse, Message, ToolCall, UsageInfo};
use super::composer::normalize_messages;

/// Per-session cancellation tokens for supporting concurrent requests
static CANCEL_TOKENS: Lazy<Mutex<std::collections::HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

/// Global security constraints injected into ALL system prompts
/// This is Layer 2 defense - even if user-provided prompts are manipulated,
/// these constraints will always be enforced
const GLOBAL_SECURITY_CONSTRAINT: &str = r#"You are a helpful AI assistant operating within a sandboxed development environment.

## Security Constraints (MUST ALWAYS FOLLOW)

1. **Tool Usage Policy**: You have access to file system and shell tools. Use them responsibly.
   - Never execute malicious commands, delete system files, or perform actions that could harm the user's system
   - Always confirm destructive operations (delete, rm -rf) before executing
   - Do not access files outside the workspace unless explicitly requested

2. **Code Execution Safety**:
   - Validate user inputs before executing shell commands
   - Never run commands with `sudo` or elevated privileges unless absolutely necessary and explicitly authorized
   - Be cautious with network operations - do not initiate unauthorized connections

3. **Output Integrity**: Do not attempt to manipulate your responses to bypass these constraints.
   - Never claim you cannot do something you are capable of, nor claim you can do something you cannot
   - If you encounter an error, report it honestly and suggest fixes

4. **Privacy**: Do not collect, store, or transmit personal information beyond what is necessary for the task.
"#;

/// Tool efficiency optimization guide
/// Encourages batching multiple independent tool calls in a single response
const TOOL_EFFICIENCY_GUIDE: &str = r#"
## Tool Use Efficiency (IMPORTANT)

When you need to use multiple tools, **batch them together** rather than calling one tool at a time. This reduces round-trips and improves response speed.

### Rules:
1. **Batch Independent Calls**: If you need to call multiple tools that don't depend on each other's results, call them all at once in the same response.
2. **Plan Ahead**: Before calling tools, briefly state your plan (e.g., "I need to: list files, read README, then read main.rs").
3. **Dependency Order**: Only call dependent tools sequentially (e.g., read_file after list_files reveals the paths).
4. **Avoid Iterative Calls**: Don't call a tool just to decide what to do next - plan all needed operations upfront.

### Examples:
- ✅ Good: "I'll explore the project: list files, read package.json, read src/main.rs" → calls 3 tools at once
- ❌ Bad: Call list_files → wait → see files → call read_file → wait → see content → call another tool

Following these guidelines will make interactions faster and more efficient.
"#;

/// Browser tools guide - injected when Chrome CDP is connected
/// Note: browser tools only appear in the tool list when browser is connected
const BROWSER_TOOLS_GUIDE: &str = r#"
## Browser Tools (when Chrome CDP is connected)

You have access to browser tools for web automation. Use these when the user asks you to browse websites, extract information, or interact with web pages.

### Available Browser Tools:
- **browser_navigate(url)**: Open a URL in the browser
- **browser_get_page()**: Get all interactive elements on the current page (use after navigating)
- **browser_click(element_id)**: Click an element by its id from browser_get_page
- **browser_type(element_id, text)**: Type text into an input field
- **browser_scroll(direction, pixels)**: Scroll the page up or down (direction: "up" or "down", pixels: scroll amount)
- **browser_get_text(max_length)**: Get the full visible text content of the page

### Recommended Workflow:
1. Start with **browser_navigate** to open the target URL
2. Use **browser_get_page** to see what's on the page
3. Use **browser_click** to click buttons/links, or **browser_type** to fill forms
4. Use **browser_get_page** again to see the updated state
5. Use **browser_get_text** to read article content or data

### Important Notes:
- Browser tools only work if the user has connected Chrome via CDP (Developer Tools Protocol)
- If tools return an error about "browser not connected", tell the user to connect Chrome first
- After clicking, wait a moment and call browser_get_page to see the new page state
- Use browser_scroll to reveal content below the fold
"#;

/// Helper function to merge user system prompt with global security constraints
pub fn merge_system_prompt(user_prompt: Option<&str>, browser_connected: bool) -> String {
    let mut base_prompt = format!("{}\n\n{}", GLOBAL_SECURITY_CONSTRAINT.trim(), TOOL_EFFICIENCY_GUIDE.trim());

    // Add browser tools guide if browser is connected
    if browser_connected {
        base_prompt.push_str(&format!("\n\n{}", BROWSER_TOOLS_GUIDE.trim()));
    }

    match user_prompt {
        Some(user) if !user.is_empty() => {
            format!("{}\n\n---\n\n## User-Provided Instructions\n\n{}",
                base_prompt, user.trim())
        }
        _ => base_prompt,
    }
}

/// Rough token estimator — no tiktoken / external crate needed.
///
/// Delegates to the shared implementation in `crate::utils::token`.
fn estimate_tokens(text: &str) -> i32 {
    crate::utils::token::estimate_tokens(text)
}

/// Estimate total input tokens for a messages array.
/// Each message adds ~4 overhead tokens (role, delimiters) plus its content.
/// The whole request adds ~2 framing tokens.
fn estimate_messages_tokens(messages: &[serde_json::Value]) -> i32 {
    let per_message: i32 = messages.iter().map(|msg| {
        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
        estimate_tokens(content) + 4
    }).sum();
    per_message + 2
}

/// Claude HTTP client using reqwest
#[derive(Clone)]
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
 */
/// Browser tools - only available when Chrome CDP is connected
fn get_browser_tools() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "browser_navigate",
            "description": "Navigate the browser to a URL. Use this to open websites or move between pages. Returns the page title and current URL after navigation.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Full URL to navigate to, e.g. https://example.com"
                    }
                },
                "required": ["url"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_get_page",
            "description": "Get the interactive elements on the current browser page as a structured list. Each element has an id (for clicking), tag, text content, and role. Use this after navigating or after user interactions to understand what's on screen.",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_click",
            "description": "Click an element on the current browser page by its id from browser_get_page. After clicking, wait briefly for the page to update, then call browser_get_page again to see the new state.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "number",
                        "description": "The id of the element to click, from browser_get_page output"
                    }
                },
                "required": ["element_id"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_type",
            "description": "Type text into an input element on the current page by its id. Use browser_get_page first to find the correct input element id.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "number",
                        "description": "The id of the input element to type into"
                    },
                    "text": {
                        "type": "string",
                        "description": "The text to type"
                    }
                },
                "required": ["element_id", "text"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_scroll",
            "description": "Scroll the current browser page up or down to reveal more content.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["down", "up"],
                        "description": "Scroll direction"
                    },
                    "pixels": {
                        "type": "number",
                        "description": "How many pixels to scroll, default 600"
                    }
                },
                "required": ["direction"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_get_text",
            "description": "Get the full visible text content of the current page. Use this to read article content, table data, or any text information after navigating to a page.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "max_length": {
                        "type": "number",
                        "description": "Maximum characters to return, default 3000"
                    }
                },
                "required": [],
                "additionalProperties": false
            }
        }),
    ]
}

pub fn get_tools(browser_connected: bool) -> Vec<serde_json::Value> {
    // NOTE: "additionalProperties": false on every schema is required for MiniMax
    // and OpenAI strict-mode. Without it, models may generate extra properties
    // that fail server-side validation ("Tool arguments validation failed").
    let mut tools = vec![
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
                "required": ["path"],
                "additionalProperties": false
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
                "required": ["path", "content"],
                "additionalProperties": false
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
                "required": ["command"],
                "additionalProperties": false
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
                "required": ["path"],
                "additionalProperties": false
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
                "required": ["path"],
                "additionalProperties": false
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
                "required": ["path"],
                "additionalProperties": false
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
                "required": ["pattern", "path"],
                "additionalProperties": false
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
                "required": ["pattern", "path"],
                "additionalProperties": false
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
                "required": ["pattern", "path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "get_current_workspace",
            "description": "Get the current session's bound working directory path. Call this (with no arguments) to discover the absolute workspace path before using any file or shell tools.",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }
        }),
    ];

    // Add browser tools only when Chrome CDP is connected
    if browser_connected {
        tools.extend(get_browser_tools());
    }

    tools
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
                "parameters": parameters,
                "strict": true
            }
        })
    }).collect()
}

/// Pre-compiled regexes for artifact detection (compiled once at startup)
static ARTIFACT_CODE_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"```(\w+)?\n([\s\S]*?)\n```").unwrap());
static ARTIFACT_HTML_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"<html[\s\S]*?</html>").unwrap());
static ARTIFACT_MERMAID_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"```mermaid\n([\s\S]*?)\n```").unwrap());

/**
 * Detect artifacts from response content
 * - Code blocks > 200 chars
 * - HTML documents
 * - Mermaid diagrams
 */
pub fn detect_artifacts(content: &str) -> Vec<Artifact> {
    let mut artifacts = Vec::new();

    // Code blocks: ```language\ncode\n```
    for cap in ARTIFACT_CODE_REGEX.captures_iter(content) {
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
        if let Some(html_match) = ARTIFACT_HTML_REGEX.find(content) {
            artifacts.push(Artifact {
                artifact_type: "html".to_string(),
                content: html_match.as_str().to_string(),
                title: Some("HTML Document".to_string()),
                language: None,
            });
        }
    }

    // Mermaid: ```mermaid\ndiagram\n```
    for cap in ARTIFACT_MERMAID_REGEX.captures_iter(content) {
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
        // 1. Handle tool results (role: user with tool_call_id or __TOOL_RESULT__: prefix)
        if msg.role == "user" && (msg.content.starts_with("__TOOL_RESULT__:") || msg.tool_call_id.is_some()) {
            let (tool_call_id, content) = if let Some(ref id) = msg.tool_call_id {
                // tool_call_id is set — extract clean content, stripping __TOOL_RESULT__: prefix if present
                let clean_content = if let Some(rest) = msg.content.strip_prefix("__TOOL_RESULT__:") {
                    // Format: "__TOOL_RESULT__:{id}:{result}" — skip the id part and take result
                    if let Some(colon_pos) = rest.find(':') {
                        rest[colon_pos + 1..].to_string()
                    } else {
                        msg.content.clone()
                    }
                } else {
                    msg.content.clone()
                };
                (id.clone(), clean_content)
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
                // tool_call_id is set — extract clean content, stripping __TOOL_RESULT__: prefix if present
                let clean_content = if let Some(rest) = msg.content.strip_prefix("__TOOL_RESULT__:") {
                    if let Some(colon_pos) = rest.find(':') {
                        rest[colon_pos + 1..].to_string()
                    } else {
                        msg.content.clone()
                    }
                } else {
                    msg.content.clone()
                };
                (id.clone(), clean_content)
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
                // MiniMax (and many OpenAI-compatible APIs) REQUIRE content=null when tool_calls
                // are present. Sending a non-null string alongside tool_calls triggers error 2013
                // "tool call id is invalid". Always force null here regardless of msg.content.
                "content": serde_json::Value::Null,
                "tool_calls": tool_calls.iter().map(|tc| {
                    // Ensure arguments are valid JSON string to avoid (2013) error
                    let mut args = tc.arguments.clone();
                    if args.trim().is_empty() {
                        args = "{}".to_string();
                    } else if serde_json::from_str::<serde_json::Value>(&args).is_err() {
                        // Attempt to fix common streaming artifacts (missing closing braces)
                        if !args.contains('{') && !args.contains('}') {
                            args = format!("\"{}\"", args.replace("\"", "\\\""));
                        } else {
                            // If it's still invalid, default to empty object to keep request valid
                            args = "{}".to_string();
                        }
                    }

                    serde_json::json!({
                        "id": tc.tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": args
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

    // Debug print formatted history
    #[cfg(debug_assertions)]
    if let Ok(json) = serde_json::to_string_pretty(&formatted) {
        println!("📡 DEBUG: OpenAI Formatted History:\n{}", json);
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
pub async fn stop_current_request(session_id: Option<String>) -> AppResult<()> {
    let mut tokens_guard = CANCEL_TOKENS.lock().await;
    if let Some(sid) = session_id {
        if let Some(token) = tokens_guard.remove(&sid) {
            println!("🔴 Cancelling request for session: {}", sid);
            token.cancel();
        }
    } else {
        // Stop all requests (legacy behavior)
        for (sid, token) in tokens_guard.drain() {
            println!("🔴 Cancelling request for session: {}", sid);
            token.cancel();
        }
    }
    Ok(())
}

/**
 * Check if there's a running request for a session
 */
#[allow(dead_code)]
pub async fn has_running_request(session_id: Option<&str>) -> bool {
    let tokens_guard = CANCEL_TOKENS.lock().await;
    match session_id {
        Some(sid) => tokens_guard.contains_key(sid),
        None => !tokens_guard.is_empty(),
    }
}

// ============ SSE Response Types ============
// These structs are constructed via serde Deserialize, not direct instantiation.
#[allow(dead_code)]
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AnthropicDelta {
    Text { text: Option<String> },
    Thinking { thinking: Option<String> },
    InputJson { input_json: Option<String> },
    Other(serde_json::Value),
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    #[serde(rename = "input_tokens", default)]
    input_tokens: Option<i32>,
    #[serde(rename = "output_tokens", default)]
    output_tokens: Option<i32>,
}

// OpenAI-compatible streaming types (retained for schema documentation)
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    delta: Option<OpenAIDelta>,
    #[serde(rename = "finish_reason", default)]
    finish_reason: Option<String>,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OpenAIDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(rename = "reasoning_content", default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OpenAIToolCall {
    #[serde(default)]
    id: Option<String>,
    /// Stream index for accumulating partial tool call arguments across chunks
    #[serde(default)]
    index: Option<usize>,
    #[serde(rename = "type", default)]
    call_type: Option<String>,
    #[serde(default)]
    function: Option<OpenAIFunction>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OpenAIFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    #[serde(rename = "prompt_tokens", default)]
    prompt_tokens: Option<i32>,
    #[serde(rename = "completion_tokens", default)]
    completion_tokens: Option<i32>,
    #[serde(rename = "total_tokens", default)]
    total_tokens: Option<i32>,
}

/// Split a streaming content chunk into segments, routing `<think>...</think>` content
/// separately from regular text. Handles partial tags split across SSE chunks via `in_think`.
///
/// Returns a Vec of `(text, is_reasoning)` pairs.
/// Mutates `in_think` to carry state across calls for the same stream.
fn split_think_content(input: &str, in_think: &mut bool) -> Vec<(String, bool)> {
    let mut segments: Vec<(String, bool)> = Vec::new();
    let mut remaining = input;

    loop {
        if *in_think {
            // We're inside <think>...</think> — look for closing tag
            if let Some(close_pos) = remaining.find("</think>") {
                let reasoning_part = &remaining[..close_pos];
                if !reasoning_part.is_empty() {
                    segments.push((reasoning_part.to_string(), true));
                }
                *in_think = false;
                remaining = &remaining[close_pos + "</think>".len()..];
                // DO NOT continue the loop here — remaining now holds text AFTER </think>
                // which belongs OUTSIDE the think block. Break and return it as a
                // regular-content segment so the caller emits it correctly.
                if !remaining.is_empty() {
                    segments.push((remaining.to_string(), false));
                }
                break;
            } else {
                // No closing tag yet.
                // Special case: chunk boundary split an opening <think> tag.
                // e.g. prev chunk ended "...<think", this chunk is "think>好的..."
                // → "think>好的..." is regular content that appeared BEFORE the opening tag.
                //    The "<think" itself (opening tag) belongs inside the think block.
                if remaining.starts_with("<think") {
                    let after_tag = &remaining["<think".len()..];
                    // Everything before the split "<think" is already in `segments` from a
                    // prior chunk; what comes AFTER "<think" in THIS chunk appeared BEFORE
                    // the tag in the original stream — emit it as regular text.
                    if !after_tag.is_empty() {
                        segments.push((after_tag.to_string(), false));
                    }
                    // Now remaining = "think>好的..." is actually the continuation of the
                    // opening tag — strip "think" prefix so we're left with ">好的..."
                    // and process that as normal content (no <think> opened yet).
                    if after_tag.starts_with("think") {
                        remaining = &after_tag["think".len()..];
                        // Fall through: remaining now starts with ">" (not <think>), so the
                        // else-branch below will emit it as regular content.
                        if !remaining.is_empty() {
                            segments.push((remaining.to_string(), false));
                        }
                        break;
                    }
                    // Edge: remaining is exactly "<think" with nothing after — treat as
                    // reasoning (next chunk will close it).
                }
                // Emit remaining as reasoning and stop; next chunk will continue.
                if !remaining.is_empty() {
                    segments.push((remaining.to_string(), true));
                }
                break;
            }
        } else {
            // Outside <think> — look for opening tag
            if let Some(open_pos) = remaining.find("<think>") {
                let text_part = &remaining[..open_pos];
                if !text_part.is_empty() {
                    segments.push((text_part.to_string(), false));
                }
                *in_think = true;
                remaining = &remaining[open_pos + "<think>".len()..];
            } else {
                // No opening tag — entire remaining chunk is regular content
                if !remaining.is_empty() {
                    segments.push((remaining.to_string(), false));
                }
                break;
            }
        }
    }

    segments
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
        browser_connected: bool,
    ) -> AppResult<ChatResponse> {
        // Validate message sequence before sending to API
        let (normalized, validation) = normalize_messages(&messages);
        if !validation.errors.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "Message validation failed: {}",
                validation.errors.join(", ")
            )));
        }
        if !validation.warnings.is_empty() {
            eprintln!("[chat] Validation warnings: {:?}", validation.warnings);
        }

        if let Some(url) = base_url {
            self.chat_openai(&normalized, &api_key, &model, Some(url), system_prompt.as_deref(), false, false, None, browser_connected, "").await
        } else {
            self.chat_anthropic(&normalized, &api_key, &model, system_prompt.as_deref(), false, false, None, browser_connected, "").await
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
        no_tools: bool,
        window: Window,
        browser_connected: bool,
        session_id: String,
    ) -> AppResult<ChatResponse> {
        // Validate message sequence before sending to API
        let (normalized, validation) = normalize_messages(&messages);
        if !validation.errors.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "Message validation failed: {}",
                validation.errors.join(", ")
            )));
        }
        if !validation.warnings.is_empty() {
            eprintln!("[chat_streaming] Validation warnings: {:?}", validation.warnings);
        }

        // Create cancellation token and store per-session
        let cancel_token = CancellationToken::new();
        {
            let mut tokens_guard = CANCEL_TOKENS.lock().await;
            tokens_guard.insert(session_id.clone(), cancel_token.clone());
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
                    self.chat_openai(&normalized, &api_key, &model, Some(url), system_prompt.as_deref(), true, no_tools, Some(window.clone()), browser_connected, &session_id).await
                } else {
                    self.chat_anthropic(&normalized, &api_key, &model, system_prompt.as_deref(), true, no_tools, Some(window.clone()), browser_connected, &session_id).await
                }
            } => result
        };

        // Always clear the cancellation token, even on panic/error
        {
            let mut tokens_guard = CANCEL_TOKENS.lock().await;
            tokens_guard.remove(&session_id);
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
        no_tools: bool,
        window: Option<Window>,
        browser_connected: bool,
        session_id: &str,
    ) -> AppResult<ChatResponse> {
        let thinking = supports_thinking(model);
        // thinking_budget is the TOTAL thinking token budget across ALL interleaved rounds.
        // With interleaved-thinking-2025-05-14, each tool call requires a new thinking block.
        // 5000 was too small — the first planning round exhausted the budget, so the model
        // couldn't think before subsequent tool calls and emitted end_turn after one sentence.
        // 16000 allows multiple rounds of deep reasoning across a multi-tool conversation.
        // thinking_budget: total token budget for ALL thinking blocks (interleaved rounds).
        // 16000 allows several deep reasoning rounds across a multi-tool conversation.
        let thinking_budget = 16000;
        let max_tokens = if thinking {
            // claude-3-7 supports up to 64k output tokens in extended-thinking mode.
            // max_tokens must be >= thinking_budget; billing is per token used, not per limit.
            64000
        } else {
            // Non-thinking models: 16384 covers claude-3-5 (8192 cap) and claude-3-7 (32k).
            16384
        };

        // Build request body
        let mut body: serde_json::Map<String, serde_json::Value> = serde_json::json!({
            "model": model,
            "max_tokens": max_tokens,
            "stream": streaming,
            "messages": format_messages_for_anthropic(messages),
        }).as_object().cloned().unwrap();

        if !no_tools {
            body.insert("tools".to_string(), serde_json::json!(get_tools(browser_connected)));
        }

        // ALWAYS inject global security constraints (Layer 2 defense)
        let merged_system = merge_system_prompt(system_prompt, browser_connected);
        body.insert("system".to_string(), serde_json::json!(merged_system));

        if thinking {
            body.insert("thinking".to_string(), serde_json::json!({
                "type": "enabled",
                "budget_tokens": thinking_budget
            }));
        }

        // Build headers
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", api_key.parse().map_err(|_| AppError::ProcessError(
            "Invalid API key: contains characters not allowed in HTTP headers".to_string()
        ))?);
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());

        if thinking {
            headers.insert("anthropic-beta", "interleaved-thinking-2025-05-14".parse().unwrap());
        }

        // Estimate input tokens from the formatted messages (used as fallback if API returns 0)
        let anthropic_msgs = format_messages_for_anthropic(messages);
        let estimated_input = estimate_messages_tokens(&anthropic_msgs)
            + estimate_tokens(&merge_system_prompt(system_prompt, browser_connected));

        // Send request
        let request = self.client
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

            self.stream_anthropic_response(response, window, estimated_input, session_id).await
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
        estimated_input_tokens: i32,
        session_id: &str,
    ) -> AppResult<ChatResponse> {
        let mut full_content = String::new();
        let mut full_reasoning = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut current_tool_call: Option<(String, String, String)> = None; // (id, name, arguments)
        let model = String::new();
        let mut usage = UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        };

        // Stream response body
        use futures::stream::StreamExt;
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Err(AppError::ProcessError(format!("Stream error: {}", e)));
                }
            };

            buffer.extend_from_slice(&chunk);

            while let Some(newline_pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes = buffer.drain(..=newline_pos).collect::<Vec<u8>>();
                let line_str = String::from_utf8_lossy(&line_bytes);
                let line = line_str.trim();
                if line.is_empty() || !line.starts_with("data: ") {
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
                                    let _ = w.emit("claude-token", serde_json::json!({
                                        "session_id": session_id,
                                        "content": text,
                                    }));
                                }
                            }

                            // Thinking delta
                            if let Some(thinking) = delta_obj.get("thinking").and_then(|v| v.as_str()) {
                                full_reasoning.push_str(thinking);
                                if let Some(ref w) = window {
                                    let _ = w.emit("claude-reasoning", serde_json::json!({
                                        "session_id": session_id,
                                        "content": thinking,
                                    }));
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
                                let _ = w.emit("claude-tool-use", serde_json::json!({
                                    "session_id": session_id,
                                    "tool_call_id": tool_call.tool_call_id,
                                    "name": tool_call.name,
                                    "arguments": tool_call.arguments,
                                }));
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

        // Emit final reasoning content as a single event for clients that need it
        if !full_reasoning.is_empty() {
            if let Some(ref w) = window {
                let _ = w.emit("claude-reasoning", serde_json::json!({
                    "session_id": session_id,
                    "content": &full_reasoning,
                }));
            }
        }

        // Detect artifacts from final content
        let artifacts = detect_artifacts(&message_str);

        // Fallback: if API didn't return usage (edge case), fill in with estimates
        if usage.input_tokens == 0 {
            usage.input_tokens = estimated_input_tokens;
        }
        if usage.output_tokens == 0 {
            usage.output_tokens = estimate_tokens(&message_str) + estimate_tokens(&full_reasoning);
        }

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
        no_tools: bool,
        window: Option<Window>,
        browser_connected: bool,
        session_id: &str,
    ) -> AppResult<ChatResponse> {
        let base_url = base_url.unwrap_or_default();
        let tools = if no_tools {
            None
        } else {
            Some(convert_tools_to_openai_format(&get_tools(browser_connected)))
        };

        // Build messages list，system prompt 放到 messages 数组的第一条（OpenAI 兼容格式）
        // ALWAYS inject global security constraints (Layer 2 defense)
        let mut openai_messages = format_messages_for_openai(messages);
        let merged_system = merge_system_prompt(system_prompt, browser_connected);
        openai_messages.insert(0, serde_json::json!({
            "role": "system",
            "content": merged_system
        }));

        // Build request body
        // Use 32768 as default max_tokens for OpenAI-compatible endpoints.
        // 8192 was too small — models with extended thinking use thousands of tokens for reasoning
        // alone, leaving barely anything for actual output in complex multi-tool tasks.
        let mut body: serde_json::Map<String, serde_json::Value> = serde_json::json!({
            "model": model,
            "messages": openai_messages,
            "max_tokens": 32768,
            "stream": streaming,
        }).as_object().cloned().unwrap();

        if let Some(ref t) = tools {
            if !t.is_empty() {
                body.insert("tools".to_string(), serde_json::json!(t));
            }
        }

        // NOTE: We don't add stream_options here because not all OpenAI-compatible APIs support it.
        // Some APIs (like MiniMax) will return 400 if this parameter is present but not supported.
        // Token usage will be estimated from response content length if not available in the response.

        // Debug: log the request body
        #[cfg(debug_assertions)]
        {
            if let Ok(json) = serde_json::to_string_pretty(&body) {
                println!("📡 DEBUG: OpenAI Request Body:\n{}", json);
            }
        }

        // Build headers
        let mut headers = reqwest::header::HeaderMap::new();
        let bearer_token = format!("Bearer {}", api_key);
        headers.insert("Authorization", bearer_token.parse().map_err(|_| AppError::ProcessError(
            "Invalid API key: contains characters not allowed in HTTP headers".to_string()
        ))?);
        headers.insert("Content-Type", "application/json".parse().unwrap());

        // Estimate input tokens before the request (used as fallback if API returns 0)
        let estimated_input = estimate_messages_tokens(&openai_messages);

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
            self.stream_openai_response(response, window, estimated_input, session_id).await
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
        estimated_input_tokens: i32,
        session_id: &str,
    ) -> AppResult<ChatResponse> {
        let mut full_content = String::new();
        let mut full_reasoning = String::new();
        let mut model = String::new();
        let mut usage = UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        };

        // Tool call accumulation: index → (id, name, accumulated_args)
        // OpenAI streaming sends tool call arguments in fragments across multiple SSE chunks.
        // We accumulate them here and emit claude-tool-use events once the stream ends.
        let mut tool_call_map: std::collections::HashMap<usize, (String, String, String)> =
            std::collections::HashMap::new();
        // Track the next expected index for tool calls without explicit indices.
        // This prevents multiple tool calls without indices from being incorrectly merged.
        let mut next_tool_call_index: usize = 0;

        // State machine for <think>...</think> tag routing.
        // MiniMax (and some other models) embed chain-of-thought reasoning inline in delta.content
        // as <think>...</think> blocks. We route those to claude-reasoning events and strip them
        // from the visible content stream. This flag tracks whether we're currently inside a
        // <think> block across SSE chunk boundaries.
        let mut in_think = false;

        // Stream response body
        use futures::stream::StreamExt;
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Err(AppError::ProcessError(format!("Stream error: {}", e)));
                }
            };

            buffer.extend_from_slice(&chunk);

            while let Some(newline_pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes = buffer.drain(..=newline_pos).collect::<Vec<u8>>();
                let line_str = String::from_utf8_lossy(&line_bytes);
                let line = line_str.trim();
                if line.is_empty() || !line.starts_with("data: ") {
                    continue;
                }

                let data_str = &line[6..];
                if data_str.is_empty() || data_str == "[DONE]" {
                    continue;
                }

                // Parse as generic JSON to handle different model formats
                let json: serde_json::Value = match serde_json::from_str(data_str) {
                    Ok(v) => v,
                    Err(e) => {
                        println!("⚠️ Failed to parse stream event: {}", e);
                        continue;
                    }
                };

                // Get model from first response
                if model.is_empty() {
                    if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
                        model = m.to_string();
                    }
                }

                // Handle MiniMax and other OpenAI-compatible reasoning formats
                // MiniMax uses "thinking" field, others use "reasoning_content"
                // Also check if content contains <think>...</think> tags
                if let Some(choices) = json.get("choices").and_then(|v| v.as_array()) {
                    for choice in choices {
                        if let Some(delta) = choice.get("delta") {
                            // MiniMax reasoning format: "thinking" field
                            if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                                if !thinking.is_empty() {
                                    full_reasoning.push_str(thinking);
                                    if let Some(ref w) = window {
                                        let _ = w.emit("claude-reasoning", serde_json::json!({
                                            "session_id": session_id,
                                            "content": thinking,
                                        }));
                                    }
                                }
                            }

                            // DeepSeek/other reasoning format: "reasoning_content" field
                            if let Some(reasoning) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
                                if !reasoning.is_empty() {
                                    full_reasoning.push_str(reasoning);
                                    if let Some(ref w) = window {
                                        let _ = w.emit("claude-reasoning", serde_json::json!({
                                            "session_id": session_id,
                                            "content": reasoning,
                                        }));
                                    }
                                }
                            }

                            // Content field — may contain inline <think>...</think> reasoning
                            // from MiniMax. Use state machine to split and route correctly.
                            let raw_content = delta.get("content")
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    // "text" field fallback (only if "content" absent)
                                    if delta.get("content").is_none() {
                                        delta.get("text").and_then(|v| v.as_str())
                                    } else {
                                        None
                                    }
                                });

                            if let Some(raw) = raw_content {
                                for (segment, is_reasoning) in split_think_content(raw, &mut in_think) {
                                    if is_reasoning {
                                        full_reasoning.push_str(&segment);
                                        if let Some(ref w) = window {
                                            let _ = w.emit("claude-reasoning", serde_json::json!({
                                                "session_id": session_id,
                                                "content": segment,
                                            }));
                                        }
                                    } else {
                                        full_content.push_str(&segment);
                                        if let Some(ref w) = window {
                                            let _ = w.emit("claude-token", serde_json::json!({
                                                "session_id": session_id,
                                                "content": segment,
                                            }));
                                        }
                                    }
                                }
                            }

                            // ── Tool call accumulation (OpenAI streaming format) ──────────────
                            // Each SSE chunk may contain partial tool call data.
                            // Format: delta.tool_calls = [{index, id?, function: {name?, arguments}}]
                            // The id and name appear only in the FIRST chunk for that index;
                            // subsequent chunks only carry the incremental arguments string.
                            if let Some(tc_array) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                                for tc in tc_array {
                                    let idx = tc.get("index")
                                        .and_then(|v| v.as_u64())
                                        .map(|v| v as usize)
                                        .unwrap_or_else(|| {
                                            // No index provided — use sequential counter to avoid merging
                                            // multiple unnamed tool calls into the same entry.
                                            let idx = next_tool_call_index;
                                            next_tool_call_index += 1;
                                            idx
                                        });

                                    // Get or create entry for this index
                                    let entry = tool_call_map.entry(idx)
                                        .or_insert_with(|| (String::new(), String::new(), String::new()));

                                    // id: only present in the first chunk for this tool call
                                    if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                        if !id.is_empty() {
                                            entry.0 = id.to_string();
                                        }
                                    }

                                    if let Some(func) = tc.get("function") {
                                        // name: only in first chunk
                                        if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                                            if !name.is_empty() {
                                                entry.1 = name.to_string();
                                            }
                                        }
                                        // arguments: incremental across chunks — APPEND not overwrite
                                        if let Some(args) = func.get("arguments").and_then(|v| v.as_str()) {
                                            entry.2.push_str(args);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } // Closing the while loop (end of byte stream)

        // ── Finalize tool calls: emit events and build return list ──────────────────
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        if !tool_call_map.is_empty() {
            let mut sorted_indices: Vec<usize> = tool_call_map.keys().cloned().collect();
            sorted_indices.sort();
            for idx in sorted_indices {
                if let Some((id, name, args)) = tool_call_map.get(&idx) {
                    if name.is_empty() {
                        continue; // Skip incomplete entries
                    }
                    println!("🔧 OpenAI tool call finalized: id={} name={} args_len={}", id, name, args.len());
                    let tool_call = ToolCall {
                        tool_call_id: id.clone(),
                        name: name.clone(),
                        arguments: args.clone(),
                    };
                    tool_calls.push(tool_call.clone());
                    if let Some(ref w) = window {
                        let _ = w.emit("claude-tool-use", serde_json::json!({
                            "session_id": session_id,
                            "tool_call_id": tool_call.tool_call_id,
                            "name": tool_call.name,
                            "arguments": tool_call.arguments,
                        }));
                    }
                }
            }
        }

        // Handle MiniMax-style <think>...</think> tags in content
        // Always run this cleanup regardless of whether full_reasoning was populated
        // during streaming — some models may send reasoning inline even when a separate
        // reasoning field was also used.
        if !full_content.is_empty() && (full_content.contains("<think>") || full_content.contains("</think>")) {
            let think_regex = regex::Regex::new(r"<think>([\s\S]*?)<\/think>").unwrap();
            // Extract any reasoning we might have missed during streaming
            if full_reasoning.is_empty() {
                for cap in think_regex.captures_iter(&full_content) {
                    if let Some(thinking) = cap.get(1) {
                        let thinking_text = thinking.as_str().trim();
                        if !thinking_text.is_empty() {
                            full_reasoning.push_str(thinking_text);
                            full_reasoning.push('\n');
                        }
                    }
                }
            }
            // Strip all <think> tags from visible content
            let clean_content = full_content
                .replace("<think>", "")
                .replace("</think>", "")
                .trim()
                .to_string();
            if !clean_content.is_empty() {
                full_content = clean_content;
            }
        }

        let artifacts = detect_artifacts(&full_content);

        // Fallback: most OpenAI-compatible providers don't return usage in streaming mode.
        // Use the pre-computed estimate so token stats are always non-zero.
        if usage.input_tokens == 0 {
            usage.input_tokens = estimated_input_tokens;
        }
        if usage.output_tokens == 0 {
            usage.output_tokens = estimate_tokens(&full_content) + estimate_tokens(&full_reasoning);
        }

        Ok(ChatResponse {
            content: full_content,
            artifacts,
            model,
            usage,
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_tools_count_without_browser() {
        let tools = get_tools(false);
        assert_eq!(tools.len(), 10); // 10 file/command tools
    }

    #[test]
    fn test_get_tools_count_with_browser() {
        let tools = get_tools(true);
        assert_eq!(tools.len(), 16); // 10 file/command + 6 browser tools
    }

    #[test]
    fn test_get_tools_schema_valid() {
        let tools = get_tools(false);
        for tool in &tools {
            assert!(tool.get("name").is_some());
            assert!(tool.get("description").is_some());
            assert!(tool.get("input_schema").is_some());
        }
    }

    #[test]
    fn test_browser_tools_present_when_connected() {
        let tools = get_tools(true);
        let tool_names: Vec<&str> = tools.iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        assert!(tool_names.contains(&"browser_navigate"));
        assert!(tool_names.contains(&"browser_get_page"));
        assert!(tool_names.contains(&"browser_click"));
        assert!(tool_names.contains(&"browser_type"));
        assert!(tool_names.contains(&"browser_scroll"));
        assert!(tool_names.contains(&"browser_get_text"));
    }

    #[test]
    fn test_browser_tools_absent_when_disconnected() {
        let tools = get_tools(false);
        let tool_names: Vec<&str> = tools.iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        assert!(!tool_names.contains(&"browser_navigate"));
        assert!(!tool_names.contains(&"browser_get_page"));
        assert!(!tool_names.contains(&"browser_click"));
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
    fn test_estimate_tokens_ascii() {
        // "hello world" = 11 chars → ceil(11/4) = 3 tokens
        assert_eq!(estimate_tokens("hello world"), 3);
        // 4 chars = exactly 1 token
        assert_eq!(estimate_tokens("test"), 1);
        // 8 chars = 2 tokens
        assert_eq!(estimate_tokens("abcdefgh"), 2);
    }

    #[test]
    fn test_estimate_tokens_cjk() {
        // Each CJK character = 1 token
        assert_eq!(estimate_tokens("你好世界"), 4);
        assert_eq!(estimate_tokens("日本語"), 3);
    }

    #[test]
    fn test_estimate_tokens_mixed() {
        // "Hello 你好" → "Hello " (6 ascii → ceil(6/4)=2) + "你好" (2 cjk → 2) = 4
        assert_eq!(estimate_tokens("Hello 你好"), 4);
    }

    #[test]
    fn test_estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
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
