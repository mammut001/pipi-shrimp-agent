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
use std::io::Write;

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

/// Block known-destructive bash command patterns.
/// This is a defence-in-depth measure — the AI system prompt also restricts these,
/// but we enforce it at the code level too.
fn check_command_safety(command: &str) -> AppResult<()> {
    // Normalize whitespace for pattern matching (collapse runs of spaces/tabs)
    let normalized: String = command.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_lowercase();

    // Patterns checked against normalized lowercase form to prevent trivial bypasses
    // (e.g. extra spaces, mixed case). Regex-level checks are in the TypeScript layer;
    // this is a last-resort Rust guard.
    let blocked_patterns = [
        "rm -rf /",
        "rm -rf ~",
        "rm -r /",
        "rm -r ~",
        "mkfs",
        "dd if=",
        "> /dev/sda",
        ":(){ :|:& };",  // fork bomb
        "chmod -r 777 /",
        "chown -r",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
    ];
    for pattern in &blocked_patterns {
        if lower.contains(pattern) {
            return Err(AppError::ProcessError(format!(
                "Command blocked for safety: contains forbidden pattern '{}'",
                pattern
            )));
        }
    }
    Ok(())
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

    check_command_safety(&command)?;

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
 * Uses a sentinel-based protocol so the session process stays alive across
 * multiple calls and variables/imports are preserved between invocations.
 */
#[tauri::command]
pub async fn execute_python_session(
    code: String,
    session_id: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    if !command_exists("python3") {
        return Err(AppError::ProcessError(
            "Python 3 is not installed on your system".to_string()
        ));
    }

    // Unique per-call sentinel so we know when output is complete
    let sentinel = uuid::Uuid::new_v4().to_string().replace('-', "");
    let sentinel_marker = format!("__PIPI_DONE_{}__", sentinel);

    let mut sessions = PYTHON_SESSIONS.lock().map_err(|e| {
        AppError::ProcessError(format!("Failed to lock sessions: {}", e))
    })?;

    // Launch persistent REPL process if not already running
    if !sessions.contains_key(&session_id) {
        // The REPL reads lines from stdin forever.
        // Lines prefixed with __EXEC__: carry base64-encoded Python source.
        // Lines prefixed with __SENTINEL__: are echoed back to stdout so the
        // caller can detect end-of-output without closing stdin.
        let repl_script = r#"
import sys, traceback, base64

_locals = {}

for raw_line in sys.stdin:
    raw_line = raw_line.rstrip('\n')
    if raw_line.startswith('__EXEC__:'):
        src = base64.b64decode(raw_line[9:]).decode('utf-8')
        try:
            compiled = compile(src, '<session>', 'exec')
            exec(compiled, _locals)
        except SystemExit:
            break
        except Exception:
            traceback.print_exc(file=sys.stderr)
    elif raw_line.startswith('__SENTINEL__:'):
        print(raw_line, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
"#;

        let child = Command::new("python3")
            .arg("-u")  // unbuffered stdout/stderr
            .arg("-c")
            .arg(repl_script)
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::ProcessError(format!("Failed to start Python session: {}", e)))?;

        sessions.insert(session_id.clone(), PythonSession { process: child });
    }

    let session = sessions.get_mut(&session_id).unwrap();

    // Check that the process is still alive before writing
    if let Ok(Some(status)) = session.process.try_wait() {
        sessions.remove(&session_id);
        return Err(AppError::ProcessError(format!(
            "Python session {} has ended (exit code {:?})", session_id, status.code()
        )));
    }
    // Re-borrow after the check (the remove path returned early)
    let session = sessions.get_mut(&session_id).unwrap();

    // Encode code as base64 to avoid newline/escaping issues in the protocol
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(code.as_bytes());
    let exec_line = format!("__EXEC__:{}\n", encoded);
    let sentinel_line = format!("__SENTINEL__:{}\n", sentinel_marker);

    {
        let stdin = session.process.stdin.as_mut()
            .ok_or_else(|| AppError::ProcessError("stdin unavailable".to_string()))?;
        stdin.write_all(exec_line.as_bytes())
            .map_err(|e| AppError::ProcessError(format!("Write error: {}", e)))?;
        stdin.write_all(sentinel_line.as_bytes())
            .map_err(|e| AppError::ProcessError(format!("Write sentinel error: {}", e)))?;
        stdin.flush()
            .map_err(|e| AppError::ProcessError(format!("Flush error: {}", e)))?;
    }

    // Read stdout lines until the sentinel line appears
    use std::io::BufRead;
    let stdout = session.process.stdout.as_mut()
        .ok_or_else(|| AppError::ProcessError("stdout unavailable".to_string()))?;
    let reader = std::io::BufReader::new(stdout);
    let mut output_lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        match line {
            Ok(l) => {
                if l == sentinel_marker {
                    break;
                }
                output_lines.push(l);
            }
            Err(e) => return Err(AppError::ProcessError(format!("Read error: {}", e))),
        }
    }

    Ok(ExecuteCodeResponse {
        stdout: output_lines.join("\n"),
        stderr: String::new(),
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
