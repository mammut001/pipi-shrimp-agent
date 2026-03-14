/**
 * Claude Node.js subprocess manager
 *
 * Handles spawning and communicating with Node.js subprocess
 */

use crate::utils::{AppResult, AppError};
use serde_json;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Window;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::message::{ChatRequest, ChatResponse, ErrorResponse, Message, StreamChunk, ToolCall};

/// Global state to track the current running subprocess PID
static CURRENT_PID: once_cell::sync::Lazy<tokio::sync::Mutex<Option<u32>>> =
    once_cell::sync::Lazy::new(|| tokio::sync::Mutex::new(None));

/**
 * Send a message to stop/kill the current subprocess
 */
pub async fn stop_current_subprocess() -> AppResult<()> {
    let pid_guard: tokio::sync::MutexGuard<Option<u32>> = CURRENT_PID.lock().await;
    if let Some(pid) = *pid_guard {
        // Use kill command to terminate the process
        #[cfg(unix)]
        {
            use std::process::Command as StdCommand;
            let _ = StdCommand::new("kill").arg("-9").arg(pid.to_string()).output();
        }
        #[cfg(windows)]
        {
            use std::process::Command as StdCommand;
            let _ = StdCommand::new("taskkill").arg("/PID").arg(pid.to_string()).arg("/F").output();
        }
    }
    drop(pid_guard);

    // Clear the PID
    let mut pid_guard = CURRENT_PID.lock().await;
    *pid_guard = None;
    Ok(())
}

/**
 * Check if there's a running subprocess
 */
pub async fn has_running_subprocess() -> bool {
    let pid_guard: tokio::sync::MutexGuard<Option<u32>> = CURRENT_PID.lock().await;
    pid_guard.is_some()
}

/**
 * Clear the current subprocess reference (called when streaming ends)
 */
async fn clear_current_subprocess() {
    let mut pid_guard = CURRENT_PID.lock().await;
    *pid_guard = None;
}

/**
 * Claude SDK client that uses Node.js subprocess
 */
pub struct ClaudeClient {
    /// Path to claude-sdk.js
    node_script_path: PathBuf,
}

impl ClaudeClient {
    /**
     * Create a new Claude client
     *
     * # Arguments
     * * `node_script_path` - Path to node-scripts/claude-sdk.js
     */
    pub fn new(node_script_path: PathBuf) -> Self {
        Self { node_script_path }
    }

    /**
     * Send a chat message to Claude
     *
     * # Arguments
     * * `messages` - Conversation history
     * * `api_key` - Anthropic API key
     * * `model` - Model name (e.g., "claude-3-5-sonnet-20241022")
     * * `base_url` - Custom API base URL (optional)
     * * `system_prompt` - Optional system prompt
     *
     * # Returns
     * * `ChatResponse` - Claude's response with content and artifacts
     */
    pub async fn chat(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
    ) -> AppResult<ChatResponse> {
        // 1. Build request
        let mut request = ChatRequest::new(api_key, model, messages);
        if let Some(url) = base_url {
            request = request.with_base_url(url);
        }
        if let Some(prompt) = system_prompt {
            request = request.with_system_prompt(prompt);
        }

        // 2. Serialize request to JSON
        let request_json = serde_json::to_string(&request)
            .map_err(|e| AppError::InternalError(format!(
                "Failed to serialize request: {}",
                e
            )))?;

        // 3. Run subprocess
        let response = self.run_subprocess(&request_json).await?;

        // 4. Parse and return response
        Ok(response)
    }

    /**
     * Send a chat message with streaming (emits events to window)
     *
     * # Arguments
     * * `messages` - Conversation history
     * * `api_key` - Anthropic API key
     * * `model` - Model name
     * * `base_url` - Custom API base URL (optional)
     * * `system_prompt` - Optional system prompt
     * * `window` - Tauri window for emitting events
     *
     * # Returns
     * * `ChatResponse` - Claude's response with content and artifacts
     */
    pub async fn chat_streaming(
        &self,
        messages: Vec<Message>,
        api_key: String,
        model: String,
        base_url: Option<String>,
        system_prompt: Option<String>,
        window: Window,
    ) -> AppResult<ChatResponse> {
        // 1. Build request with streaming enabled
        let mut request = ChatRequest::new(api_key, model, messages);
        if let Some(url) = base_url {
            request = request.with_base_url(url);
        }
        if let Some(prompt) = system_prompt {
            request = request.with_system_prompt(prompt);
        }
        request = request.with_streaming();

        // 2. Serialize request to JSON
        let request_json = serde_json::to_string(&request)
            .map_err(|e| AppError::InternalError(format!(
                "Failed to serialize request: {}",
                e
            )))?;

        // 3. Run subprocess with streaming
        let response = self.run_subprocess_streaming(&request_json, window).await?;

        // 4. Parse and return response
        Ok(response)
    }

