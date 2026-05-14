/// Resolve the project root: during `tauri dev` cwd is `src-tauri/`,
/// so we walk up one level if the cwd ends with "src-tauri".
fn project_root() -> std::path::PathBuf {
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
        cwd.parent().unwrap_or(&cwd).to_path_buf()
    } else {
        cwd
    }
}

/// Return the resolved project root used by project-relative helpers.
#[tauri::command]
pub fn get_project_root() -> Result<String, String> {
    Ok(project_root().to_string_lossy().to_string())
}

/// Read a file relative to a base directory (or project root if None).
#[tauri::command]
pub fn read_project_file(relative_path: String, base_dir: Option<String>) -> Result<String, String> {
    let root = match base_dir {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => project_root(),
    };
    let full = root.join(&relative_path);
    std::fs::read_to_string(&full).map_err(|e| format!("Cannot read '{}': {}", full.display(), e))
}

/// Write a file relative to a base directory (or project root if None).
#[tauri::command]
pub fn write_project_file(
    relative_path: String,
    content: String,
    base_dir: Option<String>,
) -> Result<(), String> {
    let root = match base_dir {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => project_root(),
    };
    let full = root.join(&relative_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {}", e))?;
    }
    std::fs::write(&full, content).map_err(|e| format!("Cannot write '{}': {}", full.display(), e))
}
