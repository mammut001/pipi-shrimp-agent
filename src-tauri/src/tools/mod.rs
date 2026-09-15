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
pub mod test_barrier;

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

/// Terminal outcome for a finished tool call.
///
/// Serialized as snake_case (`success`, `failed`, `rejected`, `cancelled`,
/// `timed_out`) so Chat can map directly to UI step statuses without guessing
/// from JSON content.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ToolTerminalStatus {
    #[default]
    Success,
    Failed,
    Rejected,
    Cancelled,
    TimedOut,
}

impl ToolTerminalStatus {
    pub fn is_error(self) -> bool {
        !matches!(self, Self::Success)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Rejected => "rejected",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }

    /// Map UI / content step strings onto a terminal status.
    pub fn from_content_status(value: &str) -> Option<Self> {
        match value {
            "success" | "succeeded" | "done" | "ok" => Some(Self::Success),
            "failed" | "error" | "fail" => Some(Self::Failed),
            "rejected" | "permission_denied" => Some(Self::Rejected),
            "cancelled" | "canceled" => Some(Self::Cancelled),
            "timed_out" | "timeout" | "timedout" => Some(Self::TimedOut),
            _ => None,
        }
    }
}

/// Map a structured `error_code` onto a terminal status.
pub fn terminal_status_from_error_code(code: Option<&str>) -> ToolTerminalStatus {
    match code {
        Some("permission_denied") | Some("security_error") => ToolTerminalStatus::Rejected,
        Some("cancelled") | Some("canceled") => ToolTerminalStatus::Cancelled,
        Some("timed_out") | Some("timeout") => ToolTerminalStatus::TimedOut,
        Some(_) => ToolTerminalStatus::Failed,
        None => ToolTerminalStatus::Failed,
    }
}

/// Infer cancelled / timed_out (and similar) from structured tool JSON content.
///
/// Handlers such as `execute_command` and `test_barrier_tool` return Ok(content)
/// with an embedded `status` field; Chat previously had to parse that itself.
pub fn infer_terminal_status_from_content(content: &str) -> Option<ToolTerminalStatus> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
    if let Some(status) = parsed.get("status").and_then(|v| v.as_str()) {
        // Only promote cancel / timeout / reject from embedded JSON.
        // Process tools may embed `"status":"failed"` for non-zero exit while
        // still returning Ok(content) with ToolCallResult.is_error=false.
        match ToolTerminalStatus::from_content_status(status) {
            Some(ToolTerminalStatus::Cancelled) => return Some(ToolTerminalStatus::Cancelled),
            Some(ToolTerminalStatus::TimedOut) => return Some(ToolTerminalStatus::TimedOut),
            Some(ToolTerminalStatus::Rejected) => return Some(ToolTerminalStatus::Rejected),
            _ => {}
        }
    }
    if parsed
        .get("error_kind")
        .and_then(|v| v.as_str())
        .is_some_and(|k| k == "permission_denied")
    {
        return Some(ToolTerminalStatus::Rejected);
    }
    if parsed
        .get("timed_out")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Some(ToolTerminalStatus::TimedOut);
    }
    None
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_error: bool,
    pub error_code: Option<String>,
    /// Authoritative terminal outcome. Defaults to `success` when deserializing
    /// legacy payloads that omit the field.
    #[serde(default)]
    pub status: ToolTerminalStatus,
}

impl ToolCallResult {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
        status: ToolTerminalStatus,
        error_code: Option<String>,
    ) -> Self {
        let status = status;
        Self {
            id: id.into(),
            name: name.into(),
            content: content.into(),
            is_error: status.is_error(),
            error_code,
            status,
        }
    }

    /// Successful handler output. Inspects structured content for cancel/timeout.
    pub fn success(id: impl Into<String>, name: impl Into<String>, content: String) -> Self {
        let status =
            infer_terminal_status_from_content(&content).unwrap_or(ToolTerminalStatus::Success);
        let error_code = match status {
            ToolTerminalStatus::Cancelled => Some("cancelled".to_string()),
            ToolTerminalStatus::TimedOut => Some("timed_out".to_string()),
            ToolTerminalStatus::Rejected => Some("permission_denied".to_string()),
            ToolTerminalStatus::Failed => Some("internal_error".to_string()),
            ToolTerminalStatus::Success => None,
        };
        Self::new(id, name, content, status, error_code)
    }

    /// Error / policy / validation outcome. Status is derived from `error_code`.
    pub fn error(
        id: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
        error_code: Option<String>,
    ) -> Self {
        let status = terminal_status_from_error_code(error_code.as_deref());
        Self::new(id, name, content, status, error_code)
    }
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
        "execute_command" | "ssh_exec" | "code_execution" | "test_barrier_tool" => 300_000,
        _ => 30_000,
    }
}

fn is_cancellable(name: &str) -> bool {
    matches!(name, "execute_command" | "ssh_exec" | "test_barrier_tool")
}