    /**
     * Execute Node.js subprocess with JSON communication
     */
    async fn run_subprocess(&self, input: &str) -> AppResult<ChatResponse> {
        // 1. Spawn Node.js process
        let script_path_str = self.node_script_path.to_str().ok_or_else(||
            AppError::InternalError("Invalid node script path".to_string())
        )?;

        // Set CWD to the script's parent directory so Node.js can find
        // package.json ("type": "module") and node_modules/
        let script_dir = self.node_script_path.parent()
            .ok_or_else(|| AppError::InternalError("Invalid node script path: no parent directory".to_string()))?;

        let mut cmd = Command::new("node");
        cmd.arg(script_path_str)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Only set current_dir if the directory actually exists
        if script_dir.is_dir() {
            cmd.current_dir(script_dir);
        }

        let mut child = cmd.spawn()
            .map_err(|e| AppError::ProcessError(format!(
                "Failed to spawn Node.js process: {} (script: {})",
                e, script_path_str
            )))?;

        // 2. Write request to stdin and close it
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .await
                .map_err(|e| AppError::ProcessError(format!(
                    "Failed to write to stdin: {}",
                    e
                )))?;
            stdin
                .flush()
                .await
                .map_err(|e| AppError::ProcessError(format!(
                    "Failed to flush stdin: {}",
                    e
                )))?;
            drop(stdin); // Explicitly close stdin so Node.js gets EOF
        }

        // 3. Read stdout and stderr concurrently to avoid pipe deadlock,
        //    then wait for the process to exit.
        let stdout_handle = child.stdout.take();
        let stderr_handle = child.stderr.take();

        let stdout_fut = async {
            let mut output = String::new();
            if let Some(stdout) = stdout_handle {
                let mut reader = BufReader::new(stdout);
                let _ = reader.read_line(&mut output).await;
            }
            output
        };

        let stderr_fut = async {
            let mut err_output = String::new();
            if let Some(mut stderr) = stderr_handle {
                // Read ALL of stderr (not just one line) to capture full error stack
                let _ = stderr.read_to_string(&mut err_output).await;
            }
            err_output
        };

        let timeout = tokio::time::Duration::from_secs(60);
        let wait_fut = tokio::time::timeout(timeout, child.wait());

        // Run all three concurrently
        let (output, error_output, status_result) = tokio::join!(
            stdout_fut,
            stderr_fut,
            wait_fut
        );

        let status = match status_result {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => return Err(AppError::ProcessError(format!("Node.js process failed: {}", e))),
            Err(_) => return Err(AppError::ProcessError("Node.js subprocess timed out (60s)".to_string())),
        };

        // 4. Handle non-zero exit status
        if !status.success() {
            // Try to parse error JSON from stdout first
            if !output.is_empty() {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&output) {
                    if let Ok(error_resp) = serde_json::from_value::<ErrorResponse>(value) {
                        return Err(AppError::InternalError(format!(
                            "Claude API error: {} ({})",
                            error_resp.error, error_resp.code
                        )));
                    }
                }
            }

            // Fall back to stderr message
            let stderr_msg = error_output.trim().to_string();
            if !stderr_msg.is_empty() {
                return Err(AppError::ProcessError(format!(
                    "Node.js error: {}",
                    stderr_msg
                )));
            }

