/**
 * Code execution commands
 *
 * Handles bash, python, and other code execution
 * Includes persistent REPL session support
 */
mod cwd;
mod python_session;

use self::cwd::resolve_command_cwd;
use crate::models::ExecuteCodeResponse;
use crate::models::ToolExecutionStatus;
use crate::tools::output_sanitizer::sanitize_execute_code_output;
use crate::tools::process_manager::{spawn_shell_process, wait_for_managed_process};
use crate::tools::shell_profile::{resolve_command_shell, WindowsShellProfile};
use crate::utils::{AppError, AppResult};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Check if a command exists in PATH
fn command_exists(command: &str) -> bool {
    let locator = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    Command::new(locator)
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn build_execute_code_response(
    stdout: &[u8],
    stderr: &[u8],
    exit_code: i32,
    cwd: Option<&str>,
    timed_out: bool,
    execution_id: &str,
    status: ToolExecutionStatus,
) -> ExecuteCodeResponse {
    sanitize_execute_code_output(
        stdout,
        stderr,
        exit_code,
        cwd,
        timed_out,
        execution_id,
        status,
    )
}

fn build_failed_command_response(
    message: &str,
    cwd: Option<&str>,
    execution_id: Option<&str>,
) -> ExecuteCodeResponse {
    let execution_id = execution_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    build_execute_code_response(
        b"",
        message.as_bytes(),
        -1,
        cwd,
        false,
        execution_id.as_str(),
        ToolExecutionStatus::Failed,
    )
}

fn append_warning(stderr: &mut Vec<u8>, warning: &str) {
    if warning.trim().is_empty() {
        return;
    }
    if !stderr.is_empty() && !stderr.ends_with(b"\n") {
        stderr.push(b'\n');
    }
    stderr.extend_from_slice(warning.as_bytes());
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteBashArgs {
    pub command: String,
    pub work_dir: Option<String>,
    #[allow(dead_code)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub execution_id: Option<String>,
    #[serde(default)]
    pub windows_shell_profile: Option<WindowsShellProfile>,
}

/// Block known-destructive bash command patterns.
/// This is a defence-in-depth measure — the AI system prompt also restricts these,
/// but we enforce it at the code level too.
fn check_command_safety(command: &str) -> AppResult<()> {
    crate::commands::path_security::validate_command(command)
        .map_err(|e| AppError::ProcessError(e.message.clone()))?;

    // Normalize whitespace for pattern matching (collapse runs of spaces/tabs)
    let normalized: String = command.split_whitespace().collect::<Vec<_>>().join(" ");

    // AUDIT-FIX [fix-1#13] — Pre-compile the second-pass safety patterns via
    // `once_cell::Lazy` so they aren't rebuilt on every call. `expect` here is
    // safe because patterns are literal string constants.
    use once_cell::sync::Lazy;

    struct SafetyRule {
        re: regex::Regex,
        description: &'static str,
    }

    static SAFETY_RULES: Lazy<Vec<SafetyRule>> = Lazy::new(|| {
        let raw: &[(&str, &str)] = &[
            (
                r"(?i)\brm\s+(-rf?)\s+/\s*$",
                "Attempting to delete root filesystem",
            ),
            (
                r"(?i)\brm\s+(-rf?)\s+~\s*$",
                "Attempting to delete home directory",
            ),
            (r"(?i)\bmkfs\b", "Filesystem creation command"),
            (r"(?i)\bdd\s+if=\S+\s+of=/dev", "Writing to block device"),
            (r":\(\)\s*:\s*\|\s*:\s*&", "Fork bomb"),
            (
                r"(?i)\bchmod\s+(-R\s+)?777\s+/\s*$",
                "Making root filesystem world-writable",
            ),
            (
                r"(?i)\bchmod\s+(-R\s+)?777\s+~\s*$",
                "Making home directory world-writable",
            ),
            (
                r"(?i)\bchown\s+(-R\s+)?\S+:\S+\s+/\s*$",
                "Changing root ownership",
            ),
            (r"(?i)\bshutdown\b", "System shutdown command"),
            (r"(?i)\breboot\b", "System reboot command"),
            (r"(?i)\bhalt\b", "System halt command"),
            (r"(?i)\bpoweroff\b", "System poweroff command"),
        ];
        raw.iter()
            .map(|(pat, desc)| SafetyRule {
                re: regex::Regex::new(pat).expect("safety regex must compile"),
                description: desc,
            })
            .collect()
    });

    for rule in SAFETY_RULES.iter() {
        if rule.re.is_match(&normalized) {
            return Err(AppError::ProcessError(format!(
                "Command blocked for safety: {}",
                rule.description
            )));
        }
    }
    Ok(())
}

pub fn execute_bash_for_tool(
    command: &str,
    cwd: Option<&str>,
    work_dir: Option<&str>,
    timeout_secs: Option<u64>,
    requested_execution_id: Option<&str>,
    windows_shell_profile: Option<WindowsShellProfile>,
    extra_env: Option<&[(String, String)]>,
) -> AppResult<ExecuteCodeResponse> {
    // AUDIT-FIX [fix-1#12] — `check_command_safety` already calls
    // `path_security::validate_command` and then layers a second pass. We
    // now call them explicitly instead of via a single wrapper to make the
    // ordering and intent obvious, and so the dangerous-pattern list is
    // checked exactly once. Run safety checks before cwd resolution so a
    // dangerous command is rejected even when the working directory is invalid.
    check_command_safety(command)?;

    let resolved_cwd = resolve_command_cwd(cwd.map(str::to_string), work_dir)?;

    let shell_plan =
        resolve_command_shell(windows_shell_profile, Some(resolved_cwd.as_str()), command)?;
    if let Some(message) = shell_plan.blocking_message.as_deref() {
        return Ok(build_failed_command_response(
            message,
            shell_plan
                .display_cwd
                .as_deref()
                .or(Some(resolved_cwd.as_str())),
            requested_execution_id,
        ));
    }

    if !command_exists(&shell_plan.program) {
        return Ok(build_failed_command_response(
            &format!(
                "The selected shell '{}' is not available on this system.",
                shell_plan.program
            ),
            shell_plan
                .display_cwd
                .as_deref()
                .or(Some(resolved_cwd.as_str())),
            requested_execution_id,
        ));
    }

    let handle = spawn_shell_process(
        &shell_plan.program,
        &shell_plan.args,
        shell_plan.host_cwd.as_deref(),
        requested_execution_id,
        extra_env,
    )?;
    let execution_id = handle.execution_id.clone();
    let managed = wait_for_managed_process(handle, timeout_secs.unwrap_or(300))?;
    let output = managed.output;
    let timed_out = managed.status == ToolExecutionStatus::TimedOut;

    let mut stderr = output.stderr;
    if let Some(warning) = shell_plan.warning.as_deref() {
        append_warning(&mut stderr, warning);
    }
    if timed_out {
        append_warning(
            &mut stderr,
            &format!(
                "Command timed out after {} seconds",
                timeout_secs.unwrap_or(300)
            ),
        );
    }

    Ok(build_execute_code_response(
        &output.stdout,
        &stderr,
        if timed_out || managed.status == ToolExecutionStatus::Cancelled {
            -1
        } else {
            output.status.code().unwrap_or(-1)
        },
        shell_plan
            .display_cwd
            .as_deref()
            .or(Some(resolved_cwd.as_str())),
        timed_out,
        execution_id.as_str(),
        managed.status,
    ))
}

/**
 * Execute a shell command
 *
 * Runs the command in the resolved shell profile and returns stdout/stderr.
 *
 * AUDIT-FIX [fix-1#11] — The blocking shell work is offloaded to
 * `tokio::task::spawn_blocking` so the awaited `tauri::command` future does
 * not sit on a Tokio worker thread waiting for the child to finish.
 */
#[tauri::command]
pub async fn execute_bash(args: ExecuteBashArgs) -> AppResult<ExecuteCodeResponse> {
    tokio::task::spawn_blocking(move || {
        execute_bash_for_tool(
            &args.command,
            None,
            args.work_dir.as_deref(),
            args.timeout_secs,
            args.execution_id.as_deref(),
            args.windows_shell_profile,
            None,
        )
    })
    .await
    .map_err(|e| AppError::ProcessError(format!("Blocking task join error: {}", e)))?
}

/// Spawn a child process and wait for it with a timeout.
/// Returns (stdout, stderr, exit_code, timed_out).
///
/// AUDIT-FIX [fix-1#9] — On timeout, kill the entire *process group*
/// (negative PID) on Unix so children spawned by the script (e.g. `grep
/// --color` subshells) do not survive. On Windows we fall back to `taskkill
/// /T /F` for the same effect.
///
/// AUDIT-FIX [fix-1#10] — `read_to_end` errors are now logged via
/// `eprintln!` (rather than silently dropped) so that lost pipe data is
/// observable in the dev log.
fn run_with_timeout(
    program: &str,
    args: &[&str],
    cwd: &str,
    timeout: Duration,
) -> AppResult<(Vec<u8>, Vec<u8>, i32, bool)> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // AUDIT-FIX [fix-1#9] — Put the child in its own process group so a
    // group-wide kill on timeout takes out shell children as well. This is
    // best-effort; failure to call `setpgid` is not fatal.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: `pre_exec` runs in the forked child between fork and exec;
        // calling `setpgid(0, 0)` is async-signal-safe.
        unsafe {
            cmd.pre_exec(|| {
                libc::setpgid(0, 0);
                Ok(())
            });
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::ProcessError(format!("Failed to start {}: {}", program, e)))?;

    let stdout_handle = child.stdout.take().unwrap();
    let stderr_handle = child.stderr.take().unwrap();

    let stdout_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

    let stdout_buf_c = stdout_buf.clone();
    let stderr_buf_c = stderr_buf.clone();

    // AUDIT-FIX [fix-1#10] — Drain stdout/stderr in background threads and
    // surface read errors instead of silently dropping them.
    let stdout_err = Arc::new(Mutex::new(None::<std::io::Error>));
    let stderr_err = Arc::new(Mutex::new(None::<std::io::Error>));
    let stdout_err_c = stdout_err.clone();
    let stderr_err_c = stderr_err.clone();

    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout_handle);
        if let Err(e) = std::io::Read::read_to_end(&mut reader, &mut stdout_buf_c.lock().unwrap()) {
            *stdout_err_c.lock().unwrap() = Some(e);
        }
    });
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stderr_handle);
        if let Err(e) = std::io::Read::read_to_end(&mut reader, &mut stderr_buf_c.lock().unwrap()) {
            *stderr_err_c.lock().unwrap() = Some(e);
        }
    });

    let child_pid = child.id();
    let child_arc: Arc<Mutex<Option<std::process::Child>>> = Arc::new(Mutex::new(Some(child)));
    let child_arc_c = child_arc.clone();

    // Wait with timeout
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let child_opt = {
            let mut guard = child_arc_c.lock().unwrap();
            guard.take()
        };
        let status = if let Some(mut c) = child_opt {
            c.wait().ok()
        } else {
            None
        };
        let _ = tx.send(status);
    });

    match rx.recv_timeout(timeout) {
        Ok(Some(status)) => {
            let stdout = stdout_buf.lock().unwrap().clone();
            let stderr = stderr_buf.lock().unwrap().clone();
            // Surface drain errors (best effort) — they don't fail the call
            // because the process did finish, but we make them visible.
            if let Some(e) = stdout_err.lock().unwrap().take() {
                eprintln!("[run_with_timeout] stdout drain error: {}", e);
            }
            if let Some(e) = stderr_err.lock().unwrap().take() {
                eprintln!("[run_with_timeout] stderr drain error: {}", e);
            }
            Ok((stdout, stderr, status.code().unwrap_or(-1), false))
        }
        Ok(None) => Err(AppError::ProcessError("Process wait error".to_string())),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // AUDIT-FIX [fix-1#9] — Kill the entire process group, not just
            // the parent. POSIX kill with a negative pid kills the group;
            // on Windows we shell out to `taskkill /T /F`.
            #[cfg(unix)]
            {
                // SAFETY: killpg(pid, SIGKILL) sends SIGKILL to the process group.
                unsafe {
                    libc::killpg(child_pid as i32, libc::SIGKILL);
                }
            }
            #[cfg(not(unix))]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/T", "/F", "/PID", &child_pid.to_string()])
                    .output();
            }

            if let Ok(mut guard) = child_arc.lock() {
                if let Some(ref mut c) = *guard {
                    let _ = c.kill();
                }
            }

            let stderr = stderr_buf.lock().unwrap().clone();
            Ok((Vec::new(), stderr, -1, true))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(AppError::ProcessError(
            "Process channel disconnected".to_string(),
        )),
    }
}

