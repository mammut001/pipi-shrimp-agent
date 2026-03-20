/**
 * Workspace commands
 *
 * Handles work directory management for projects:
 * - Opening a native folder picker dialog
 * - Initializing the .pipi-shrimp output directory
 * - Computing the next dated output folder (e.g. 2025-01-15-2)
 * - Listing the index of all previously generated output folders
 */

use crate::utils::{AppResult, AppError};
use std::fs;
use std::path::PathBuf;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

/// Summary of one dated output folder inside .pipi-shrimp/
#[derive(Debug, Serialize, Deserialize)]
pub struct OutputFolder {
    /// Folder name, e.g. "2025-01-15-2"
    pub name: String,
    /// Absolute path to the folder
    pub path: String,
    /// List of file names inside this folder
    pub files: Vec<String>,
}

/// Open the native OS folder-picker dialog.
/// Returns the selected absolute path, or None if the user cancelled.
///
/// 使用 async + oneshot channel 避免在主线程上 blocking 导致的卡死问题。
#[tauri::command]
pub async fn open_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    // FileDialogBuilder (非 blocking 版本) 在主线程上展示对话框，通过 callback 返回结果
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });

    rx.await.ok().flatten()
        .map(|p| p.to_string())
}

/// Initialise the `.pipi-shrimp/` directory inside `work_dir`.
///
/// Steps:
/// 1. Create `{work_dir}/.pipi-shrimp/` (if it doesn't exist)
/// 2. If `{work_dir}/.git/` exists → append `.pipi-shrimp/` to `{work_dir}/.gitignore`
///    (only if the line isn't already present)
///
/// Returns the absolute path to `.pipi-shrimp/` as a String.
#[tauri::command]
pub fn init_pipi_shrimp(work_dir: String) -> AppResult<String> {
    let base = PathBuf::from(&work_dir);
    if !base.exists() {
        return Err(AppError::FileError(format!("Work dir does not exist: {}", work_dir)));
    }

    // 1. Create .pipi-shrimp/
    let pipi_dir = base.join(".pipi-shrimp");
    fs::create_dir_all(&pipi_dir)
        .map_err(|e| AppError::FileError(format!("Failed to create .pipi-shrimp: {}", e)))?;

    // 2. Update .gitignore if this is a git repo
    let git_dir = base.join(".git");
    if git_dir.exists() {
        let gitignore_path = base.join(".gitignore");
        let entry = ".pipi-shrimp/\n";

        let existing = if gitignore_path.exists() {
            fs::read_to_string(&gitignore_path)
                .map_err(|e| AppError::FileError(e.to_string()))?
        } else {
            String::new()
        };

        // Only append if not already present
        if !existing.contains(".pipi-shrimp/") {
            let mut content = existing;
            if !content.ends_with('\n') && !content.is_empty() {
                content.push('\n');
            }
            content.push_str(entry);
            fs::write(&gitignore_path, content)
                .map_err(|e| AppError::FileError(e.to_string()))?;
            println!("Added .pipi-shrimp/ to .gitignore");
        }
    }

    Ok(pipi_dir.to_string_lossy().to_string())
}

/// Return the path for the **next** output folder for today.
///
/// Format: `{work_dir}/.pipi-shrimp/{YYYY-MM-DD}-{i}`
///
/// `i` is determined by scanning existing folders:
/// - If today has no folder yet → returns `...-1`
/// - If today already has `...-1` and `...-2` → returns `...-3`
///
/// The folder is **not** created by this call — only the path is returned.
/// The caller (frontend) creates it when it actually writes the first file.
#[tauri::command]
pub fn get_next_output_dir(work_dir: String) -> AppResult<String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let pipi_dir = PathBuf::from(&work_dir).join(".pipi-shrimp");

    // Ensure .pipi-shrimp exists (idempotent)
    fs::create_dir_all(&pipi_dir)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    // Find highest existing index for today
    let mut max_i: u32 = 0;
    if let Ok(entries) = fs::read_dir(&pipi_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Match pattern: {today}-{number}
            if let Some(suffix) = name.strip_prefix(&format!("{}-", today)) {
                if let Ok(n) = suffix.parse::<u32>() {
                    if n > max_i {
                        max_i = n;
                    }
                }
            }
        }
    }

    let next_name = format!("{}-{}", today, max_i + 1);
    let next_path = pipi_dir.join(&next_name);
    Ok(next_path.to_string_lossy().to_string())
}

/// List all output folders inside `{work_dir}/.pipi-shrimp/`,
/// sorted newest first.
///
/// Returns a Vec of OutputFolder, each with the folder name, path, and
/// a list of file names it contains.
#[tauri::command]
pub fn list_pipi_shrimp_index(work_dir: String) -> AppResult<Vec<OutputFolder>> {
    let pipi_dir = PathBuf::from(&work_dir).join(".pipi-shrimp");

    if !pipi_dir.exists() {
        return Ok(vec![]);
    }

    let mut folders: Vec<OutputFolder> = Vec::new();

    if let Ok(entries) = fs::read_dir(&pipi_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let mut files = Vec::new();

                if let Ok(file_entries) = fs::read_dir(&path) {
                    for file_entry in file_entries.flatten() {
                        if file_entry.path().is_file() {
                            files.push(file_entry.file_name().to_string_lossy().to_string());
                        }
                    }
                }
                files.sort();

                folders.push(OutputFolder {
                    name,
                    path: path.to_string_lossy().to_string(),
                    files,
                });
            }
        }
    }

    // Sort newest first (name is YYYY-MM-DD-i, lexicographic desc works)
    folders.sort_by(|a, b| b.name.cmp(&a.name));

    Ok(folders)
}