            return Err(AppError::ProcessError(
                format!("Node.js process exited with non-zero status: {}", status)
            ));
        }

        // 5. Parse successful JSON response
        if output.is_empty() {
            return Err(AppError::ProcessError("Node.js process returned empty output".to_string()));
        }

        self.parse_response(&output)
    }

    /**
     * Execute Node.js subprocess with streaming (reads line by line and emits events)
     */
    async fn run_subprocess_streaming(&self, input: &str, window: Window) -> AppResult<ChatResponse> {
        // 1. Spawn Node.js process
        let script_path_str = self.node_script_path.to_str().ok_or_else(||
            AppError::InternalError("Invalid node script path".to_string())
        )?;

        let script_dir = self.node_script_path.parent()
            .ok_or_else(|| AppError::InternalError("Invalid node script path: no parent directory".to_string()))?;

        let mut cmd = Command::new("node");
        cmd.arg(script_path_str)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if script_dir.is_dir() {
            cmd.current_dir(script_dir);
        }

        let mut child = cmd.spawn()
            .map_err(|e| AppError::ProcessError(format!(
                "Failed to spawn Node.js process: {} (script: {})",
                e, script_path_str
            )))?;

        // 2. Write request to stdin and close it
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .await
                .map_err(|e| AppError::ProcessError(format!(
                    "Failed to write to stdin: {}",
                    e
                )))?;
            stdin
                .flush()
                .await
                .map_err(|e| AppError::ProcessError(format!(
                    "Failed to flush stdin: {}",
                    e
                )))?;
            drop(stdin);
        }

        // 3. Read stdout line by line and emit events
        let stdout_handle = child.stdout.take();
        let stderr_handle = child.stderr.take();

        // Store the PID globally so we can kill it later
        let pid = child.id().unwrap_or(0);
        if pid > 0 {
            let mut pid_lock = CURRENT_PID.lock().await;
            *pid_lock = Some(pid);
        }

        // Track streaming content
        let mut full_content = String::new();
        let mut artifacts: Vec<crate::claude::message::Artifact> = Vec::new();
        let mut model = String::new();
        let mut usage = crate::claude::message::UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        };
        // Track tool calls
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut finish_reason: Option<String> = None;

        // Read stdout in streaming mode
        if let Some(stdout) = stdout_handle {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        // Try to parse the chunk
                        match serde_json::from_str::<StreamChunk>(trimmed) {
                            Ok(chunk) => {
                                match chunk.chunk_type.as_str() {
                                    "chunk" => {
                                        // Emit token to frontend
                                        if let Some(content) = chunk.content {
                                            full_content.push_str(&content);
                                            let _ = window.emit("claude-token", content);
                                        }
                                    },
                                    "done" => {
                                        // Final response
                                        if let Some(m) = chunk.model {
                                            model = m;
                                        }
                                        if let Some(a) = chunk.artifacts {
                                            artifacts = a;
                                        }
                                        if let Some(u) = chunk.usage {
                                            usage = u;
                                        }
                                        if let Some(c) = chunk.content {
                                            // Append any remaining content
                                            if !full_content.ends_with(&c) {
                                                full_content.push_str(&c);
                                                let _ = window.emit("claude-token", c);
                                            }
                                        }
                                        // Capture finish reason (e.g., "tool_calls")
                                        if let Some(fr) = chunk.finish_reason {
                                            finish_reason = Some(fr);
                                        }
                                    },
                                    "tool_use" => {
                                        // AI wants to call a tool
                                        if let (Some(tool_call_id), Some(name), Some(arguments)) =
                                            (chunk.tool_call_id.clone(), chunk.name.clone(), chunk.arguments.clone())
                                        {
                                            let tool_call = ToolCall {
                                                tool_call_id,
                                                name,
                                                arguments,
                                            };
                                            tool_calls.push(tool_call.clone());
                                            // Emit tool_use event to frontend
                                            let _ = window.emit("claude-tool-use", tool_call);
                                        }
                                    },
                                    "error" => {
                                        let error_msg = chunk.error.unwrap_or_else(|| "Unknown error".to_string());
                                        clear_current_subprocess().await;
                                        return Err(AppError::InternalError(format!("Streaming error: {}", error_msg)));
                                    },
                                    _ => {}
                                }
                            }
                            Err(e) => {
                                // Ignore parsing errors for non-JSON lines
                                println!("Warning: Failed to parse streaming line: {} - {}", trimmed, e);
                            }
                        }
                    }
                    Err(e) => {
                        println!("Warning: Error reading stdout: {}", e);
                        break;
                    }
                }
            }
        }

        // 4. Read stderr for any errors
        let mut error_output = String::new();
        if let Some(mut stderr) = stderr_handle {
            let _ = stderr.read_to_string(&mut error_output).await;
        }

        // 5. Wait for process to exit
        let status = child.wait().await
            .map_err(|e| AppError::ProcessError(format!("Failed to wait for process: {}", e)))?;

        // 6. Handle non-zero exit status
        if !status.success() {
            let stderr_msg = error_output.trim().to_string();
            if !stderr_msg.is_empty() {
                clear_current_subprocess().await;
                return Err(AppError::ProcessError(format!(
                    "Node.js error: {}",
                    stderr_msg
                )));
            }

            clear_current_subprocess().await;
            return Err(AppError::ProcessError(
                format!("Node.js process exited with non-zero status: {}", status)
            ));
        }

        // 7. Clear subprocess reference and return the response
        clear_current_subprocess().await;
        Ok(ChatResponse {
            content: full_content,
            artifacts,
            model,
            usage,
            tool_calls,
        })
    }

    /**
     * Parse and validate response JSON
     */
    fn parse_response(&self, json_str: &str) -> AppResult<ChatResponse> {
        let value: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| AppError::InternalError(format!(
                "Failed to parse response JSON: {}",
                e
            )))?;

        // Check if response is an error
        if let Ok(error_resp) = serde_json::from_value::<ErrorResponse>(value.clone()) {
            return Err(AppError::InternalError(format!(
                "Claude API error: {} ({})",
                error_resp.error, error_resp.code
            )));
        }

        // Parse as successful response
        serde_json::from_value::<ChatResponse>(value)
            .map_err(|e| AppError::InternalError(format!(
                "Failed to parse response: {}",
                e
            )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_client() {
        let client = ClaudeClient::new(PathBuf::from("node-scripts/claude-sdk.js"));
        assert_eq!(
            client.node_script_path,
            PathBuf::from("node-scripts/claude-sdk.js")
        );
    }
}