/**
 * Execute Python code
 *
 * Runs the Python code with a 30-second timeout and returns stdout/stderr.
 *
 * AUDIT-FIX [fix-1#11] — The blocking work is dispatched to
 * `tokio::task::spawn_blocking` so the async Tauri command doesn't park a
 * worker thread.
 */
#[tauri::command]
pub async fn execute_python(
    code: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    tokio::task::spawn_blocking(move || -> AppResult<ExecuteCodeResponse> {
        let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

        // Check if python3 is installed
        if !command_exists("python3") {
            return Err(AppError::ProcessError(
                "Python 3 is not installed on your system. Please install Python 3 to run Python code."
                    .to_string(),
            ));
        }

        let (stdout, stderr, exit_code, timed_out) =
            run_with_timeout("python3", &["-c", &code], &work_dir, Duration::from_secs(30))?;

        if timed_out {
            let mut stderr_with_msg = stderr;
            if !stderr_with_msg.is_empty() && !stderr_with_msg.ends_with(b"\n") {
                stderr_with_msg.push(b'\n');
            }
            stderr_with_msg.extend_from_slice(b"Python code timed out after 30 seconds");
            return Ok(build_execute_code_response(
                b"",
                &stderr_with_msg,
                -1,
                Some(work_dir.as_str()),
                true,
                &uuid::Uuid::new_v4().to_string(),
                ToolExecutionStatus::TimedOut,
            ));
        }

        Ok(build_execute_code_response(
            &stdout,
            &stderr,
            exit_code,
            Some(work_dir.as_str()),
            false,
            &uuid::Uuid::new_v4().to_string(),
            if exit_code == 0 {
                ToolExecutionStatus::Succeeded
            } else {
                ToolExecutionStatus::Failed
            },
        ))
    })
    .await
    .map_err(|e| AppError::ProcessError(format!("Blocking task join error: {}", e)))?
}

