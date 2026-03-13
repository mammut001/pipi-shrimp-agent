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
}
