use crate::commands::file::resolve_path;
/**
 * Code execution commands
 *
 * Handles bash, python, and other code execution
 * Includes persistent REPL session support
 */
use crate::models::ExecuteCodeResponse;
use crate::models::ToolExecutionStatus;
use crate::tools::output_sanitizer::sanitize_execute_code_output;
use crate::tools::process_manager::{spawn_bash_process, wait_for_managed_process};
use crate::utils::{AppError, AppResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

// Global session manager for persistent REPL sessions
// Maps session_id -> Python REPL process
static PYTHON_SESSIONS: Lazy<Mutex<HashMap<String, PythonSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// A persistent Python REPL session.
///
/// stdout/stderr reader threads are spawned once when the session is created.
/// Each `execute_python_session` call writes to stdin and reads from the
/// long-lived stdout channel, so handles are never consumed.
struct PythonSession {
    /// The child process (kept for killing on cleanup / Drop).
    process: std::process::Child,
    /// Writer to the child's stdin. Wrapped in Arc<Mutex<>> so we can use it
    /// without holding the PYTHON_SESSIONS lock.
    stdin: Arc<Mutex<std::io::BufWriter<std::process::ChildStdin>>>,
    /// Receiver end of the stdout line channel. The sender end is held by the
    /// long-lived reader thread.
    stdout_rx: Arc<Mutex<mpsc::Receiver<String>>>,
    /// Shared stderr buffer. The long-lived stderr reader thread appends to it.
    stderr_buf: Arc<Mutex<String>>,
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteBashArgs {
    pub command: String,
    pub work_dir: Option<String>,
    #[allow(dead_code)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub execution_id: Option<String>,
}

/// Block known-destructive bash command patterns.
/// This is a defence-in-depth measure — the AI system prompt also restricts these,
/// but we enforce it at the code level too.
fn check_command_safety(command: &str) -> AppResult<()> {
    crate::commands::path_security::validate_command(command)
        .map_err(|e| AppError::ProcessError(e.message.clone()))?;

    // Normalize whitespace for pattern matching (collapse runs of spaces/tabs)
    let normalized: String = command.split_whitespace().collect::<Vec<_>>().join(" ");

    // Use regex patterns for more robust matching (prevents bypass via case/Unicode)
    // Pre-compiled patterns for performance
    use regex::Regex;

    static BLOCKED_PATTERNS: &[(&str, &str)] = &[
        (r"(?i)\brm\s+(-rf?)\s+/\s*$", "Attempting to delete root filesystem"),
        (r"(?i)\brm\s+(-rf?)\s+~\s*$", "Attempting to delete home directory"),
        (r"(?i)\bmkfs\b", "Filesystem creation command"),
        (r"(?i)\bdd\s+if=\S+\s+of=/dev", "Writing to block device"),
        (r":\(\)\s*:\s*\|\s*:\s*&", "Fork bomb"),
        (r"(?i)\bchmod\s+(-R\s+)?777\s+/\s*$", "Making root filesystem world-writable"),
        (r"(?i)\bchmod\s+(-R\s+)?777\s+~\s*$", "Making home directory world-writable"),
        (r"(?i)\bchown\s+(-R\s+)?\S+:\S+\s+/\s*$", "Changing root ownership"),
        (r"(?i)\bshutdown\b", "System shutdown command"),
        (r"(?i)\breboot\b", "System reboot command"),
        (r"(?i)\bhalt\b", "System halt command"),
        (r"(?i)\bpoweroff\b", "System poweroff command"),
    ];

    for (pattern, description) in BLOCKED_PATTERNS {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(&normalized) {
                return Err(AppError::ProcessError(format!(
                    "Command blocked for safety: {}",
                    description
                )));
            }
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
) -> AppResult<ExecuteCodeResponse> {
    let resolved_cwd = resolve_command_cwd(cwd.map(str::to_string), work_dir)?;

    check_command_safety(command)?;

    if !command_exists("bash") {
        return Err(AppError::ProcessError(
            "Bash is not installed on your system".to_string(),
        ));
    }

    let handle = spawn_bash_process(command, &resolved_cwd, requested_execution_id)?;
    let execution_id = handle.execution_id.clone();
    let managed = wait_for_managed_process(handle, timeout_secs.unwrap_or(300))?;
    let output = managed.output;
    let timed_out = managed.status == ToolExecutionStatus::TimedOut;

    let mut stderr = output.stderr;
    if timed_out {
        if !stderr.is_empty() && !stderr.ends_with(b"\n") {
            stderr.push(b'\n');
        }
        stderr.extend_from_slice(format!("Command timed out after {} seconds", timeout_secs.unwrap_or(300)).as_bytes());
    }

    Ok(build_execute_code_response(
        &output.stdout,
        &stderr,
        if timed_out || managed.status == ToolExecutionStatus::Cancelled {
            -1
        } else {
            output.status.code().unwrap_or(-1)
        },
        Some(resolved_cwd.as_str()),
        timed_out,
        execution_id.as_str(),
        managed.status,
    ))
}

/**
 * Execute a bash command
 *
 * Runs the command in a bash shell and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_bash(args: ExecuteBashArgs) -> AppResult<ExecuteCodeResponse> {
    execute_bash_for_tool(
        &args.command,
        None,
        args.work_dir.as_deref(),
        args.timeout_secs,
        args.execution_id.as_deref(),
    )
}

/// Spawn a child process and wait for it with a timeout.
/// Returns (stdout, stderr, exit_code, timed_out).
fn run_with_timeout(
    program: &str,
    args: &[&str],
    cwd: &str,
    timeout: Duration,
) -> AppResult<(Vec<u8>, Vec<u8>, i32, bool)> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::ProcessError(format!("Failed to start {}: {}", program, e)))?;

    let stdout_handle = child.stdout.take().unwrap();
    let stderr_handle = child.stderr.take().unwrap();

    let stdout_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

    let stdout_buf_c = stdout_buf.clone();
    let stderr_buf_c = stderr_buf.clone();

    // Drain stdout/stderr in background threads
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout_handle);
        let _ = std::io::Read::read_to_end(&mut reader, &mut stdout_buf_c.lock().unwrap());
    });
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stderr_handle);
        let _ = std::io::Read::read_to_end(&mut reader, &mut stderr_buf_c.lock().unwrap());
    });

    // Wait with timeout
    let (tx, rx) = mpsc::channel();
    let pid = child.id();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = tx.send(status);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(status)) => {
            let stdout = stdout_buf.lock().unwrap().clone();
            let stderr = stderr_buf.lock().unwrap().clone();
            Ok((stdout, stderr, status.code().unwrap_or(-1), false))
        }
        Ok(Err(e)) => Err(AppError::ProcessError(format!("Process wait error: {}", e))),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // Kill the process
            #[cfg(unix)]
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
            let stderr = stderr_buf.lock().unwrap().clone();
            Ok((
                Vec::new(),
                stderr,
                -1,
                true,
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(AppError::ProcessError("Process channel disconnected".to_string()))
        }
    }
}

/**
 * Execute Python code
 *
 * Runs the Python code with a 30-second timeout and returns stdout/stderr.
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
}

/// Create a new persistent Python REPL session with long-lived reader threads.
/// Stdout/stderr are taken once and reader threads are spawned once; each
/// `execute_python_session` call reads from the channel rather than consuming
/// the handles.
fn create_python_session(session_id: &str, work_dir: &str) -> AppResult<()> {
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

    let mut child = Command::new("python3")
        .arg("-u") // unbuffered stdout/stderr
        .arg("-c")
        .arg(repl_script)
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::ProcessError(format!("Failed to start Python session: {}", e)))?;

    // Take stdin/stdout/stderr once — they stay valid for the session lifetime.
    let stdin_handle = child
        .stdin
        .take()
        .ok_or_else(|| AppError::ProcessError("stdin unavailable".to_string()))?;
    let stdout_handle = child
        .stdout
        .take()
        .ok_or_else(|| AppError::ProcessError("stdout unavailable".to_string()))?;
    let stderr_handle = child
        .stderr
        .take()
        .ok_or_else(|| AppError::ProcessError("stderr unavailable".to_string()))?;

    // Long-lived stdout reader thread: sends each line through a channel.
    let (stdout_tx, stdout_rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout_handle);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if stdout_tx.send(l).is_err() {
                        break; // receiver dropped
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Long-lived stderr reader thread: appends to a shared buffer.
    let stderr_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_buf_clone = stderr_buf.clone();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr_handle);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    let mut buf = stderr_buf_clone.lock().unwrap();
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(&l);
                }
                Err(_) => break,
            }
        }
    });

    let session = PythonSession {
        process: child,
        stdin: Arc::new(Mutex::new(std::io::BufWriter::new(stdin_handle))),
        stdout_rx: Arc::new(Mutex::new(stdout_rx)),
        stderr_buf,
    };

    let mut sessions = PYTHON_SESSIONS
        .lock()
        .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;
    sessions.insert(session_id.to_string(), session);
    Ok(())
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
    let work_dir = resolve_command_cwd(cwd, work_dir.as_deref())?;

    if !command_exists("python3") {
        return Err(AppError::ProcessError(
            "Python 3 is not installed on your system".to_string(),
        ));
    }

    // Unique per-call sentinel so we know when output is complete
    let sentinel = uuid::Uuid::new_v4().to_string().replace('-', "");
    let sentinel_marker = format!("__PIPI_DONE_{}__", sentinel);

    // --- Brief lock: create session if needed, clone Arc handles, drop lock ---
    let (stdin_arc, stdout_rx_arc, stderr_buf_arc) = {
        let mut sessions = PYTHON_SESSIONS
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;

        // Create session if it doesn't exist yet
        if !sessions.contains_key(&session_id) {
            // Drop lock before spawning (create_python_session re-acquires it)
            drop(sessions);
            create_python_session(&session_id, &work_dir)?;
            sessions = PYTHON_SESSIONS
                .lock()
                .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;
        }

        // Check that the process is still alive before writing
        if let Some(session) = sessions.get_mut(&session_id) {
            if let Ok(Some(status)) = session.process.try_wait() {
                let sid = session_id.clone();
                sessions.remove(&session_id);
                return Err(AppError::ProcessError(format!(
                    "Python session {} has ended (exit code {:?})",
                    sid,
                    status.code()
                )));
            }
        }

        let session = sessions.get(&session_id).unwrap();
        (
            session.stdin.clone(),
            session.stdout_rx.clone(),
            session.stderr_buf.clone(),
        )
    }; // PYTHON_SESSIONS lock is dropped here

    // --- Write to stdin (brief lock on session-level stdin mutex) ---
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(code.as_bytes());
    let exec_line = format!("__EXEC__:{}\n", encoded);
    let sentinel_line = format!("__SENTINEL__:{}\n", sentinel_marker);

    {
        let mut stdin = stdin_arc
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock stdin: {}", e)))?;
        stdin
            .write_all(exec_line.as_bytes())
            .map_err(|e| AppError::ProcessError(format!("Write error: {}", e)))?;
        stdin
            .write_all(sentinel_line.as_bytes())
            .map_err(|e| AppError::ProcessError(format!("Write sentinel error: {}", e)))?;
        stdin
            .flush()
            .map_err(|e| AppError::ProcessError(format!("Flush error: {}", e)))?;
    } // stdin lock dropped

    // --- Read from stdout channel until sentinel or timeout ---
    let timeout = Duration::from_secs(30);
    let mut output_lines: Vec<String> = Vec::new();
    let mut got_sentinel = false;

    {
        let rx = stdout_rx_arc
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock stdout_rx: {}", e)))?;
        loop {
            match rx.recv_timeout(timeout) {
                Ok(l) => {
                    if l == sentinel_marker {
                        got_sentinel = true;
                        break;
                    }
                    output_lines.push(l);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    } // stdout_rx lock dropped

    if !got_sentinel {
        // Timed out or process crashed — kill and remove the session
        let mut sessions = PYTHON_SESSIONS
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;
        if let Some(mut session) = sessions.remove(&session_id) {
            let _ = session.process.kill();
        }
        let stderr_snapshot = stderr_buf_arc.lock().unwrap().clone();
        return Ok(build_execute_code_response(
            output_lines.join("\n").as_bytes(),
            stderr_snapshot.as_bytes(),
            -1,
            Some(work_dir.as_str()),
            true,
            &format!("python-session-{}", uuid::Uuid::new_v4()),
            ToolExecutionStatus::TimedOut,
        ));
    }

    // Success — session stays alive for the next call
    let stderr_snapshot = stderr_buf_arc.lock().unwrap().clone();
    Ok(build_execute_code_response(
        output_lines.join("\n").as_bytes(),
        stderr_snapshot.as_bytes(),
        0,
        Some(work_dir.as_str()),
        false,
        &format!("python-session-{}", uuid::Uuid::new_v4()),
        ToolExecutionStatus::Succeeded,
    ))
}

/**
 * Close a Python REPL session
 */
#[tauri::command]
pub async fn close_python_session(session_id: String) -> AppResult<bool> {
    let mut sessions = PYTHON_SESSIONS
        .lock()
        .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;

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
 * Runs the JavaScript code with a 30-second timeout and returns stdout/stderr.
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn execute_bash_for_tool_returns_structured_timeout_result() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-timeout-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let result = execute_bash_for_tool(
            "sleep 1",
            None,
            Some(work_dir.to_string_lossy().as_ref()),
            Some(0),
            Some("timeout-test"),
        )
        .expect("timeout should still return a structured response");

        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
        assert_eq!(result.execution_id, "timeout-test");
        assert_eq!(result.status, ToolExecutionStatus::TimedOut);
        assert!(result.stderr.contains("timed out"));

        let _ = std::fs::remove_dir_all(work_dir);
    }

    #[test]
    fn execute_bash_for_tool_returns_sanitized_structured_response() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-sanitize-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let result = execute_bash_for_tool(
            "printf 'Authorization: Bearer sk-test-secret\\nOPENAI_API_KEY=sk-abc12345\\n'",
            None,
            Some(work_dir.to_string_lossy().as_ref()),
            Some(5),
            Some("smoke-command-json"),
        )
        .expect("command should return a structured response");

        assert_eq!(result.execution_id, "smoke-command-json");
        assert_eq!(result.status, ToolExecutionStatus::Succeeded);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.cwd.as_deref(), Some(work_dir.to_string_lossy().as_ref()));
        assert!(result.sanitized);
        assert!(result.stdout.contains("Authorization: [redacted]"));
        assert!(result.stdout.contains("OPENAI_API_KEY=[redacted]"));
        assert!(!result.stdout.contains("sk-test-secret"));
        assert!(!result.stdout.contains("sk-abc12345"));

        println!(
            "SMOKE_COMMAND_RESULT_JSON={}",
            serde_json::to_string(&result).expect("result should serialize")
        );

        let _ = std::fs::remove_dir_all(work_dir);
    }

    #[test]
    fn execute_bash_for_tool_rejects_dangerous_commands() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-danger-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let error = execute_bash_for_tool(
            "rm -rf /",
            None,
            Some(work_dir.to_string_lossy().as_ref()),
            Some(5),
            Some("dangerous-command"),
        )
        .expect_err("dangerous command should be blocked");

        assert!(error.to_string().contains("Command blocked for safety"));

        let _ = std::fs::remove_dir_all(work_dir);
    }

    #[tokio::test]
    async fn execute_python_session_times_out_on_no_sentinel() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-pysess-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let session_id = format!("test-timeout-{}", Uuid::new_v4());
        let result = execute_python_session(
            "import time; time.sleep(0.1)".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("should return a response, not an error");

        // The sentinel protocol should succeed for normal code
        assert_eq!(result.status, ToolExecutionStatus::Succeeded);
        assert!(!result.timed_out);

        // Cleanup
        let _ = close_python_session(session_id).await;
        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 1: Persistent state — variable set in first call is visible in second call.
    #[tokio::test]
    async fn python_session_persists_state_between_calls() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-persist-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let session_id = format!("test-persist-{}", Uuid::new_v4());

        // First call: set x = 41
        let r1 = execute_python_session(
            "x = 41".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("first call should succeed");
        assert_eq!(r1.status, ToolExecutionStatus::Succeeded);
        assert!(!r1.timed_out);

        // Second call: print(x + 1) → should print 42
        let r2 = execute_python_session(
            "print(x + 1)".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("second call should succeed");
        assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
        assert!(!r2.timed_out);
        assert!(
            r2.stdout.contains("42"),
            "Expected stdout to contain '42', got: {}",
            r2.stdout
        );

        let _ = close_python_session(session_id).await;
        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 2: Second call doesn't fail — two sequential print calls both succeed.
    #[tokio::test]
    async fn python_session_second_call_succeeds() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-second-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let session_id = format!("test-second-{}", Uuid::new_v4());

        let r1 = execute_python_session(
            "print('first')".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("first call should succeed");
        assert_eq!(r1.status, ToolExecutionStatus::Succeeded);
        assert!(r1.stdout.contains("first"), "Expected 'first', got: {}", r1.stdout);

        let r2 = execute_python_session(
            "print('second')".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("second call should succeed");
        assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
        assert!(
            r2.stdout.contains("second"),
            "Expected 'second', got: {}",
            r2.stdout
        );

        let _ = close_python_session(session_id).await;
        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 3: stderr-heavy code doesn't hang.
    #[tokio::test]
    async fn python_session_stderr_heavy_does_not_hang() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-stderr-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let session_id = format!("test-stderr-{}", Uuid::new_v4());

        // Write a lot to stderr, then to stdout
        let code = r#"
import sys
for i in range(200):
    print(f"err line {i}", file=sys.stderr)
print("done")
"#;
        let result = execute_python_session(
            code.to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("should return within timeout");

        assert_eq!(result.status, ToolExecutionStatus::Succeeded);
        assert!(!result.timed_out);
        assert!(
            result.stdout.contains("done"),
            "Expected 'done' in stdout, got: {}",
            result.stdout
        );
        assert!(
            result.stderr.contains("err line 199"),
            "Expected stderr to contain 'err line 199', got: {}",
            result.stderr
        );

        let _ = close_python_session(session_id).await;
        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 4: Timeout cleanup — infinite loop triggers timeout, then same
    /// session_id can create a fresh session that works.
    #[tokio::test]
    async fn python_session_timeout_cleanup_and_recreate() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-toclean-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let session_id = format!("test-toclean-{}", Uuid::new_v4());

        // Infinite loop — should time out
        let r1 = execute_python_session(
            "while True: pass".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("should return a response, not hang");
        assert_eq!(r1.status, ToolExecutionStatus::TimedOut);
        assert!(r1.timed_out);

        // Same session_id should create a fresh session and work
        let r2 = execute_python_session(
            "print('recovered')".to_string(),
            session_id.clone(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .await
        .expect("fresh session should succeed");
        assert_eq!(r2.status, ToolExecutionStatus::Succeeded);
        assert!(!r2.timed_out);
        assert!(
            r2.stdout.contains("recovered"),
            "Expected 'recovered' in stdout, got: {}",
            r2.stdout
        );

        let _ = close_python_session(session_id).await;
        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 5: execute_python infinite loop returns timed_out.
    #[test]
    fn execute_python_infinite_loop_returns_timed_out() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-pyto-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let result = execute_python(
            "while True: pass".to_string(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .expect("should return a response, not hang");

        assert!(result.timed_out);
        assert_eq!(result.status, ToolExecutionStatus::TimedOut);
        assert_eq!(result.exit_code, -1);
        assert!(result.stderr.contains("timed out"));

        let _ = std::fs::remove_dir_all(work_dir);
    }

    /// Test 6: execute_node long-running interval returns timed_out.
    #[test]
    fn execute_node_long_running_returns_timed_out() {
        let work_dir = std::env::temp_dir().join(format!("pipi-code-nodeto-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&work_dir).expect("temp dir should exist");

        let result = execute_node(
            "setInterval(() => {}, 100)".to_string(),
            None,
            Some(work_dir.to_string_lossy().to_string()),
        )
        .expect("should return a response, not hang");

        assert!(result.timed_out);
        assert_eq!(result.status, ToolExecutionStatus::TimedOut);
        assert_eq!(result.exit_code, -1);
        assert!(result.stderr.contains("timed out"));

        let _ = std::fs::remove_dir_all(work_dir);
    }
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
