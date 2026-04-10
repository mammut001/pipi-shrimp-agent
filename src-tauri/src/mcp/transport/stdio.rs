use async_trait::async_trait;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;
use tracing::debug;

use crate::mcp::protocol::{JsonRpcRequest, JsonRpcNotification, JsonRpcResponse};
use crate::mcp::types::MCPError;
use super::Transport;

/// Commands allowed for MCP stdio transport.
/// Only well-known package runners and MCP server executables are permitted.
const ALLOWED_COMMANDS: &[&str] = &[
    "npx", "node", "python", "python3", "uvx", "uv",
    "deno", "bun", "docker",
];

/// Validate that a command is safe to execute.
fn validate_command(command: &str) -> Result<(), MCPError> {
    // Reject empty commands
    if command.trim().is_empty() {
        return Err(MCPError::ConfigError("Empty command".into()));
    }
    // Reject shell metacharacters that could enable injection
    if command.contains(';') || command.contains('|') || command.contains('&')
        || command.contains('`') || command.contains('$') || command.contains('>')
        || command.contains('<') || command.contains('\n')
    {
        return Err(MCPError::ConfigError(
            format!("Command '{}' contains disallowed shell metacharacters", command),
        ));
    }
    // Extract the base command name (handle paths like /usr/bin/npx)
    let base = std::path::Path::new(command)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(command);
    if !ALLOWED_COMMANDS.contains(&base) {
        return Err(MCPError::ConfigError(
            format!("Command '{}' is not in the allowed list: {:?}", command, ALLOWED_COMMANDS),
        ));
    }
    Ok(())
}

/// Stdio transport — spawns a child process and communicates via stdin/stdout
pub struct StdioTransport {
    child: Option<Child>,
    stderr_task: Option<JoinHandle<()>>,
    #[allow(dead_code)]
    command: String,
    #[allow(dead_code)]
    args: Vec<String>,
    #[allow(dead_code)]
    env: HashMap<String, String>,
    #[allow(dead_code)]
    cwd: Option<String>,
}

impl StdioTransport {
    pub fn new(
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: Option<String>,
    ) -> Self {
        Self {
            child: None,
            stderr_task: None,
            command,
            args,
            env,
            cwd,
        }
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn connect(&mut self) -> Result<(), MCPError> {
        // Validate command before execution to prevent command injection
        validate_command(&self.command)?;

        // Also validate args don't contain shell metacharacters
        for arg in &self.args {
            if arg.contains(';') || arg.contains('|') || arg.contains('&')
                || arg.contains('`') || arg.contains('$')
            {
                return Err(MCPError::ConfigError(
                    format!("Argument '{}' contains disallowed shell metacharacters", arg),
                ));
            }
        }

        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = &self.cwd {
            cmd.current_dir(cwd);
        }

        let mut child = cmd.spawn().map_err(|e| {
            MCPError::ConnectionFailed(format!(
                "Failed to spawn '{}': {}",
                self.command, e
            ))
        })?;

        // Drain stderr in background to prevent buffer deadlock.
        if let Some(stderr) = child.stderr.take() {
            let cmd_name = self.command.clone();
            self.stderr_task = Some(tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    debug!(cmd = %cmd_name, "MCP stderr: {}", line);
                }
            }));
        }

        self.child = Some(child);
        Ok(())
    }

    async fn send_request(&mut self, request: &JsonRpcRequest) -> Result<JsonRpcResponse, MCPError> {
        let child = self.child.as_mut().ok_or_else(|| {
            MCPError::TransportError("Not connected".into())
        })?;

        let stdin = child.stdin.as_mut().ok_or_else(|| {
            MCPError::TransportError("stdin not available".into())
        })?;

        let stdout = child.stdout.as_mut().ok_or_else(|| {
            MCPError::TransportError("stdout not available".into())
        })?;

        // Write JSON-RPC request as a single line
        let json = serde_json::to_string(request)?;
        stdin.write_all(json.as_bytes()).await.map_err(|e| {
            MCPError::TransportError(format!("Failed to write to stdin: {}", e))
        })?;
        stdin.write_all(b"\n").await.map_err(|e| {
            MCPError::TransportError(format!("Failed to write newline: {}", e))
        })?;
        stdin.flush().await.map_err(|e| {
            MCPError::TransportError(format!("Failed to flush stdin: {}", e))
        })?;

        // Read response line from stdout
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        let read_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            reader.read_line(&mut line),
        )
        .await;

        match read_result {
            Ok(Ok(0)) => Err(MCPError::TransportError("Server closed stdout".into())),
            Ok(Ok(_)) => {
                let response: JsonRpcResponse = serde_json::from_str(line.trim())?;
                Ok(response)
            }
            Ok(Err(e)) => Err(MCPError::TransportError(format!("Read error: {}", e))),
            Err(_) => Err(MCPError::Timeout),
        }
    }

    async fn send_notification(&mut self, notification: &JsonRpcNotification) -> Result<(), MCPError> {
        let child = self.child.as_mut().ok_or_else(|| {
            MCPError::TransportError("Not connected".into())
        })?;

        let stdin = child.stdin.as_mut().ok_or_else(|| {
            MCPError::TransportError("stdin not available".into())
        })?;

        let json = serde_json::to_string(notification)?;
        stdin.write_all(json.as_bytes()).await.map_err(|e| {
            MCPError::TransportError(format!("Failed to write notification: {}", e))
        })?;
        stdin.write_all(b"\n").await.map_err(|e| {
            MCPError::TransportError(format!("Failed to write newline: {}", e))
        })?;
        stdin.flush().await.map_err(|e| {
            MCPError::TransportError(format!("Failed to flush stdin: {}", e))
        })?;

        Ok(())
    }

    async fn close(&mut self) -> Result<(), MCPError> {
        if let Some(mut child) = self.child.take() {
            // Close stdin to signal the child
            drop(child.stdin.take());
            // Give it a moment to exit gracefully
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                child.wait(),
            )
            .await;
            // Force kill if still alive
            let _ = child.kill().await;
        }
        // Abort stderr drain task
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
        Ok(())
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            drop(child.stdin.take());
            // Best-effort kill — no async in Drop
            let _ = child.start_kill();
        }
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}
