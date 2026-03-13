/**
 * Code execution commands
 *
 * Handles bash, python, and other code execution
 */

use crate::models::ExecuteCodeResponse;
use crate::utils::{AppError, AppResult};
use std::process::Command;

/**
 * Execute a bash command
 *
 * Runs the command in a bash shell and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_bash(
    command: String,
    cwd: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = cwd.unwrap_or_else(|| ".".to_string());

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
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = cwd.unwrap_or_else(|| ".".to_string());

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
 * Execute Node.js code
 *
 * Runs the JavaScript code with Node.js and returns stdout/stderr
 */
#[tauri::command]
pub async fn execute_node(
    code: String,
    cwd: Option<String>,
) -> AppResult<ExecuteCodeResponse> {
    let work_dir = cwd.unwrap_or_else(|| ".".to_string());

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
