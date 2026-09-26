use crate::utils::{AppError, AppResult};

pub(super) fn require_remote_work_dir(args: &serde_json::Value, tool_name: &str) -> AppResult<String> {
    let remote_work_dir = args
        .get("remoteWorkDir")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::SecurityError(format!(
                "Tool '{}' requires a remoteWorkDir/root for safe execution.",
                tool_name
            ))
        })?;
    Ok(remote_work_dir.to_string())
}

pub(super) fn normalize_remote_path(path: &str, remote_work_dir: &str) -> Option<String> {
    let base = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{}/{}", remote_work_dir.trim_end_matches('/'), path)
    };

    let mut parts = Vec::new();
    for component in base.split('/') {
        match component {
            "" | "." => continue,
            ".." => {
                parts.pop()?;
            }
            value => parts.push(value),
        }
    }

    Some(format!("/{}", parts.join("/")))
}

pub(super) fn validate_remote_path(
    args: &serde_json::Value,
    path_key: &str,
    tool_name: &str,
) -> AppResult<()> {
    let remote_work_dir = require_remote_work_dir(args, tool_name)?;
    let remote_path = args
        .get(path_key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::InvalidInput(format!("Missing '{}' argument", path_key)))?;

    let normalized_root = normalize_remote_path(&remote_work_dir, "/")
        .ok_or_else(|| AppError::SecurityError("Invalid remoteWorkDir/root".to_string()))?;
    let normalized_path = normalize_remote_path(remote_path, &normalized_root)
        .ok_or_else(|| AppError::SecurityError(format!("Invalid remote path for {}", tool_name)))?;

    // AUDIT-FIX [fix-3#1] — Use the shared `is_within_dir` helper so the
    // sibling-prefix escape (e.g. `/remote/proj2` slipping past
    // `/remote/proj`) is closed. `normalized_root` may or may not have a
    // trailing slash; `is_within_dir` enforces a boundary either way.
    if !crate::commands::path_security::is_within_dir(
        std::path::Path::new(&normalized_path),
        std::path::Path::new(&normalized_root),
    ) {
        return Err(AppError::SecurityError(format!(
            "Tool '{}' cannot access '{}' outside remote root '{}'.",
            tool_name, normalized_path, normalized_root
        )));
    }

    Ok(())
}
