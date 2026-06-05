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
pub mod execution_policy;
pub mod output_sanitizer;
pub mod process_manager;
pub mod registry;
pub mod scheduler;
pub mod shell_profile;
pub mod ssh_bridge;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionSource {
    AssistantToolCall,
    UserRequestedCommand,
    AutoresearchPhase,
    HeadlessAgent,
    WorkflowAgent,
    ManualTerminal,
    #[default]
    Unknown,
}

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
    /// The logical caller/source that initiated this tool execution.
    #[serde(default)]
    pub source: ToolExecutionSource,
    /// Optional backend allowlist for defense-in-depth enforcement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
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
    /// Optional backend-issued approval token bound to this exact request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_token: Option<String>,
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

pub fn classify_tool_error_code(message: &str) -> &'static str {
    let normalized = message.to_lowercase();
    if normalized.contains("not allowed")
        || normalized.contains("requires a bound work_dir")
        || normalized.contains("requires an explicit cwd")
        || normalized.contains("permission denied")
        || normalized.contains("access denied")
    {
        return "permission_denied";
    }
    if normalized.contains("missing") || normalized.contains("invalid") {
        return "invalid_arguments";
    }
    "internal_error"
}