pub fn build_tool_runtime_metadata(
    name: String,
    description: String,
    is_read_only: bool,
    is_concurrency_safe: bool,
    input_schema: serde_json::Value,
) -> ToolRuntimeMetadata {
    ToolRuntimeMetadata {
        requires_workspace: requires_workspace(&name),
        permission_class: permission_class(&name, is_read_only).to_string(),
        default_timeout_ms: default_timeout_ms(&name),
        output_byte_limit: Some(1_048_576),
        retry_policy: ToolRetryPolicy {
            max_retries: 0,
            base_delay_ms: 250,
            max_delay_ms: 2_000,
        },
        cancellable: is_cancellable(&name),
        emitted_events: vec![
            "tool-start".to_string(),
            "tool-complete".to_string(),
            "tool-error".to_string(),
        ],
        concurrency_class: if is_concurrency_safe {
            ToolConcurrencyClass::Concurrent
        } else {
            ToolConcurrencyClass::Serial
        },
        name,
        description,
        is_read_only,
        is_concurrency_safe,
        input_schema,
    }
}

impl ToolMetadata {
    pub fn to_runtime_metadata(&self) -> ToolRuntimeMetadata {
        build_tool_runtime_metadata(
            self.name.clone(),
            self.description.clone(),
            self.is_read_only,
            self.is_concurrency_safe,
            self.input_schema.clone(),
        )
    }
}

pub fn classify_tool_error_code(message: &str) -> &'static str {
    let normalized = message.to_lowercase();
    if normalized.contains("not allowed")
        || normalized.contains("requires a bound work_dir")
        || normalized.contains("requires an explicit cwd")
        || normalized.contains("permission denied")
        || normalized.contains("access denied")
        || normalized.contains("rejected by policy")
        || normalized.contains("denied by policy")
        || normalized.contains("security error")
    {
        return "permission_denied";
    }
    if normalized.contains("timed out") || normalized.contains("timeout") {
        return "timed_out";
    }
    if normalized.contains("cancelled") || normalized.contains("canceled") {
        return "cancelled";
    }
    if normalized.contains("missing") || normalized.contains("invalid") {
        return "invalid_arguments";
    }
    "internal_error"
}

#[cfg(test)]
mod terminal_status_tests {
    use super::*;

    #[test]
    fn success_result_defaults_status_and_is_error_false() {
        let result = ToolCallResult::success("1", "read_file", "hello".to_string());
        assert_eq!(result.status, ToolTerminalStatus::Success);
        assert!(!result.is_error);
        assert!(result.error_code.is_none());
    }

    #[test]
    fn cancelled_content_sets_cancelled_status() {
        let content = r#"{"status":"cancelled","barrier_id":"b1"}"#.to_string();
        let result = ToolCallResult::success("1", "test_barrier_tool", content);
        assert_eq!(result.status, ToolTerminalStatus::Cancelled);
        assert!(result.is_error);
        assert_eq!(result.error_code.as_deref(), Some("cancelled"));
    }

    #[test]
    fn timed_out_content_and_flag_set_timed_out_status() {
        let content = r#"{"status":"timed_out","stdout":"","stderr":""}"#.to_string();
        let result = ToolCallResult::success("1", "execute_command", content);
        assert_eq!(result.status, ToolTerminalStatus::TimedOut);
        assert!(result.is_error);

        let flagged = ToolCallResult::success(
            "2",
            "execute_command",
            r#"{"timed_out":true,"stdout":""}"#.to_string(),
        );
        assert_eq!(flagged.status, ToolTerminalStatus::TimedOut);
    }

    #[test]
    fn permission_error_code_maps_to_rejected() {
        let result = ToolCallResult::error(
            "1",
            "ssh_exec",
            "Error: not allowed",
            Some("permission_denied".to_string()),
        );
        assert_eq!(result.status, ToolTerminalStatus::Rejected);
        assert!(result.is_error);
    }

    #[test]
    fn classify_maps_policy_and_timeout_messages() {
        assert_eq!(
            classify_tool_error_code("Tool execution rejected by policy."),
            "permission_denied"
        );
        assert_eq!(
            terminal_status_from_error_code(Some(classify_tool_error_code(
                "command timed out after 30s"
            ))),
            ToolTerminalStatus::TimedOut
        );
        assert_eq!(
            terminal_status_from_error_code(Some(classify_tool_error_code(
                "Execution was cancelled by user"
            ))),
            ToolTerminalStatus::Cancelled
        );
    }

    #[test]
    fn serde_defaults_missing_status_to_success() {
        let json = r#"{"id":"1","name":"read_file","content":"ok","is_error":false,"error_code":null}"#;
        let result: ToolCallResult = serde_json::from_str(json).expect("deserialize");
        assert_eq!(result.status, ToolTerminalStatus::Success);
    }
}
