use super::{ToolCallRequest, ToolExecutionSource};
use crate::utils::{AppError, AppResult};

const WRITE_TOOLS: &[&str] = &["write_file", "create_directory"];
const WORKSPACE_BOUND_TOOLS: &[&str] = &["write_file", "create_directory", "execute_command"];

#[derive(Debug, Clone, Copy)]
struct ToolExecutionPolicy {
    require_bound_workspace: bool,
    allow_write_tools: bool,
    allow_network_commands: bool,
    allow_long_running_commands: bool,
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
            allow_network_commands: true,
            allow_long_running_commands: true,
        },
        ToolExecutionSource::UserRequestedCommand | ToolExecutionSource::ManualTerminal => {
            ToolExecutionPolicy {
                require_bound_workspace: true,
                allow_write_tools: true,
                allow_network_commands: true,
                allow_long_running_commands: true,
            }
        }
        ToolExecutionSource::AutoresearchPhase => ToolExecutionPolicy {
            require_bound_workspace: true,
            allow_write_tools: true,
            allow_network_commands: false,
            allow_long_running_commands: true,
        },
        ToolExecutionSource::HeadlessAgent | ToolExecutionSource::WorkflowAgent => {
            ToolExecutionPolicy {
                require_bound_workspace: true,
                allow_write_tools: true,
                allow_network_commands: false,
                allow_long_running_commands: false,
            }
        }
        ToolExecutionSource::Unknown => ToolExecutionPolicy {
            require_bound_workspace: true,
            allow_write_tools: false,
            allow_network_commands: false,
            allow_long_running_commands: false,
        },
    }
}

pub fn enforce_request_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
) -> AppResult<()> {
    if let Some(allowed_tools) = &req.allowed_tools {
        if !allowed_tools.iter().any(|tool_name| tool_name == &req.name) {
            return Err(AppError::SecurityError(format!(
                "Tool '{}' is not allowed for execution source '{}'.",
                req.name,
                req.source.as_str()
            )));
        }
    }

    let policy = policy_for_source(req.source);

    if WRITE_TOOLS.contains(&req.name.as_str()) && !policy.allow_write_tools {
        return Err(AppError::SecurityError(format!(
            "Execution source '{}' is not allowed to run write tool '{}'.",
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
        return Err(AppError::SecurityError(format!(
            "Tool '{}' requires a bound work_dir for execution source '{}'.",
            req.name,
            req.source.as_str()
        )));
    }

    if req.name == "execute_command" {
        enforce_command_policy(req, args, policy)?;
    }

    Ok(())
}

fn enforce_command_policy(
    req: &ToolCallRequest,
    args: &serde_json::Value,
    policy: ToolExecutionPolicy,
) -> AppResult<()> {
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
        return Err(AppError::SecurityError(format!(
            "Tool 'execute_command' requires an explicit cwd/work_dir for execution source '{}'.",
            req.source.as_str()
        )));
    }

    if command_uses_network(command) && !policy.allow_network_commands {
        return Err(AppError::SecurityError(format!(
            "Execution source '{}' is not allowed to run network or package-install commands.",
            req.source.as_str()
        )));
    }

    if command_is_long_running(command) && !policy.allow_long_running_commands {
        return Err(AppError::SecurityError(format!(
            "Execution source '{}' is not allowed to run long-lived commands.",
            req.source.as_str()
        )));
    }

    Ok(())
}

fn command_uses_network(command: &str) -> bool {
    let normalized = command.to_lowercase();
    [
        "curl ",
        "wget ",
        "ssh ",
        "scp ",
        "rsync ",
        "ping ",
        "nc ",
        "nmap ",
        "git clone",
        "npm install",
        "pnpm add",
        "pnpm install",
        "yarn add",
        "pip install",
        "cargo install",
        "brew install",
        "apt install",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
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
        }
    }

    #[test]
    fn disallowed_tool_is_rejected() {
        let mut request = make_request("read_file");
        request.allowed_tools = Some(vec!["write_file".to_string()]);

        let error = enforce_request_policy(&request, &serde_json::json!({ "path": "README.md" }))
            .expect_err("expected allowlist rejection");

        assert!(error.to_string().contains("not allowed"));
    }

    #[test]
    fn headless_network_command_is_rejected() {
        let request = make_request("execute_command");

        let error = enforce_request_policy(
            &request,
            &serde_json::json!({ "command": "curl https://example.com", "cwd": "/tmp/project" }),
        )
        .expect_err("expected network command rejection");

        assert!(error.to_string().contains("network or package-install commands"));
    }
}