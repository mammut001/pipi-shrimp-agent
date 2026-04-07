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
 * Read a binary file and return as base64
 *
 * Used for images and other binary content
 */
#[tauri::command]
pub async fn read_binary_file(path: String, work_dir: Option<String>) -> AppResult<FileResponse> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    let expanded_path = resolve_path(&path, work_dir.as_deref())?;
    let bytes = fs::read(&expanded_path)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    let base64_content = BASE64.encode(&bytes);

    Ok(FileResponse {
        content: base64_content,
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

/// A single memory file entry, returned by scan_memory_files.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct MemoryFileMeta {
    pub filename: String,
    pub path: String,
    pub preview: String,
}

/**
 * Scan a memory directory and return all .md files (excluding MEMORY.md).
 *
 * Returns a list of MemoryFileMeta with filename, path, and a ~300-char
 * preview of each file's content (after frontmatter).
 */
#[tauri::command]
pub async fn scan_memory_files(memory_dir: String) -> AppResult<Vec<MemoryFileMeta>> {
    let base = expand_home(&memory_dir);

    // Enforce sandbox: only allow paths within HOME or /tmp
    let (canonical_base, _) = resolve_existing_ancestor(&base).unwrap_or_else(|_| (base.clone(), base.clone()));
    validate_in_scope(&canonical_base, None, &memory_dir)?;

    if !canonical_base.exists() {
        return Ok(Vec::new());
    }

    let mut results: Vec<MemoryFileMeta> = Vec::new();

    for entry in fs::read_dir(&canonical_base).map_err(|e| AppError::FileError(e.to_string()))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.ends_with(".md") || file_name == "MEMORY.md" {
            continue;
        }

        let file_path = entry.path();
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Strip frontmatter (--- ... ---) for preview
        let body = if content.starts_with("---") {
            match content[3..].find("\n---") {
                Some(end) => content[3 + end + 4..].trim_start().to_string(),
                None => content.clone(),
            }
        } else {
            content.clone()
        };

        let preview: String = body.chars().take(300).collect();

        results.push(MemoryFileMeta {
            filename: file_name,
            path: file_path.to_string_lossy().to_string(),
            preview,
        });
    }

    // Sort by filename for deterministic ordering
    results.sort_by(|a, b| a.filename.cmp(&b.filename));

    Ok(results)
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
                        let metadata = path_buf.metadata().ok();
                        let modified = metadata.as_ref()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        files.push(FileInfo {
                            name: file_name.to_string_lossy().to_string(),
                            path: path_buf.to_string_lossy().to_string(),
                            is_directory: path_buf.is_dir(),
                            size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                            modified,
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
                    let metadata = entry.metadata().ok();
                    let modified = metadata.as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    files.push(FileInfo {
                        name: file_name,
                        path: file_path.to_string_lossy().to_string(),
                        is_directory: file_path.is_dir(),
                        size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                        modified,
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
    pub size: u64,
    pub modified: u64,
}

/// Workspace information returned by get_workspace_info
#[allow(dead_code)]
#[derive(serde::Serialize)]
pub struct WorkspaceInfo {
    pub work_dir: String,
    pub files: Vec<FileInfo>,
    pub subdirs: Vec<FileInfo>,
    pub total_files: usize,
    pub total_dirs: usize,
}

/// Project fingerprint - analysis result for AI auto-onboarding
#[derive(serde::Serialize)]
pub struct ProjectFingerprint {
    pub name: String,
    pub description: String,
    pub tech_stack: Vec<String>,
    pub key_files: Vec<FileInfo>,
    pub structure_summary: String,
    pub language_stats: std::collections::HashMap<String, usize>,
}

/// Analyze a project folder and generate a fingerprint for AI auto-onboarding
#[tauri::command]
pub async fn analyze_project_structure(work_dir: String) -> AppResult<ProjectFingerprint> {
    use std::collections::HashMap;

    let base = std::path::PathBuf::from(&work_dir);
    if !base.exists() {
        return Err(AppError::FileError(format!("Work dir does not exist: {}", work_dir)));
    }

    let mut tech_stack = Vec::new();
    let mut key_files = Vec::new();
    let mut language_stats: HashMap<String, usize> = HashMap::new();
    let mut structure_summary_parts = Vec::new();

    // Key files to detect tech stack
    let key_file_patterns = vec![
        ("package.json", "Node.js"),
        ("Cargo.toml", "Rust"),
        ("go.mod", "Go"),
        ("requirements.txt", "Python"),
        ("pyproject.toml", "Python"),
        ("pom.xml", "Java"),
        ("build.gradle", "Java/Kotlin"),
        ("Gemfile", "Ruby"),
        ("composer.json", "PHP"),
        ("Cargo.lock", "Rust"),
        ("yarn.lock", "Node.js"),
        ("pnpm-lock.yaml", "Node.js"),
        ("package-lock.json", "Node.js"),
        ("tsconfig.json", "TypeScript"),
        ("vite.config.ts", "Vite"),
        ("webpack.config.js", "Webpack"),
        ("next.config.js", "Next.js"),
        ("Cargo.toml", "Tauri"),
        ("tauri.conf.json", "Tauri"),
        ("tauri.conf.toml", "Tauri"),
    ];

    // Detect tech stack from key files
    let entries = fs::read_dir(&base)
        .map_err(|e| AppError::FileError(e.to_string()))?;

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path();

        // Skip hidden files and common ignore patterns
        if file_name.starts_with('.') {
            continue;
        }

        // Check for key files
        for (pattern, tech) in &key_file_patterns {
            if file_name == *pattern {
                tech_stack.push(tech.to_string());
                let meta = file_path.metadata().ok();
                let modified = meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                key_files.push(FileInfo {
                    name: file_name.clone(),
                    path: file_path.to_string_lossy().to_string(),
                    is_directory: false,
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified,
                });
            }
        }

        // Count file extensions for language stats
        if let Some(ext) = file_path.extension() {
            let ext_str = ext.to_string_lossy().to_string().to_lowercase();
            if !ext_str.is_empty() && ext_str.len() <= 5 {
                *language_stats.entry(ext_str).or_insert(0) += 1;
            }
        }
    }

    // Build tech stack description
    if !tech_stack.is_empty() {
        structure_summary_parts.push(format!("Tech stack: {}", tech_stack.join(", ")));
    }

    // Detect project type from structure
    let subdirs: Vec<_> = fs::read_dir(&base)
        .map_err(|e| AppError::FileError(e.to_string()))?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    if subdirs.contains(&"src".to_string()) {
        structure_summary_parts.push("Source code in 'src/' directory".to_string());
    }
    if subdirs.contains(&"src-tauri".to_string()) {
        structure_summary_parts.push("Tauri application with Rust backend".to_string());
    }
    if subdirs.contains(&"public".to_string()) || subdirs.contains(&"static".to_string()) {
        structure_summary_parts.push("Has static assets".to_string());
    }
    if subdirs.contains(&"docs".to_string()) {
        structure_summary_parts.push("Documentation directory present".to_string());
    }
    if subdirs.contains(&"tests".to_string()) || subdirs.contains(&"test".to_string()) {
        structure_summary_parts.push("Test directory present".to_string());
    }
    if subdirs.contains(&"node_modules".to_string()) {
        structure_summary_parts.push("Node.js dependencies installed".to_string());
    }
    if subdirs.contains(&"target".to_string()) {
        structure_summary_parts.push("Rust build artifacts present".to_string());
    }

    // Read README if exists
    let mut description = String::new();
    for readme_name in ["README.md", "README.txt", "README"] {
        let readme_path = base.join(readme_name);
        if readme_path.exists() {
            if let Ok(content) = fs::read_to_string(&readme_path) {
                // Get first 500 chars as description
                let first_lines: String = content.lines()
                    .take(10)
                    .collect::<Vec<_>>()
                    .join(" ");
                description = first_lines.chars().take(500).collect();
                let meta = readme_path.metadata().ok();
                let modified = meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                key_files.push(FileInfo {
                    name: readme_name.to_string(),
                    path: readme_path.to_string_lossy().to_string(),
                    is_directory: false,
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified,
                });
                break;
            }
        }
    }

    // Project name from directory
    let name = base.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown Project".to_string());

    Ok(ProjectFingerprint {
        name,
        description,
        tech_stack,
        key_files,
        structure_summary: structure_summary_parts.join("; "),
        language_stats,
    })
}

/// Get workspace information including all files and subdirectories
/// in the specified working directory
#[allow(dead_code)]
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

        let meta = file_path.metadata().ok();
        let modified = meta.as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let file_info = FileInfo {
            name: file_name,
            path: file_path.to_string_lossy().to_string(),
            is_directory: is_dir,
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified,
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
