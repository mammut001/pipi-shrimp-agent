use super::cwd::resolve_command_cwd;
use super::{build_execute_code_response, command_exists};
use crate::models::{ExecuteCodeResponse, ToolExecutionStatus};
use crate::utils::{AppError, AppResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

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
        print(raw_line[13:], flush=True)
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

pub(super) fn execute_python_session(
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

    // Record stderr position before writing so we only return stderr from this call.
    let stderr_start_len = stderr_buf_arc
        .lock()
        .map_err(|e| AppError::ProcessError(format!("Failed to lock stderr_buf: {}", e)))?
        .len();

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

    // --- Read from stdout channel with absolute 30-second deadline ---
    // Bug 1 fix: absolute deadline, not per-line timeout.
    // Bug 3 fix: cap collected output at MAX_SESSION_OUTPUT_BYTES.
    const MAX_SESSION_OUTPUT_BYTES: usize = 1_048_576; // 1 MB
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut output_lines: Vec<String> = Vec::new();
    let mut output_bytes: usize = 0;
    let mut output_truncated = false;
    let mut got_sentinel = false;

    {
        let rx = stdout_rx_arc
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock stdout_rx: {}", e)))?;
        loop {
            if Instant::now() >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(remaining) {
                Ok(l) => {
                    if l == sentinel_marker {
                        got_sentinel = true;
                        break;
                    }
                    if !output_truncated {
                        let line_bytes = l.len() + 1; // +1 for newline separator
                        if output_bytes + line_bytes > MAX_SESSION_OUTPUT_BYTES {
                            output_truncated = true;
                            output_lines.push("[output truncated after 1048576 bytes]".to_string());
                        } else {
                            output_bytes += line_bytes;
                            output_lines.push(l);
                        }
                    }
                    // If truncated, keep draining until sentinel or deadline to
                    // avoid leaving stale lines in the channel for the next call.
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    } // stdout_rx lock dropped

    // Compute per-call stderr (only the portion produced since we wrote code).
    let per_call_stderr = {
        let buf = stderr_buf_arc
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock stderr_buf: {}", e)))?;
        buf.get(stderr_start_len..).unwrap_or("").to_string()
    };

    if !got_sentinel {
        // Timed out or process crashed — kill and remove the session
        let mut sessions = PYTHON_SESSIONS
            .lock()
            .map_err(|e| AppError::ProcessError(format!("Failed to lock sessions: {}", e)))?;
        if let Some(mut session) = sessions.remove(&session_id) {
            let _ = session.process.kill();
        }
        // Append timeout message to per-call stderr
        let mut final_stderr = per_call_stderr;
        if !final_stderr.is_empty() && !final_stderr.ends_with('\n') {
            final_stderr.push('\n');
        }
        final_stderr.push_str("Python session timed out after 30 seconds");
        return Ok(build_execute_code_response(
            output_lines.join("\n").as_bytes(),
            final_stderr.as_bytes(),
            -1,
            Some(work_dir.as_str()),
            true,
            &format!("python-session-{}", uuid::Uuid::new_v4()),
            ToolExecutionStatus::TimedOut,
        ));
    }

    // Success — session stays alive for the next call
    Ok(build_execute_code_response(
        output_lines.join("\n").as_bytes(),
        per_call_stderr.as_bytes(),
        0,
        Some(work_dir.as_str()),
        false,
        &format!("python-session-{}", uuid::Uuid::new_v4()),
        ToolExecutionStatus::Succeeded,
    ))
}

pub(super) fn close_python_session(session_id: String) -> AppResult<bool> {
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
