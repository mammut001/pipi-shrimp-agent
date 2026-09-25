use crate::utils::{AppError, AppResult};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Check if a command exists in PATH
pub(super) fn command_exists(command: &str) -> bool {
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
pub(super) fn run_with_timeout(
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
