/**
 * Tool Pipeline Module
 *
 * Unified tool protocol for pipi-shrimp-agent.
 * Replaces hardcoded if-else tool execution with a pluggable registry.
 *
 * Architecture (mirrors Claude Code's Tool pipeline):
 * - Layer 1: Tool protocol definition (this file)
 * - Layer 2: Tool registry (registry.rs)
 * - Layer 3: Concurrent scheduler (scheduler.rs)
 * - Layer 4: Tauri command exposure (commands/tools.rs)
 */
pub mod autoresearch_bootstrap;
pub mod registry;
pub mod scheduler;

use serde::{Deserialize, Serialize};

/// Tool call request extracted from API response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRequest {
    /// Unique tool call ID (from API)
    pub id: String,
    /// Tool name
    pub name: String,
    /// JSON-encoded arguments
    pub arguments: String,
    /// Bound work directory for scoped path execution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
    /// Active provider API key for LLM-backed tool execution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Active model name for LLM-backed tool execution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Optional provider base URL hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Optional provider id hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Optional API format hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
    /// Optional execution capability hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_capabilities: Option<crate::claude::provider::ProviderCapabilities>,
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    /// Original tool call ID
    pub id: String,
    /// Tool name
    pub name: String,
    /// Result content (or error message)
    pub content: String,
    /// Whether this result represents an error
    pub is_error: bool,
    /// Standardized error code for programmatic error handling.
    /// Present when is_error is true. Values: "schema_validation",
    /// "invalid_arguments", "not_found", "permission_denied", "io_error", "internal_error"
    pub error_code: Option<String>,
}

/// Tool metadata used by the scheduler for dispatch decisions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolMetadata {
    /// Tool name (must be unique)
    pub name: String,
    /// Human-readable description (injected into API system prompt)
    pub description: String,
    /// Whether this tool only reads data (no side effects)
    pub is_read_only: bool,
    /// Whether this tool can safely run concurrently with other concurrent-safe tools
    pub is_concurrency_safe: bool,
    /// JSON Schema for input validation
    pub input_schema: serde_json::Value,
}
