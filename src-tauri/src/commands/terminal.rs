/**
 * Terminal PTY commands
 *
 * Provides a real interactive terminal (PTY) inside the app.
 * Uses portable-pty for cross-platform PTY allocation and streams
 * output to the frontend via Tauri events.
 */
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::Emitter;

use crate::commands::path_security::validate_path;
use crate::tools::shell_profile::{resolve_terminal_shell, WindowsShellProfile};

/// Payload emitted to the frontend via `terminal-output` event.
#[derive(Clone, serde::Serialize)]
struct TerminalOutputPayload {
    session_id: String,
    data: String,
}

/// Payload emitted when a terminal process exits.
#[derive(Clone, serde::Serialize)]
struct TerminalExitPayload {
    session_id: String,
    exit_code: Option<u32>,
}

/// A running PTY session.
struct TerminalSession {
    writer: Box<dyn Write + Send>,
    pair: portable_pty::PtyPair,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Handle for the reader thread so we can join on close.
    _reader_handle: std::thread::JoinHandle<()>,
}

static TERMINAL_SESSIONS: Lazy<Mutex<HashMap<String, TerminalSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Detect the user's preferred shell on Unix-like hosts.
///
/// Respect SHELL when the environment provides it. Minimal Linux containers
/// frequently do not ship zsh, so fall back to the POSIX `sh` available via
/// PATH instead of assuming `/bin/zsh` exists. Windows terminals are resolved
/// by `resolve_terminal_shell` before this fallback is reached.
fn detect_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "sh".to_string())
}

/// Create a new PTY terminal session.
///
/// Spawns a shell process in the given cwd and starts streaming output
/// to the frontend via `terminal-output` events.
#[tauri::command]
pub async fn terminal_create(
    session_id: String,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    shell_profile: Option<WindowsShellProfile>,
    window: tauri::Window,
) -> Result<(), String> {
    let rows = rows.unwrap_or(24);
    let cols = cols.unwrap_or(80);

    // AUDIT-FIX [R7-13]: validate the requested cwd through path_security
    // BEFORE we hand it to the shell process. Without this, the Tauri
    // command would spawn a PTY whose cwd could be /etc, /sys, or
    // C:\Windows\System32, giving the shell process (and through it, any
    // tool that pipes through it) read access to system secrets.
    if let Some(ref dir) = cwd {
        if !dir.trim().is_empty() {
            // No work_dir — we're starting from whatever the caller asked
            // for. validate_path with no work_dir enforces:
            //   - non-empty
            //   - no path traversal (.. segments rejected)
            //   - not inside a blocked system prefix (/etc/, /usr/, etc.)
            //   - not inside a user-home sensitive dir (~/.ssh, etc.)
            //   - Windows equivalents on Windows
            validate_path(dir, None).map_err(|e| format!("Invalid cwd: {}", e))?;
        }
    }

    // If a session with this id already exists (e.g. from a stale mount /
    // StrictMode double-run), tear it down first so we can replace it cleanly.
    {
        let mut sessions = TERMINAL_SESSIONS.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = sessions.remove(&session_id) {
            let _ = old.child.kill();
        }
    }

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let terminal_plan =
        resolve_terminal_shell(shell_profile, cwd.as_deref()).map_err(|e| e.to_string())?;
    let mut cmd = if let Some(plan) = terminal_plan {
        let mut builder = CommandBuilder::new(plan.program);
        for arg in plan.args {
            builder.arg(arg);
        }
        if let Some(dir) = plan.host_cwd {
            builder.cwd(dir);
        }
        builder
    } else {
        let mut builder = CommandBuilder::new(detect_shell());
        builder.arg("-l");
        if let Some(ref dir) = cwd {
            builder.cwd(dir);
        }
        builder
    };

    // Ensure common env vars are passed through
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    // Spawn a reader thread that forwards PTY output to the frontend
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let sid = session_id.clone();
    let reader_handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // PTY closed
                    let _ = window.emit(
                        "terminal-exit",
                        TerminalExitPayload {
                            session_id: sid.clone(),
                            exit_code: None,
                        },
                    );
                    break;
                }
                Ok(n) => {
                    // Convert bytes to string (lossy — handles partial UTF-8)
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(_) => {
                    break;
                }
            }
        }
    });

    let session = TerminalSession {
        writer,
        pair,
        child,
        _reader_handle: reader_handle,
    };

    TERMINAL_SESSIONS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id, session);

    Ok(())
}

/// Write user input to an existing terminal session.
#[tauri::command]
pub async fn terminal_input(session_id: String, data: String) -> Result<(), String> {
    let mut sessions = TERMINAL_SESSIONS.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

/// Resize an existing terminal session.
#[tauri::command]
pub async fn terminal_resize(session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let sessions = TERMINAL_SESSIONS.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;

    session
        .pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {}", e))?;

    Ok(())
}

/// Close and clean up a terminal session.
#[tauri::command]
pub async fn terminal_close(session_id: String) -> Result<(), String> {
    let mut sessions = TERMINAL_SESSIONS.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        // Kill the child process
        let _ = session.child.kill();
        // Drop will clean up the rest
    }
    Ok(())
}

/// Close ALL terminal sessions (called on app exit / window close).
pub fn close_all_terminals() {
    if let Ok(mut sessions) = TERMINAL_SESSIONS.lock() {
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }
}
