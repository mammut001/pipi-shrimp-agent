/**
 * File operation commands
 *
 * Handles reading, writing, and file system operations
 */

use crate::models::FileResponse;
use crate::utils::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

/// Allowed root directories for file operations (path sandbox)
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home));
    }
    // Also allow /tmp for temporary file operations
    roots.push(PathBuf::from("/tmp"));
    roots
}

/**
 * Expand ~ to home directory and validate path is within sandbox
 *
 * Converts paths like "~/Desktop" to "/Users/username/Desktop"
 * and ensures the resolved path is inside an allowed root directory.
 * This prevents path traversal attacks like "../../../etc/passwd".
 */
fn expand_home(path: &str) -> PathBuf {
    if path.starts_with("~") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}

fn resolve_existing_ancestor(path: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let mut ancestor = path;
    let mut suffix: Vec<PathBuf> = Vec::new();

    while !ancestor.exists() {
        let name = ancestor.file_name().ok_or_else(|| {
            AppError::FileError(format!("Cannot resolve path '{}': no existing parent", path.display()))
        })?;
        suffix.push(PathBuf::from(name));
        ancestor = ancestor.parent().ok_or_else(|| {
            AppError::FileError(format!("Cannot resolve path '{}': no existing parent", path.display()))
        })?;
    }

    let mut canonical = ancestor.canonicalize()
        .map_err(|e| AppError::FileError(format!("Cannot resolve path '{}': {}", path.display(), e)))?;

    for part in suffix.iter().rev() {
        canonical.push(part);
    }

    Ok((canonical, ancestor.to_path_buf()))
}

fn validate_in_scope(canonical: &Path, scope_root: Option<&Path>, original_path: &str) -> AppResult<()> {
    if let Some(root) = scope_root {
        if !canonical.starts_with(root) {
            return Err(AppError::FileError(format!(
                "Access denied: path '{}' is outside the bound work directory '{}'",
                original_path,
                root.display()
            )));
        }
        return Ok(());
    }

    let roots = allowed_roots();
    let is_allowed = roots.iter().any(|root| canonical.starts_with(root));
    if !is_allowed {
        return Err(AppError::FileError(format!(
            "Access denied: path '{}' is outside allowed directories (HOME, /tmp)",
            original_path
        )));
    }
    Ok(())
}

pub fn resolve_path(path: &str, work_dir: Option<&str>) -> AppResult<PathBuf> {
    let scope_root = match work_dir {
        Some(dir) => Some(
            expand_home(dir)
                .canonicalize()
                .map_err(|e| AppError::FileError(format!("Cannot resolve work directory '{}': {}", dir, e)))?
        ),
        None => None,
    };

    let expanded = expand_home(path);
    let candidate = if expanded.is_absolute() {
        expanded
    } else if let Some(root) = scope_root.as_ref() {
        root.join(expanded)
    } else {
        expanded
    };

    let (canonical, _) = resolve_existing_ancestor(&candidate)?;
    validate_in_scope(&canonical, scope_root.as_deref(), path)?;
    Ok(canonical)
}

/**
 * Read a file from the filesystem
 *
 * Returns the file content and path
 */
#[tauri::command]
pub async fn read_file(path: String, work_dir: Option<String>) -> AppResult<FileResponse> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    let content = fs::read_to_string(&expanded_path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok(FileResponse {
        content,
        path: expanded_path.to_string_lossy().to_string(),
    })
}

/**
 * Write content to a file
 *
 * Creates the file if it doesn't exist, overwrites if it does
 */
#[tauri::command]
pub async fn write_file(path: String, content: String, work_dir: Option<String>) -> AppResult<String> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    fs::write(&expanded_path, &content)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok("File written successfully".to_string())
}

/**
 * Check if a file or directory exists
 */
#[tauri::command]
pub async fn path_exists(path: String, work_dir: Option<String>) -> AppResult<bool> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    Ok(expanded_path.exists())
}

/**
 * Create a new directory
 */
#[tauri::command]
pub async fn create_directory(path: String, work_dir: Option<String>) -> AppResult<String> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    fs::create_dir_all(&expanded_path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok("Directory created successfully".to_string())
}

/**
 * List files in a directory
 */
#[tauri::command]
pub async fn list_files(
    path: String,
    pattern: Option<String>,
    work_dir: Option<String>,
) -> AppResult<Vec<FileInfo>> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;

    if !expanded_path.exists() {
        return Err(AppError::FileError(format!("Path does not exist: {}", path)));
    }

    if !expanded_path.is_dir() {
        return Err(AppError::FileError(format!("Path is not a directory: {}", path)));
    }

    let mut files = Vec::new();

    match pattern {
        Some(glob_pattern) => {
            // Use glob pattern
            let expanded_path_str = expanded_path.to_string_lossy().to_string();
            let full_pattern = if glob_pattern.contains('/') {
                format!("{}/{}", expanded_path_str, glob_pattern)
            } else {
                format!("{}/*", expanded_path_str)
            };

            for entry in glob::glob(&full_pattern)
                .map_err(|e| AppError::FileError(e.to_string()))?
            {
                if let Ok(path_buf) = entry {
                    if let Some(file_name) = path_buf.file_name() {
                        files.push(FileInfo {
                            name: file_name.to_string_lossy().to_string(),
                            path: path_buf.to_string_lossy().to_string(),
                            is_directory: path_buf.is_dir(),
                        });
                    }
                }
            }
        }
        None => {
            // List all entries in directory
            for entry in fs::read_dir(&expanded_path)
                .map_err(|e| AppError::FileError(e.to_string()))?
            {
                if let Ok(entry) = entry {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let file_path = entry.path();
                    files.push(FileInfo {
                        name: file_name,
                        path: file_path.to_string_lossy().to_string(),
                        is_directory: file_path.is_dir(),
                    });
                }
            }
        }
    }

    // Sort: directories first, then files, alphabetically
    files.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(files)
}

/// File information returned by list_files
#[derive(serde::Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

/// Workspace information returned by get_workspace_info
#[derive(serde::Serialize)]
pub struct WorkspaceInfo {
    pub work_dir: String,
    pub files: Vec<FileInfo>,
    pub subdirs: Vec<FileInfo>,
    pub total_files: usize,
    pub total_dirs: usize,
}

/// Get workspace information including all files and subdirectories
/// in the specified working directory
#[tauri::command]
pub async fn get_workspace_info(path: String, work_dir: Option<String>) -> AppResult<WorkspaceInfo> {
    let expanded_path = resolve_path(&path, work_dir.as_deref())?;

    if !expanded_path.exists() {
        return Err(AppError::FileError(format!("Path does not exist: {}", path)));
    }

    if !expanded_path.is_dir() {
        return Err(AppError::FileError(format!("Path is not a directory: {}", path)));
    }

    let mut files = Vec::new();
    let mut subdirs = Vec::new();

    let entries = fs::read_dir(&expanded_path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path();
        let is_dir = file_path.is_dir();

        let file_info = FileInfo {
            name: file_name,
            path: file_path.to_string_lossy().to_string(),
            is_directory: is_dir,
        };

        if is_dir {
            // Skip hidden directories like .git, .pipi-shrimp
            if !file_info.name.starts_with('.') {
                subdirs.push(file_info);
            }
        } else {
            files.push(file_info);
        }
    }

    // Sort: alphabetically, case-insensitive
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    subdirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let total_files = files.len();
    let total_dirs = subdirs.len();

    Ok(WorkspaceInfo {
        work_dir: expanded_path.to_string_lossy().to_string(),
        files,
        subdirs,
        total_files,
        total_dirs,
    })
}
