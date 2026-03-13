/**
 * File operation commands
 *
 * Handles reading, writing, and file system operations
 */

use crate::models::FileResponse;
use crate::utils::{AppError, AppResult};
use std::fs;

/**
 * Read a file from the filesystem
 *
 * Returns the file content and path
 */
#[tauri::command]
pub async fn read_file(path: String) -> AppResult<FileResponse> {
    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok(FileResponse {
        content,
        path,
    })
}

/**
 * Write content to a file
 *
 * Creates the file if it doesn't exist, overwrites if it does
 */
#[tauri::command]
pub async fn write_file(path: String, content: String) -> AppResult<String> {
    fs::write(&path, &content)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok("File written successfully".to_string())
}

/**
 * Check if a file or directory exists
 */
#[tauri::command]
pub async fn path_exists(path: String) -> AppResult<bool> {
    Ok(std::path::Path::new(&path).exists())
}

/**
 * Create a new directory
 */
#[tauri::command]
pub async fn create_directory(path: String) -> AppResult<String> {
    fs::create_dir_all(&path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    Ok("Directory created successfully".to_string())
}
