use crate::commands::file::resolve_path;
use crate::tools::shell_profile::{convert_windows_path_to_wsl, detect_path_kind, ShellPathKind};
use crate::utils::{AppError, AppResult};

pub(super) fn resolve_command_cwd(cwd: Option<String>, work_dir: Option<&str>) -> AppResult<String> {
    let base = cwd.unwrap_or_else(|| ".".to_string());
    if cfg!(target_os = "windows") {
        let base_kind = detect_path_kind(Some(base.as_str()));
        let work_dir_kind = detect_path_kind(work_dir);
        if base_kind == ShellPathKind::Wsl || work_dir_kind == ShellPathKind::Wsl {
            return resolve_windows_command_cwd(base.as_str(), work_dir);
        }
    }
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

fn resolve_windows_command_cwd(cwd: &str, work_dir: Option<&str>) -> AppResult<String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err(AppError::ProcessError(
            "Working directory cannot be empty".to_string(),
        ));
    }

    if cwd == "." {
        return work_dir
            .map(normalize_wsl_style_path)
            .transpose()?
            .ok_or_else(|| {
                AppError::ProcessError("Relative working directory requires work_dir".to_string())
            });
    }

    match detect_path_kind(Some(cwd)) {
        ShellPathKind::Wsl => return normalize_wsl_style_path(cwd),
        ShellPathKind::Windows => return Ok(cwd.to_string()),
        ShellPathKind::Unknown => {}
    }

    match work_dir {
        Some(root) if detect_path_kind(Some(root)) == ShellPathKind::Wsl => {
            let root = normalize_wsl_style_path(root)?;
            return Ok(join_wsl_paths(root.as_str(), cwd));
        }
        _ => {}
    }

    let resolved = resolve_path(cwd, work_dir)?;
    Ok(resolved.to_string_lossy().to_string())
}

fn normalize_wsl_style_path(path: &str) -> AppResult<String> {
    convert_windows_path_to_wsl(path).ok_or_else(|| {
        AppError::ProcessError(format!(
            "Unable to normalize WSL working directory '{}'",
            path
        ))
    })
}

fn join_wsl_paths(root: &str, child: &str) -> String {
    let trimmed_root = root.trim_end_matches('/');
    let normalized_child = child.replace('\\', "/");
    let trimmed_child = normalized_child
        .trim_start_matches("./")
        .trim_start_matches('/');
    if trimmed_child.is_empty() {
        trimmed_root.to_string()
    } else if trimmed_root.is_empty() {
        format!("/{}", trimmed_child)
    } else {
        format!("{}/{}", trimmed_root, trimmed_child)
    }
}
