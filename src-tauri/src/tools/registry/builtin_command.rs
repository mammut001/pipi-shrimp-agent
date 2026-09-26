use std::sync::Arc;

use super::super::handler_output_from_execute_code;
use crate::commands::code::execute_bash_for_tool;
use crate::tools::shell_profile::WindowsShellProfile;
use crate::tools::ssh_bridge::{execute_ssh_exec, execute_ssh_read_file, execute_ssh_upload};
use super::{ToolHandlerOutput, ToolMetadata, ToolRegistry};

pub(super) fn register_command_tools(registry: &mut ToolRegistry) {
    // --- execute_command ---
    registry.register(
        "execute_command",
        Arc::new(|args| {
            let command = args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: command"))?;
            let cwd = args.get("cwd").and_then(|v| v.as_str());
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let timeout_secs = args
                .get("timeoutSecs")
                .and_then(|v| v.as_u64())
                .or_else(|| args.get("timeout").and_then(|v| v.as_u64()));
            let execution_id = args
                .get("executionId")
                .and_then(|v| v.as_str())
                .or_else(|| args.get("execution_id").and_then(|v| v.as_str()));
            let windows_shell_profile = args
                .get("windowsShellProfile")
                .cloned()
                .map(serde_json::from_value::<WindowsShellProfile>)
                .transpose()
                .map_err(|e| anyhow::anyhow!("Invalid windowsShellProfile: {}", e))?;
            let result = execute_bash_for_tool(
                command,
                cwd,
                work_dir,
                timeout_secs,
                execution_id,
                windows_shell_profile,
                None,
            )
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            // Status comes from typed ExecuteCodeResponse — not JSON sniffing.
            handler_output_from_execute_code(result)
        }),
        ToolMetadata {
            name: "execute_command".to_string(),
            description: "Execute a shell command inside the bound work directory. On Windows, Auto uses PowerShell for Windows paths and WSL only for WSL/Linux workspaces; do not mix PowerShell and WSL installs or build artifacts in the same workspace. Returns structured JSON with stdout, stderr, exit code, cwd, and truncation metadata.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Optional explicit cwd inside the bound workDir"
                    },
                    "timeoutSecs": {
                        "type": "number",
                        "description": "Optional timeout hint in seconds"
                    },
                    "executionId": {
                        "type": "string",
                        "description": "Optional execution identifier used to track and cancel a running command."
                    },
                    "execution_id": {
                        "type": "string",
                        "description": "Legacy snake_case alias for executionId."
                    },
                    "windowsShellProfile": {
                        "type": "string",
                        "enum": ["auto", "powershell", "wsl"],
                        "description": "Optional Windows shell profile override. Auto uses PowerShell for Windows paths and WSL for WSL/Linux workspaces."
                    }
                },
                "required": ["command"],
                "additionalProperties": false,
            }),
        },
    );

    registry.register(
        "ssh_exec",
        Arc::new(|args| execute_ssh_exec(&args)),
        ToolMetadata {
            name: "ssh_exec".to_string(),
            description: "Execute a command on a local or remote SSH target inside the bound remote work directory. Returns structured JSON with stdout, stderr, exit code, execution ID, and lifecycle status.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "timeout": { "type": "number" },
                    "executionId": { "type": "string" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        },
    );

    registry.register(
        "ssh_upload_file",
        Arc::new(|args| execute_ssh_upload(&args).map(ToolHandlerOutput::success)),
        ToolMetadata {
            name: "ssh_upload_file".to_string(),
            description: "Upload a local file or inline content to a local or remote SSH target within the bound remote work directory.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "localPath": { "type": "string" },
                    "content": { "type": "string" },
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" }
                },
                "required": ["remotePath"],
                "additionalProperties": false
            }),
        },
    );

    registry.register(
        "ssh_read_file",
        Arc::new(|args| execute_ssh_read_file(&args).map(ToolHandlerOutput::success)),
        ToolMetadata {
            name: "ssh_read_file".to_string(),
            description: "Read a file from a local or remote SSH target within the bound remote work directory.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "maxLines": { "type": "number" }
                },
                "required": ["remotePath"],
                "additionalProperties": false
            }),
        },
    );


}