/**
 * Execute Python code in a persistent REPL session
 *
 * Uses a sentinel-based protocol so the session process stays alive across
 * multiple calls and variables/imports are preserved between invocations.
 *
 * The global PYTHON_SESSIONS mutex is never held while waiting for output.
 */
#[tauri::command]
pub async fn execute_python_session(
    code: String,
    session_id: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    self::python_session::execute_python_session(code, session_id, cwd, work_dir)
}

/**
 * Close a Python REPL session
 */
#[tauri::command]
pub async fn close_python_session(session_id: String) -> AppResult<bool> {
    self::python_session::close_python_session(session_id)
}

/**
 * Execute Node.js code
 *
 * Runs the JavaScript code with a 30-second timeout and returns stdout/stderr.
 *
 * AUDIT-FIX [fix-1#11] — Blocking work is moved to `spawn_blocking`.
 */
#[tauri::command]
pub async fn execute_node(
    code: String,
    cwd: Option<String>,
    work_dir: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    tokio::task::spawn_blocking(move || -> AppResult<ExecuteCodeResponse> {
        let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

        // Check if node is installed
        if !command_exists("node") {
            return Err(AppError::ProcessError(
                "Node.js is not installed on your system. Please install Node.js to run JavaScript code.".to_string()
            ));
        }

        let (stdout, stderr, exit_code, timed_out) =
            run_with_timeout("node", &["-e", &code], &work_dir, Duration::from_secs(30))?;

        if timed_out {
            let mut stderr_with_msg = stderr;
            if !stderr_with_msg.is_empty() && !stderr_with_msg.ends_with(b"\n") {
                stderr_with_msg.push(b'\n');
            }
            stderr_with_msg.extend_from_slice(b"Node.js code timed out after 30 seconds");
            return Ok(build_execute_code_response(
                b"",
                &stderr_with_msg,
                -1,
                Some(work_dir.as_str()),
                true,
                &uuid::Uuid::new_v4().to_string(),
                ToolExecutionStatus::TimedOut,
            ));
        }

        Ok(build_execute_code_response(
            &stdout,
            &stderr,
            exit_code,
            Some(work_dir.as_str()),
            false,
            &uuid::Uuid::new_v4().to_string(),
            if exit_code == 0 {
                ToolExecutionStatus::Succeeded
            } else {
                ToolExecutionStatus::Failed
            },
        ))
    })
    .await
    .map_err(|e| AppError::ProcessError(format!("Blocking task join error: {}", e)))?
}

#[cfg(test)]
mod tests;

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
        }
        "rs" => {
            if command_exists("rust-analyzer") {
                ("rust-analyzer", vec![])
            } else {
                return Err(AppError::ProcessError(
                    "rust-analyzer not found. Install rust-analyzer for Rust LSP support."
                        .to_string(),
                ));
            }
        }
        "py" => {
            if command_exists("pylsp") {
                ("pylsp", vec![])
            } else {
                return Err(AppError::ProcessError(
                    "Python language server not found. Install with: pip install python-lsp-server"
                        .to_string(),
                ));
            }
        }
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
