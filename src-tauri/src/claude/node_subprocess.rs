/**
 * Claude Node.js subprocess manager
 *
 * Handles spawning and communicating with Node.js subprocess
 */

use crate::utils::{AppResult, AppError};
use serde_json;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::message::{ChatRequest, ChatResponse, ErrorResponse, Message};

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
