use std::sync::Arc;

use crate::commands::file::resolve_path as resolve_tool_path;
use super::{ToolHandlerOutput, ToolMetadata, ToolRegistry};

pub(super) fn register_search_files(registry: &mut ToolRegistry) {
    // --- search_files (ripgrep) ---
    registry.register(
        "search_files",
        Arc::new(|args| {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            // AUDIT-FIX [fix-3#15] — Reject patterns that are known to
            // cause catastrophic backtracking in Rust's `regex` engine (and
            // by extension in `rg`'s default mode). The user-friendly
            // alternative is ripgrep's `rust` regex engine which is
            // O(n*m) but with a much smaller constant and is also bounded
            // by the input length. We additionally set a hard time limit.
            if pattern.len() > 4096 {
                return Err(anyhow::anyhow!(
                    "search_files pattern is too long ({} chars); max 4096",
                    pattern.len()
                ));
            }
            if pattern.contains("(a+)+") || pattern.contains("(a*)*") || pattern.contains("(.*)*") {
                return Err(anyhow::anyhow!(
                    "search_files pattern contains a quantifier-on-quantifier \
                     construct (e.g. `(a+)+`) known to cause catastrophic \
                     backtracking. Use a simpler pattern or PCRE2."
                ));
            }
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;

            // Use Rust's regex engine (no PCRE) and a hard timeout. If the
            // installed `rg` doesn't support `--engine` (very old versions),
            // we still get a per-process timeout from std::process.
            let output = std::process::Command::new("rg")
                .arg("--line-number")
                .arg("--no-heading")
                .arg("--max-count")
                .arg("50")
                .arg("--engine")
                .arg("rust")
                .arg(pattern)
                .arg(&resolved)
                .output()
                .map_err(|e| anyhow::anyhow!("Cannot run ripgrep: {}. Is rg installed?", e))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.is_empty() {
                    Ok(ToolHandlerOutput::success(format!(
                        "No matches found for '{}' in {}",
                        pattern, path
                    )))
                } else {
                    Ok(ToolHandlerOutput::success(stdout.to_string()))
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // rg returns exit code 1 for no matches (not an error)
                if output.status.code() == Some(1) {
                    Ok(ToolHandlerOutput::success(format!(
                        "No matches found for '{}' in {}",
                        pattern, path
                    )))
                } else {
                    Err(anyhow::anyhow!("ripgrep error: {}", stderr))
                }
            }
        }),
        ToolMetadata {
            name: "search_files".to_string(),
            description: "Search for a text pattern in files using ripgrep (rg). Returns matching lines with file paths and line numbers. Fast and efficient for code search.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Text pattern to search for (supports regex)"
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search in (default: current directory)"
                    }
                },
                "required": ["pattern"],
                "additionalProperties": false,
            }),
        },
    );


}

pub(super) fn register_glob_and_grep(registry: &mut ToolRegistry) {
    // --- glob_search ---
    registry.register(
        "glob_search",
        Arc::new(|args| {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let expanded_path = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let full_pattern = format!("{}/{}", expanded_path.display(), pattern);
            let mut files = Vec::new();
            for entry in glob::glob(&full_pattern)
                .map_err(|e| anyhow::anyhow!("Invalid glob pattern: {}", e))?
            {
                if let Ok(path) = entry {
                    if path.is_file() {
                        files.push(path.to_string_lossy().to_string());
                    }
                }
            }
            serde_json::to_string(&files)
                .map(ToolHandlerOutput::success)
                .map_err(|e| anyhow::anyhow!("Failed to serialize glob results: {}", e))
        }),
        ToolMetadata {
            name: "glob_search".to_string(),
            description: "Find files matching a glob pattern under the given directory.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }),
        },
    );

    // --- grep_files ---
    registry.register(
        "grep_files",
        Arc::new(|args| {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: pattern"))?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let expanded_path = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let output = std::process::Command::new("grep")
                .arg("-n")
                .arg("--binary-files=without-match")
                .arg("-r")
                .arg(pattern)
                .arg(&expanded_path)
                .output()
                .map_err(|e| anyhow::anyhow!("Cannot run grep: {}", e))?;
            if output.status.success() {
                Ok(ToolHandlerOutput::success(
                    String::from_utf8_lossy(&output.stdout).to_string(),
                ))
            } else if output.status.code() == Some(1) {
                Ok(ToolHandlerOutput::success(format!(
                    "No matches found for '{}' in {}",
                    pattern, path
                )))
            } else {
                Err(anyhow::anyhow!(
                    "grep error: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }),
        ToolMetadata {
            name: "grep_files".to_string(),
            description: "Search for a text pattern in files using grep.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }),
        },
    );


}
