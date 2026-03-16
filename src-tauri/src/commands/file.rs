/**
 * File operation commands
 *
 * Handles reading, writing, and file system operations
 */

use crate::models::FileResponse;
use crate::utils::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

/**
 * Expand ~ to home directory
 *
 * Converts paths like "~/Desktop" to "/Users/username/Desktop"
 */
fn expand_path(path: &str) -> PathBuf {
    if path.starts_with("~") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}

/**
 * Read a file from the filesystem
 *
 * Returns the file content and path
 */
#[tauri::command]
pub async fn read_file(path: String) -> AppResult<FileResponse> {
    let expanded_path = expand_path(&path);
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
pub async fn write_file(path: String, content: String) -> AppResult<String> {
    let expanded_path = expand_path(&path);
    fs::write(&expanded_path, &content)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok("File written successfully".to_string())
}

/**
 * Check if a file or directory exists
 */
#[tauri::command]
pub async fn path_exists(path: String) -> AppResult<bool> {
    let expanded_path = expand_path(&path);
    Ok(expanded_path.exists())
}

/**
 * Create a new directory
 */
#[tauri::command]
pub async fn create_directory(path: String) -> AppResult<String> {
    let expanded_path = expand_path(&path);
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
) -> AppResult<Vec<FileInfo>> {
    let expanded_path = expand_path(&path);

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
