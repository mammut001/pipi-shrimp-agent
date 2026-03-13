#![allow(dead_code)]

/**
 * Claude Client Module
 *
 * Provides high-level interface for Claude Code interactions
 */

use super::ipc::ClaudeState;
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::collections::HashMap;

/// Claude session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSession {
    /// Session ID
    pub id: String,
    /// Whether session is active
    pub active: bool,
    /// Created timestamp
    pub created_at: u64,
}

/// Claude command request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCommandRequest {
    /// The command to execute
    pub command: String,
    /// Optional working directory
    pub cwd: Option<String>,
    /// Optional environment variables
    pub env: Option<HashMap<String, String>>,
    /// Timeout in seconds
    pub timeout: Option<u64>,
}

/// Claude chat request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeChatRequest {
    /// Message to send
    pub message: String,
    /// Optional system prompt
    pub system_prompt: Option<String>,
    /// Conversation history
    pub history: Option<Vec<ChatMessage>>,
}

/// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Role (user/assistant)
    pub role: String,
    /// Message content
    pub content: String,
}

/// Claude client for managing Claude Code interactions
pub struct ClaudeClient {
    /// Internal state
    state: ClaudeState,
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeClient {
    /// Create a new Claude client
    pub fn new() -> Self {
        Self {
            state: ClaudeState::new(),
        }
    }

    /// Check if Claude Code is available
    pub fn is_available(&self) -> bool {
        ClaudeState::is_available()
    }

    /// Get Claude Code version
    pub fn get_version(&self) -> Option<String> {
        ClaudeState::get_version()
    }

    /// Execute a command using Claude Code CLI
    pub fn execute_command(&self, request: ClaudeCommandRequest) -> AppResult<String> {
        let mut cmd = Command::new("claude");
        cmd.arg("code")
           .arg("--print")
           .arg("--silent");

        if let Some(cwd) = &request.cwd {
            cmd.current_dir(cwd);
        }

        if let Some(env) = &request.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        let output = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| AppError::ProcessError(format!("Failed to execute Claude: {}", e)))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(AppError::ProcessError(
                String::from_utf8_lossy(&output.stderr).to_string()
            ))
        }
    }

    /// Send a chat message to Claude
    pub fn chat(&self, request: ClaudeChatRequest) -> AppResult<String> {
        // Build the prompt with optional system prompt
        let mut full_prompt = String::new();

        if let Some(system) = &request.system_prompt {
            full_prompt.push_str("System: ");
            full_prompt.push_str(system);
            full_prompt.push_str("\n\n");
        }

        // Add conversation history
        if let Some(history) = &request.history {
            for msg in history {
                full_prompt.push_str(&format!("{}: {}\n", msg.role, msg.content));
            }
        }

        // Add current message
        full_prompt.push_str("User: ");
        full_prompt.push_str(&request.message);

        // Execute Claude with the prompt
        let mut cmd = Command::new("claude");
        cmd.arg("code")
           .arg("--print")
           .arg("--silent")
           .arg("-p")
           .arg(&full_prompt);

        let output = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| AppError::ProcessError(format!("Failed to execute Claude: {}", e)))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(AppError::ProcessError(
                String::from_utf8_lossy(&output.stderr).to_string()
            ))
        }
    }
}

impl Clone for ClaudeClient {
    fn clone(&self) -> Self {
        Self {
            state: ClaudeState::new(),
        }
    }
}

/// Global Claude client instance
pub fn create_claude_client() -> ClaudeClient {
    ClaudeClient::new()
}
