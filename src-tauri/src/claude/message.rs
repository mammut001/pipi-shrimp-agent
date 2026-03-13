/**
 * Claude API message types
 *
 * Defines all message, response, and artifact structures
 */

use serde::{Deserialize, Serialize};

/**
 * Single message in conversation
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// "user" or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
}

/**
 * Artifact in response (code, HTML, diagram, etc.)
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    /// Type: code, html, mermaid, svg, react
    #[serde(rename = "type")]
    pub artifact_type: String,
    /// Artifact content
    pub content: String,
    /// Optional title
    pub title: Option<String>,
    /// For code artifacts
    pub language: Option<String>,
}

/**
 * Token usage information
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub input_tokens: i32,
    pub output_tokens: i32,
}

/**
 * Response from Claude API
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    /// Response content
    pub content: String,
    /// Detected artifacts
    pub artifacts: Vec<Artifact>,
    /// Model name
    pub model: String,
    /// Token usage
    pub usage: UsageInfo,
    /// Tool calls (if finish_reason is "tool_calls")
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
}

/**
 * Error response from Node.js process
 */
#[derive(Debug, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

/**
 * Chat request sent to Node.js subprocess
 */
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    #[serde(rename = "type")]
    pub request_type: String, // "chat"
    pub apiKey: String,
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseURL: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub systemPrompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maxTokens: Option<i32>,
    /// Enable streaming mode
    #[serde(default)]
    pub stream: bool,
}

impl ChatRequest {
    /// Create a new chat request
    pub fn new(
        api_key: String,
        model: String,
        messages: Vec<Message>,
    ) -> Self {
        Self {
            request_type: "chat".to_string(),
            apiKey: api_key,
            model: model,
            messages: messages,
            baseURL: None,
            systemPrompt: None,
            maxTokens: None,
            stream: false,
        }
    }

    /// Add base URL for custom API
    pub fn with_base_url(mut self, url: String) -> Self {
        self.baseURL = Some(url);
        self
    }

    /// Add system prompt
    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.systemPrompt = Some(prompt);
        self
    }

    /// Set max tokens
    pub fn with_max_tokens(mut self, tokens: i32) -> Self {
        self.maxTokens = Some(tokens);
        self
    }

    /// Enable streaming mode
    pub fn with_streaming(mut self) -> Self {
        self.stream = true;
        self
    }
}

/**
 * Streaming chunk from Node.js process
 */
#[derive(Debug, Deserialize)]
pub struct StreamChunk {
    #[serde(rename = "type")]
    pub chunk_type: String,
    pub content: Option<String>,
    pub error: Option<String>,
    pub model: Option<String>,
    pub artifacts: Option<Vec<Artifact>>,
    pub usage: Option<UsageInfo>,
    /// Tool call info (for tool_use events)
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
    /// Finish reason (e.g., "tool_calls")
    pub finish_reason: Option<String>,
}

/**
 * Tool call request from AI
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub tool_call_id: String,
    pub name: String,
    pub arguments: String,
}

/**
 * Tool result to send back to AI
 */
#[derive(Debug, Serialize)]
pub struct ToolResult {
    #[serde(rename = "type")]
    pub result_type: String,
    pub tool_call_id: String,
    pub result: String,
}

impl ToolResult {
    pub fn new(tool_call_id: String, result: String) -> Self {
        Self {
            result_type: "tool_result".to_string(),
            tool_call_id,
            result,
        }
    }
}
