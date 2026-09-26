use super::{ToolCallRequest, ToolExecutionSource};
use crate::utils::{AppError, AppResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

mod classify;
use classify::{
    command_is_long_running, command_uses_network, is_browser_mutation_tool, is_command_tool,
    is_mcp_tool, is_read_tool, is_ssh_tool, is_write_tool, APPROVAL_TTL, WORKSPACE_BOUND_TOOLS,
};
/// Re-exported at the same path: `crate::commands::mcp` imports this via
/// `crate::tools::execution_policy::is_destructive_mcp_tool`.
pub(crate) use classify::is_destructive_mcp_tool;

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

fn canonicalize_approval_arguments(arguments: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(arguments) else {
        return arguments.to_string();
    };
    canonicalize_json_value(&value).to_string()
}

fn canonicalize_json_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                if key == "executionId" || key == "execution_id" {
                    continue;
                }
                out.insert(key.clone(), canonicalize_json_value(&map[key]));
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonicalize_json_value).collect())
        }
        other => other.clone(),
    }
}

fn approval_arguments_match(stored: &str, incoming: &str) -> bool {
    canonicalize_approval_arguments(stored) == canonicalize_approval_arguments(incoming)
}

/// Outcome of attempting to consume a one-shot approval token.
///
/// Success requires: token present, TTL ok, session_id match, tool_call_id
/// match, tool_name match, canonical effective args match (same normalize /
/// work_dir inject as store), effective work_dir match via normalize_work_dir,
/// and source match. Only volatile fields stripped by canonicalize_json_value
/// (`executionId` / `execution_id`) and JSON key order may differ.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ApprovalConsumeOutcome {
    MissingToken,
    UnknownOrExpiredToken,
    /// Execute path omitted session_id entirely (distinct from wrong UUID).
    MissingSessionOnExecute,
    Mismatch {
        fields: Vec<&'static str>,
        stored_session_prefix: Option<String>,
        expected_session_prefix: Option<String>,
    },
    Consumed,
}

fn session_id_prefix(value: &str) -> String {
    value.chars().take(8).collect()
}

impl ApprovalConsumeOutcome {
    fn error_detail(&self) -> String {
        match self {
            Self::MissingToken => {
                "Missing approval token after confirmation was required.".to_string()
            }
            Self::UnknownOrExpiredToken => {
                "Approval token is unknown, expired, or was already used.".to_string()
            }
            Self::MissingSessionOnExecute => {
                "Approval token could not be consumed: execute path missing session_id (preview stores under a session; execute must pass the same chat session id)."
                    .to_string()
            }
            Self::Mismatch {
                fields,
                stored_session_prefix,
                expected_session_prefix,
            } => {
                let mut detail = format!(
                    "Approval token identity mismatch ({}).",
                    fields.join(", ")
                );
                if fields.iter().any(|field| *field == "session_id") {
                    detail.push_str(&format!(
                        " stored_session_prefix={} expected_session_prefix={}",
                        stored_session_prefix.as_deref().unwrap_or("<none>"),
                        expected_session_prefix.as_deref().unwrap_or("<none>"),
                    ));
                }
                detail
            }
            Self::Consumed => String::new(),
        }
    }
}

fn store_approval(req: &ToolCallRequest, session_id: &str, args: &serde_json::Value) -> String {
    let token = uuid::Uuid::new_v4().to_string();
    let mut map = APPROVALS.lock().expect("approvals lock poisoned");
    // AUDIT-FIX [FIX-3#2] — Opportunistic GC: any tokens older than
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
            arguments: canonicalize_json_value(args).to_string(),
            work_dir: normalize_work_dir(&req.work_dir),
            source: req.source,
            created_at: now,
        },
    );
    token
}

