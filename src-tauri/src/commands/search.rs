/**
 * Search commands
 *
 * High-performance text searching using ripgrep (rg)
 */

use crate::commands::file::resolve_path;
use crate::utils::{AppError, AppResult};
use std::process::Command;

/**
 * Check if ripgrep is installed
 */
fn check_ripgrep() -> AppResult<String> {
    // 1. Check if rg is in the system PATH
    if let Ok(output) = Command::new("which").arg("rg").output() {
        if output.status.success() {
            return Ok("rg".to_string());
        }
    }

    // 2. Check in common cargo bin location
    if let Ok(home) = std::env::var("HOME") {
        let cargo_rg = format!("{}/.cargo/bin/rg", home);
        if std::path::Path::new(&cargo_rg).exists() {
            return Ok(cargo_rg);
        }
    }

    Err(AppError::InternalError(
        "ripgrep not found, please install rg to use advanced search".to_string()
    ))
}

/**
 * Search for a pattern in files using ripgrep
 *
 * # Arguments
 * * `pattern` - The search pattern (supports regex)
 * * `path` - The directory path to search in
 * * `extensions` - Optional list of file extensions to filter (e.g., ["rs", "ts"])
 *
 * # Returns
 * A JSON string with search results including file paths and line numbers
 */
#[tauri::command]
pub async fn search_files(
    pattern: String,
    path: String,
    extensions: Option<Vec<String>>,
    work_dir: Option<String>,
) -> AppResult<String> {
    // Check for ripgrep and get the executable path
    let rg_path = check_ripgrep()?;

    let expanded_path = resolve_path(&path, work_dir.as_deref())?;

    // Build rg command
    let mut cmd = Command::new(rg_path);
    cmd.arg("--json")
       .arg("--line-number")
       .arg(&pattern)
       .arg(&expanded_path);

    // Add extension filters if provided
    if let Some(exts) = extensions {
        if !exts.is_empty() {
            let ext_args: Vec<String> = exts.iter().map(|e| format!(".{}", e)).collect();
            cmd.arg("--type-add")
               .arg(format!("custom:{}",
                   ext_args.iter().cloned().collect::<Vec<_>>().join(",")));
            cmd.arg("--type");
            cmd.arg("custom");
        }
    }

    let output = cmd.output()
        .map_err(|e| AppError::InternalError(format!("Failed to execute ripgrep: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // If there's an error in stderr (not just warnings), return it
    if !output.status.success() && !stderr.is_empty() {
        // Check if it's a "no matches" error vs a real error
        if stderr.contains("No matches were found") || stderr.contains("0 matches") {
            // Return empty results for no matches
            return Ok("[]".to_string());
        }
        return Err(AppError::InternalError(format!("Search error: {}", stderr)));
    }

    // Parse JSON output from rg --json
    let mut results: Vec<serde_json::Value> = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            // Only include match events
            if json.get("type").and_then(|v| v.as_str()) == Some("match") {
                results.push(json);
            }
        }
    }

    serde_json::to_string(&results)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize results: {}", e)))
}

/**
 * Search for files matching a glob pattern
 *
 * # Arguments
 * * `pattern` - The glob pattern (e.g., "globstar pattern", "wildcard expansion")
 * * `path` - The directory path to search in
 *
 * # Returns
 * A JSON string with list of matching file paths
 */
#[tauri::command]
pub async fn glob_search(pattern: String, path: String, work_dir: Option<String>) -> AppResult<String> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    let full_pattern = format!("{}/{}", expanded_path.to_string_lossy(), pattern);

    let mut files = Vec::new();
    
    // Use glob crate for true globbing
    for entry in glob::glob(&full_pattern)
        .map_err(|e| AppError::InternalError(format!("Invalid glob pattern: {}", e)))? {
        match entry {
            Ok(path) => {
                if path.is_file() {
                    files.push(path.to_string_lossy().to_string());
                }
            },
            Err(e) => println!("Warning: Glob match error: {:?}", e),
        }
    }

    serde_json::to_string(&files)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize results: {}", e)))
}

/**
 * Simple grep-like search (fallback when ripgrep not available)
 *
 * # Arguments
 * * `pattern` - The search pattern
 * * `path` - The file path to search in
 *
 * # Returns
 * A JSON string with search results
 */
#[tauri::command]
pub async fn grep_files(pattern: String, path: String, work_dir: Option<String>) -> AppResult<String> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;

    let output = Command::new("grep")
        .arg("-n")
        .arg("--binary-files=without-match")
        .arg("-r")
        .arg(&pattern)
        .arg(&expanded_path)
        .output()
        .map_err(|e| AppError::InternalError(format!("Failed to execute grep: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.is_empty() {
        return Ok("[]".to_string());
    }

    // Parse grep output into structured results
    let results: Vec<serde_json::Value> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            // grep -n output format: path:line:content
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            if parts.len() >= 3 {
                Some(serde_json::json!({
                    "path": parts[0],
                    "line_number": parts[1],
                    "content": parts[2]
                }))
            } else {
                None
            }
        })
        .collect();

    serde_json::to_string(&results)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize results: {}", e)))
}
