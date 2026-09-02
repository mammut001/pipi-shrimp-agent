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
    pub id: String,
    pub name: String,
    pub arguments: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
    #[serde(default)]
    pub source: ToolExecutionSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_capabilities: Option<crate::claude::provider::ProviderCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<String>,
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_error: bool,
    pub error_code: Option<String>,
}

/// Core metadata authored when a tool is registered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolMetadata {
    pub name: String,
    pub description: String,
    pub is_read_only: bool,
    pub is_concurrency_safe: bool,
    pub input_schema: serde_json::Value,
}

/// Runtime scheduling class exposed to every frontend/client.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolConcurrencyClass {
    Concurrent,
    Serial,
}

/// Declarative retry hint. Enforcement remains at the runtime/provider layer;
/// keeping the hint in registry metadata prevents each client inventing policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRetryPolicy {
    pub max_retries: u8,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

/// Expanded metadata view consumed by TypeScript runtimes. This is derived from
/// the authoritative Rust ToolRegistry rather than duplicated TS sets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRuntimeMetadata {
    pub name: String,
    pub description: String,
    pub is_read_only: bool,
    pub is_concurrency_safe: bool,
    pub concurrency_class: ToolConcurrencyClass,
    pub requires_workspace: bool,
    pub permission_class: String,
    pub default_timeout_ms: u64,
    pub output_byte_limit: Option<usize>,
    pub retry_policy: ToolRetryPolicy,
    pub cancellable: bool,
    pub emitted_events: Vec<String>,
    pub input_schema: serde_json::Value,
}

fn requires_workspace(name: &str) -> bool {
    matches!(
        name,
        "read_file"
            | "write_file"
            | "list_files"
            | "create_directory"
            | "path_exists"
            | "search_files"
            | "glob_search"
            | "grep_files"
            | "execute_command"
            | "compile_typst_file"
            | "render_typst_to_pdf"
            | "render_typst_to_svg"
            | "scaffold_generate"
            | "git_init_workdir"
            | "bootstrap_finalize"
    )
}

fn permission_class(name: &str, is_read_only: bool) -> &'static str {
    if is_read_only {
        return "read_only";
    }
    match name {
        "execute_command" | "code_execution" | "ssh_exec" => "process_execution",
        "write_file" | "create_directory" | "delete_file" | "append_file" => "workspace_mutation",
        _ => "mutating",
    }
}

fn default_timeout_ms(name: &str) -> u64 {
    match name {
        "execute_command" | "ssh_exec" | "code_execution" => 300_000,
        _ => 30_000,
    }
}

fn is_cancellable(name: &str) -> bool {
    matches!(name, "execute_command" | "ssh_exec")
}

impl ToolMetadata {
    pub fn to_runtime_metadata(&self) -> ToolRuntimeMetadata {
        ToolRuntimeMetadata {
            name: self.name.clone(),
            description: self.description.clone(),
            is_read_only: self.is_read_only,
            is_concurrency_safe: self.is_concurrency_safe,
            concurrency_class: if self.is_concurrency_safe {
                ToolConcurrencyClass::Concurrent
            } else {
                ToolConcurrencyClass::Serial
            },
            requires_workspace: requires_workspace(&self.name),
            permission_class: permission_class(&self.name, self.is_read_only).to_string(),
            default_timeout_ms: default_timeout_ms(&self.name),
            output_byte_limit: Some(1_048_576),
            retry_policy: ToolRetryPolicy {
                max_retries: 0,
                base_delay_ms: 250,
                max_delay_ms: 2_000,
            },
            cancellable: is_cancellable(&self.name),
            emitted_events: vec![
                "tool-start".to_string(),
                "tool-complete".to_string(),
                "tool-error".to_string(),
            ],
            input_schema: self.input_schema.clone(),
        }
    }
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