fn consume_matching_approval(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    session_id: Option<&str>,
) -> ApprovalConsumeOutcome {
    let Some(token) = req
        .approval_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return ApprovalConsumeOutcome::MissingToken;
    };
    let Some(expected_session_id) = session_id else {
        return ApprovalConsumeOutcome::MissingSessionOnExecute;
    };

    let mut approvals = APPROVALS.lock().expect("approvals lock poisoned");
    let Some(record) = approvals.get(token) else {
        return ApprovalConsumeOutcome::UnknownOrExpiredToken;
    };

    // AUDIT-FIX [FIX-3#2] — TTL eviction on consume as well as store.
    if Instant::now().duration_since(record.created_at) >= APPROVAL_TTL {
        approvals.remove(token);
        return ApprovalConsumeOutcome::UnknownOrExpiredToken;
    }

    let mut mismatched: Vec<&'static str> = Vec::new();
    let session_mismatch = record.session_id != expected_session_id;
    if session_mismatch {
        mismatched.push("session_id");
    }
    if record.tool_call_id != req.id {
        mismatched.push("tool_call_id");
    }
    if record.tool_name != req.name {
        mismatched.push("tool_name");
    }

    // Semantic binding: same effective args / work_dir / source as preview.
    // Canonicalization already ignores executionId/execution_id and key order;
    // do not accept any other fingerprint drift.
    let incoming_args = canonicalize_json_value(args).to_string();
    let incoming_work_dir = normalize_work_dir(&req.work_dir);
    if record.arguments != incoming_args {
        mismatched.push("arguments");
    }
    if record.work_dir != incoming_work_dir {
        mismatched.push("work_dir");
    }
    if record.source != req.source {
        mismatched.push("source");
    }

    if !mismatched.is_empty() {
        return ApprovalConsumeOutcome::Mismatch {
            fields: mismatched,
            stored_session_prefix: session_mismatch
                .then(|| session_id_prefix(&record.session_id)),
            expected_session_prefix: session_mismatch
                .then(|| session_id_prefix(expected_session_id)),
        };
    }

    approvals.remove(token);
    ApprovalConsumeOutcome::Consumed
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
            _ if is_destructive_mcp_tool(&req.name) => require_confirmation(
                "Destructive MCP tool execution requires explicit approval.",
            ),
            _ => allow(None),
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

    // Bypass mode shortcut: for AssistantToolCall / HeadlessAgent /
    // WorkflowAgent, allow normal project-scoped commands without
    // confirmation. Dangerous commands are still rejected by
    // `validate_command` (called by the executor) and by the frontend
    // `dangerousCommandCheck` hook before this ever runs.
    // Network/long-running flags only trigger require_confirmation,
    // which the frontend now resolves locally without opening the modal.
    //
    // AutoresearchPhase is intentionally excluded (R2-08): bypass must
    // not skip the AutoresearchPhase network reject below.
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
            ToolExecutionSource::AssistantToolCall
                | ToolExecutionSource::HeadlessAgent
                | ToolExecutionSource::WorkflowAgent
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

    let is_bypass = req
        .execution_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.eq_ignore_ascii_case("bypass"))
        .unwrap_or(false);

    if is_bypass && matches!(req.source, ToolExecutionSource::AutoresearchPhase) {
        return Ok(allow(None));
    }

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
    let is_bypass = req
        .execution_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.eq_ignore_ascii_case("bypass"))
        .unwrap_or(false);

    if is_bypass && matches!(req.source, ToolExecutionSource::AutoresearchPhase) {
        return Ok(allow(None));
    }

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

fn inject_work_dir_into_args(req: &ToolCallRequest, args: &mut serde_json::Value) {
    if let Some(object) = args.as_object_mut() {
        if let Some(work_dir) = req.work_dir.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
            object
                .entry("work_dir".to_string())
                .or_insert_with(|| serde_json::Value::String(work_dir.to_string()));
        }
    }
}

fn normalize_work_dir(work_dir: &Option<String>) -> Option<String> {
    work_dir
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn preview_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    session_id: Option<&str>,
) -> AppResult<ToolPolicyPreview> {
    let mut normalized_args = args.clone();
    inject_work_dir_into_args(req, &mut normalized_args);
    let decision = evaluate_request_policy(req, &normalized_args)?;
    let approval_token = if decision.action == PolicyAction::RequireConfirmation {
        session_id.map(|value| store_approval(req, value, &normalized_args))
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
            let mut normalized_args = serde_json::json!({ "script": script });
            inject_work_dir_into_args(&request, &mut normalized_args);
            match consume_matching_approval(&request, &normalized_args, Some(expected_session_id))
            {
                ApprovalConsumeOutcome::Consumed => Ok(()),
                outcome => {
                    let base = decision.reason.unwrap_or_else(|| {
                        "Browser script execution requires approval.".to_string()
                    });
                    Err(AppError::SecurityError(format!(
                        "{} {}",
                        base,
                        outcome.error_detail()
                    )))
                }
            }
        }
    }
}

pub fn enforce_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    session_id: Option<&str>,
) -> AppResult<()> {
    let mut normalized_args = args.clone();
    inject_work_dir_into_args(req, &mut normalized_args);
    let decision = evaluate_request_policy(req, &normalized_args)?;
    match decision.action {
        PolicyAction::Allow => Ok(()),
        PolicyAction::Reject => {
            Err(AppError::SecurityError(decision.reason.unwrap_or_else(
                || "Tool execution rejected by policy.".to_string(),
            )))
        }
        PolicyAction::RequireConfirmation => {
            match consume_matching_approval(req, &normalized_args, session_id) {
                ApprovalConsumeOutcome::Consumed => Ok(()),
                outcome => {
                    let base = decision.reason.unwrap_or_else(|| {
                        format!(
                            "Tool '{}' requires explicit confirmation before execution.",
                            req.name
                        )
                    });
                    Err(AppError::SecurityError(format!(
                        "{} {}",
                        base,
                        outcome.error_detail()
                    )))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
