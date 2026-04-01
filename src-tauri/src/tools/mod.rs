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

pub mod registry;
pub mod scheduler;

use serde::{Deserialize, Serialize};

/// Tool call request extracted from API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRequest {
    /// Unique tool call ID (from API)
    pub id: String,
    /// Tool name
    pub name: String,
    /// JSON-encoded arguments
    pub arguments: String,
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
