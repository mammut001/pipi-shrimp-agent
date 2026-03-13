#![allow(dead_code)]

/**
 * Claude IPC Module
 *
 * Manages communication with Claude Code via subprocess
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::io::{BufReader};
use std::process::{Child, ChildStdout, ChildStdin};

/// Claude process state
pub struct ClaudeState {
    /// Active Claude processes
    processes: Mutex<HashMap<String, ClaudeProcess>>,
}

impl Default for ClaudeState {
    fn default() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

/// A Claude Code process instance
pub struct ClaudeProcess {
    /// Process ID
    pub id: String,
    /// Child process handle
    pub child: Child,
    /// Input stream to Claude
    pub stdin: ChildStdin,
    /// Output stream from Claude
    pub stdout: BufReader<ChildStdout>,
}

/// Claude message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ClaudeMessage {
    /// Start a new session
    StartSession { id: String, prompt: Option<String> },
    /// Send a message to Claude
    SendMessage { session_id: String, content: String },
    /// Stop a session
    StopSession { session_id: String },
    /// Session started response
    SessionStarted { id: String },
    /// Claude response
    ClaudeResponse { session_id: String, content: String },
    /// Error response
    Error { message: String },
    /// Session ended
    SessionEnded { session_id: String },
}

/// Request to start a Claude session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartClaudeRequest {
    /// Session ID
    pub session_id: String,
    /// Optional system prompt
    pub system_prompt: Option<String>,
    /// Optional initial prompt
    pub prompt: Option<String>,
}

/// Request to send message to Claude
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendToClaudeRequest {
    /// Session ID
    pub session_id: String,
    /// Message content
    pub content: String,
}

/// Response from Claude
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeResponse {
    /// Session ID
    pub session_id: String,
    /// Response content
    pub content: String,
    /// Whether this is a final response
    pub done: bool,
}

impl ClaudeState {
    /// Create a new Claude state
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if Claude is available
    pub fn is_available() -> bool {
        Command::new("claude")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Get the Claude version
    pub fn get_version() -> Option<String> {
        Command::new("claude")
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    None
                }
            })
    }
}
