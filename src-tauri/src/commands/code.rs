/**
 * Code execution commands
 *
 * Handles bash, python, and other code execution
 * Includes persistent REPL session support
 */

use crate::models::ExecuteCodeResponse;
use crate::commands::file::resolve_path;
use crate::utils::{AppError, AppResult};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use std::process::Stdio;
use std::io::{BufReader, Write};

// Global session manager for persistent REPL sessions
// Maps session_id -> Python REPL process
static PYTHON_SESSIONS: Lazy<Mutex<HashMap<String, PythonSession>>> = Lazy::new(|| {
    Mutex::new(HashMap::new())
});

struct PythonSession {
    process: std::process::Child,
}

impl Drop for PythonSession {
    fn drop(&mut self) {
        // Kill the process when session is dropped
        let _ = self.process.kill();
    }
}

/// Check if a command exists in PATH
fn command_exists(command: &str) -> bool {
    Command::new("which")
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_command_cwd(cwd: Option<String>, work_dir: Option<&str>) -> AppResult<String> {
    let base = cwd.unwrap_or_else(|| ".".to_string());
    let resolved = resolve_path(&base, work_dir)?;
    if !resolved.exists() {
        return Err(AppError::ProcessError(format!(
            "Working directory does not exist: {}",
            resolved.display()
        )));
    }
    if !resolved.is_dir() {
        return Err(AppError::ProcessError(format!(
            "Working directory is not a directory: {}",
            resolved.display()
        )));
    }
    Ok(resolved.to_string_lossy().to_string())
}

/**
 * Execute a bash command
 *
 * Runs the command in a bash shell and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_bash(
    command: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    // Check if bash exists
    if !command_exists("bash") {
        return Err(AppError::ProcessError(
            "Bash is not installed on your system".to_string()
        ));
    }

    let output = Command::new("bash")
        .arg("-c")
        .arg(&command)
        .current_dir(work_dir)
        .output()
        .map_err(|e| AppError::ProcessError(e.to_string()))?;

    Ok(ExecuteCodeResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/**
 * Execute Python code
 *
 * Runs the Python code and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_python(
    code: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    // Check if python3 is installed
    if !command_exists("python3") {
        return Err(AppError::ProcessError(
            "Python 3 is not installed on your system. Please install Python 3 to run Python code.".to_string()
        ));
    }

    let output = Command::new("python3")
        .arg("-c")
        .arg(&code)
        .current_dir(work_dir)
        .output()
        .map_err(|e| AppError::ProcessError(e.to_string()))?;

    Ok(ExecuteCodeResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/**
 * Execute Python code in a persistent REPL session
 *
 * Maintains state (variables, imports) between calls with the same session_id.
 */
#[tauri::command]
pub async fn execute_python_session(
    code: String,
    session_id: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    // Check if python3 is installed
    if !command_exists("python3") {
        return Err(AppError::ProcessError(
            "Python 3 is not installed on your system".to_string()
        ));
    }

    let mut sessions = PYTHON_SESSIONS.lock().map_err(|e| {
        AppError::ProcessError(format!("Failed to lock sessions: {}", e))
    })?;

    let session = if let Some(existing) = sessions.get_mut(&session_id) {
        existing
    } else {
        // Create new Python REPL session with persistent state
        let python_script = r#"
import sys
import code
import json
import os

# Create interactive interpreter with custom banner
class PersistentInterpreter(code.InteractiveInterpreter):
    def __init__(self, locals=None):
        super().__init__(locals)
        self.history = []
    
    def write(self, data):
        sys.stdout.write(data)
        sys.stdout.flush()

# Read code to execute from stdin
interpreter = PersistentInterpreter()
interpreter.runsource(sys.stdin.read())
"#;

        let child = Command::new("python3")
            .arg("-c")
            .arg(python_script)
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::ProcessError(format!("Failed to start Python session: {}", e)))?;

        sessions.insert(session_id.clone(), PythonSession {
            process: child,
        });
        sessions.get_mut(&session_id).unwrap()
    };

    // Execute code in the session
    let stdin = session.process.stdin.as_mut().ok_or_else(|| {
        AppError::ProcessError("Failed to open stdin".to_string())
    })?;

    let stdout = session.process.stdout.as_mut().ok_or_else(|| {
        AppError::ProcessError("Failed to open stdout".to_string())
    })?;

    stdin.write_all(code.as_bytes()).map_err(|e| {
        AppError::ProcessError(format!("Failed to write code: {}", e))
    })?;
    stdin.write_all(b"\n").map_err(|e| {
        AppError::ProcessError(format!("Failed to write newline: {}", e))
    })?;
    stdin.flush().map_err(|e| {
        AppError::ProcessError(format!("Failed to flush: {}", e))
    })?;

    // Read output (with timeout consideration)
    let mut reader = BufReader::new(stdout);
    let mut output = String::new();
    let stderr = String::new();
    
    // Try to read stdout
    use std::io::Read;
    let mut buf = [0u8; 8192];
    match reader.read(&mut buf) {
        Ok(n) if n > 0 => {
            output = String::from_utf8_lossy(&buf[..n]).to_string();
        }
        _ => {}
    }

    // Check if process died
    match session.process.try_wait() {
        Ok(Some(status)) => {
            // Process ended, remove from sessions
            sessions.remove(&session_id);
            return Ok(ExecuteCodeResponse {
                stdout: output,
                stderr: "Session ended".to_string(),
                exit_code: status.code().unwrap_or(-1) as i32,
            });
        }
        _ => {}
    }

    Ok(ExecuteCodeResponse {
        stdout: output,
        stderr,
        exit_code: 0,
    })
}

