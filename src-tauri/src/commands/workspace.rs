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

    // 1.5 Generate core memory template if it doesn't exist
    let core_md_path = pipi_dir.join("core.md");
    let core_md_is_new = !core_md_path.exists();
    if core_md_is_new {
        let template = r#"# 🦐 PiPi Shrimp Project Core Memory
> Maintained by PiPi Shrimp Agent. Records project context, architecture, and AI behavior rules.
> Auto-populated on first bind. Update freely — AI will read this every message.

## 📌 Project Overview
[Auto-detected on bind — see below]

## 🛠 Tech Stack
[Auto-detected on bind — see below]

## 📖 Architecture & Structure
[Not recorded yet]

## ⚙️ Key Commands
- Start: `npm run dev`
- Build: `npm run build`

## 📝 AI Behavior Rules
- Before modifying any file, create a checkpoint commit: `git add -A && git commit -m "checkpoint: before [description]"`
- After completing changes, commit: `git add -A && git commit -m "fix/feat: [description]"`
- New features must be developed on a separate branch: `git checkout -b feat/[name]`
- Inform the user when a feature is ready — wait for confirmation before merging to main
- Prefer editing existing files over creating new ones
- Do not add features, error handling, or abstractions beyond what was asked
- Only add comments where logic is non-obvious

## 🧠 Project Memory
[AI will append persistent facts here as the project evolves]
"#;
        let _ = fs::write(&core_md_path, template);
    }

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

    // Return pipi_dir path + whether core.md was freshly created
    // Format: "path|new" or "path|exists" — frontend uses this to trigger auto-scan
    let suffix = if core_md_is_new { "new" } else { "exists" };
    Ok(format!("{}|{}", pipi_dir.to_string_lossy(), suffix))
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

/// Create a workflow run directory at {HOME}/pipi-shrimp-agent/workflows/{run_id}.
/// This is used by the workflow engine to create isolated workspaces per run.
#[tauri::command]
pub fn create_workflow_run_directory(run_id: String) -> AppResult<String> {
    let home = std::env::var("HOME")
        .map_err(|e| AppError::FileError(format!("Cannot get HOME directory: {}", e)))?;
    let base_dir = PathBuf::from(&home).join("pipi-shrimp-agent").join("workflows").join(&run_id);
    fs::create_dir_all(&base_dir)
        .map_err(|e| AppError::FileError(format!("Failed to create run directory: {}", e)))?;
    Ok(base_dir.to_string_lossy().to_string())
}

/// Delete a workflow run directory previously created under
/// {HOME}/pipi-shrimp-agent/workflows/{run_id}.
///
/// For safety, only deletes directories inside the managed workflows root.
#[tauri::command]
pub fn delete_workflow_run_directory(path: String) -> AppResult<()> {
    let home = std::env::var("HOME")
        .map_err(|e| AppError::FileError(format!("Cannot get HOME directory: {}", e)))?;
    let workflows_root = PathBuf::from(&home)
        .join("pipi-shrimp-agent")
        .join("workflows");

    let target = PathBuf::from(&path);
    if !target.exists() {
        return Ok(());
    }

    let canonical_target = target
        .canonicalize()
        .map_err(|e| AppError::FileError(format!("Failed to resolve workflow run directory: {}", e)))?;

    let canonical_root = workflows_root
        .canonicalize()
        .unwrap_or(workflows_root);

    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::FileError(format!(
            "Refusing to delete directory outside managed workflow root: {}",
            canonical_target.to_string_lossy()
        )));
    }

    fs::remove_dir_all(&canonical_target)
        .map_err(|e| AppError::FileError(format!("Failed to delete run directory: {}", e)))?;

    Ok(())
}

/// Reveal a path in the system file explorer (Finder on macOS, Explorer on Windows, etc.)
#[tauri::command]
pub fn reveal_in_finder(path: String) -> AppResult<()> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(AppError::FileError(format!("Path does not exist: {}", path)));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| AppError::FileError(format!("Failed to open Finder: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open first, fallback to dbus-send for file managers
        let result = std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn();

        if result.is_err() {
            std::process::Command::new("dbus-send")
                .args(["--session", "--dest=org.freedesktop.FileManager1", "--type=method_call",
                    "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
                    format!("array:string:file://{}", path).as_str()])
                .spawn()
                .map_err(|e| AppError::FileError(format!("Failed to open file manager: {}", e)))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| AppError::FileError(format!("Failed to open Explorer: {}", e)))?;
    }

    Ok(())
}

/// Open a file with the system's default application
#[tauri::command]
pub fn open_file_external(path: String) -> AppResult<()> {
    open::that(&path)
        .map_err(|e| AppError::FileError(format!("Failed to open file: {}", e)))?;
    Ok(())
}

/// Open a file with a specific application (macOS only)
#[tauri::command]
pub fn open_file_with_app(path: String, app_name: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", &app_name, &path])
            .spawn()
            .map_err(|e| AppError::FileError(format!("Failed to open with app: {}", e)))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        return Err(AppError::FileError("open_file_with_app is only supported on macOS".to_string()));
    }

    Ok(())
}

/// Return a per-session default output directory under `~/Documents/PiPi-Shrimp/chats/{session_id}/`.
///
/// Each chat session gets its own isolated subfolder so files from different
/// conversations never mix. The directory is created if it doesn't exist yet.
///
/// On every platform this resolves to the user's Documents folder (or HOME if
/// Documents is unavailable), so generated files are easy to find.
#[tauri::command]
pub fn get_app_default_dir(session_id: String) -> AppResult<String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::FileError("Cannot determine Documents directory".to_string()))?
        .join("PiPi-Shrimp")
        .join("chats")
        .join(&session_id);

    fs::create_dir_all(&base)
        .map_err(|e| AppError::FileError(format!("Failed to create default dir: {}", e)))?;

    Ok(base.to_string_lossy().to_string())
}