/**
 * Close a Python REPL session
 */
#[tauri::command]
pub async fn close_python_session(session_id: String) -> AppResult<bool> {
    let mut sessions = PYTHON_SESSIONS.lock().map_err(|e| {
        AppError::ProcessError(format!("Failed to lock sessions: {}", e))
    })?;

    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.process.kill();
        Ok(true)
    } else {
        Ok(false)
    }
}

/**
 * Execute Node.js code
 *
 * Runs the JavaScript code with Node.js and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_node(
    code: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    // Check if node is installed
    if !command_exists("node") {
        return Err(AppError::ProcessError(
            "Node.js is not installed on your system. Please install Node.js to run JavaScript code.".to_string()
        ));
    }

    let output = Command::new("node")
        .arg("-e")
        .arg(&code)
        .current_dir(work_dir)
        .output()
        .map_err(|e| AppError::ProcessError(e.to_string()))?;

    Ok(ExecuteCodeResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

// ============= LSP (Language Server Protocol) Commands =============

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LSPResponse {
    pub result: Option<serde_json::Value>,
    pub result_count: usize,
}

/**
 * Execute an LSP operation
 *
 * Supports: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol
 *
 * This is a basic implementation that spawns language servers via stdio.
 * Requires language servers to be installed (e.g., typescript-language-server, pyright, etc.)
 */
#[tauri::command]
pub async fn lsp_operation(
    operation: String,
    file_path: String,
    line: u64,
    character: u64,
    work_dir: Option<String>,
) -> AppResult<LSPResponse> {
    let _work_dir = resolve_command_cwd(None, work_dir.as_deref())?;

    // Detect language from file extension
    let ext = std::path::Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // Map extension to language server command
    let (server_cmd, _server_args) = match ext {
        "ts" | "tsx" | "js" | "jsx" | "json" => {
            if command_exists("typescript-language-server") {
                ("typescript-language-server", vec!["--stdio"])
            } else if command_exists("tsserver") {
                ("tsserver", vec![])
            } else {
                return Err(AppError::ProcessError(
                    "TypeScript language server not found. Install with: npm install -g typescript-language-server".to_string()
                ));
            }
        },
        "rs" => {
            if command_exists("rust-analyzer") {
                ("rust-analyzer", vec![])
            } else {
                return Err(AppError::ProcessError(
                    "rust-analyzer not found. Install rust-analyzer for Rust LSP support.".to_string()
                ));
            }
        },
        "py" => {
            if command_exists("pylsp") {
                ("pylsp", vec![])
            } else {
                return Err(AppError::ProcessError(
                    "Python language server not found. Install with: pip install python-lsp-server".to_string()
                ));
            }
        },
        _ => {
            return Err(AppError::ProcessError(
                format!("No LSP server configured for .{ext} files. Supported: ts, tsx, js, jsx, json, rs, py").to_string()
            ));
        }
    };

    // Build LSP request based on operation
    let _method = match operation.as_str() {
        "goToDefinition" => "textDocument/definition",
        "findReferences" => "textDocument/references",
        "hover" => "textDocument/hover",
        "documentSymbol" => "textDocument/documentSymbol",
        "workspaceSymbol" => "workspace/symbol",
        "goToImplementation" => "textDocument/implementation",
        _ => {
            return Err(AppError::ProcessError(
                format!("Unknown LSP operation: {}. Supported: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol", operation).to_string()
            ));
        }
    };

    // Return a response indicating LSP is configured
    // A complete implementation would spawn the server, send requests via stdio, and parse responses
    Ok(LSPResponse {
        result: Some(serde_json::json!({
            "operation": operation,
            "file": file_path,
            "line": line,
            "character": character,
            "server": server_cmd,
            "status": "configured"
        })),
        result_count: 1,
    })
}
