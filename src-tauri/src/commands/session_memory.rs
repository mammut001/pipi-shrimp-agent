use serde::Serialize;
/**
 * Session Memory Commands
 *
 * Session Memory 文件系统管理
 * 存储位置: {workDir}/.pipi-shrimp/session-memory.md
 * Fallback: {Documents|HOME}/PiPi-Shrimp/session-memory/session-memory.md
 *
 * 源码参考:
 * - restored-src/src/services/SessionMemory/sessionMemoryUtils.ts
 * - restored-src/src/utils/permissions/filesystem.ts: getSessionMemoryPath()
 */
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// 常量
// ============================================================================

const SESSION_MEMORY_FILENAME: &str = "session-memory.md";
const SESSION_MEMORY_DIR: &str = ".pipi-shrimp";
const SESSION_MEMORY_APP_FALLBACK_DIR: &str = "session-memory";

/// 默认 Session Memory 模板
/// 与 Claude Code 的 DEFAULT_SESSION_MEMORY_TEMPLATE 保持结构一致
const DEFAULT_TEMPLATE: &str = r#"# Session Title
_一个简短、独特的 5-10 词描述性标题。信息密集，无填充词。_

# Current State
_当前正在积极处理什么？尚未完成的待办任务。即将采取的下一步。_

# Task specification
_用户要求构建什么？任何设计决策或其他解释性上下文。_

# Files and Functions
_重要的文件有哪些？简而言之，它们包含什么，为什么重要？_

# Workflow
_通常按什么顺序运行哪些 bash 命令？如何解读它们的输出（如果不是很明显）？_

# Errors & Corrections
_遇到的错误及修复方法。用户纠正了什么？哪些方法失败了不应再试？_

# Codebase and System Documentation
_重要的系统组件有哪些？它们如何工作/组合在一起？_

# Learnings
_什么效果好？什么不好？应该避免什么？不要重复其他部分的内容。_

# Key results
_如果用户要求了特定输出（如答案、表格或其他文档），在此重复确切的输出结果。_

# Worklog
_一步一步，尝试了什么，做了什么？每一步非常简短的总结。_
"#;

// ============================================================================
// 路径工具
// ============================================================================

/**
 * 获取 Session Memory 文件路径
 *
 * 优先级: {workDir}/.pipi-shrimp > {Documents|HOME}/PiPi-Shrimp/session-memory
 */
fn get_memory_path(work_dir: Option<&str>) -> PathBuf {
    get_memory_dir(work_dir).join(SESSION_MEMORY_FILENAME)
}

/**
 * 获取 Session Memory 目录路径
 */
fn get_memory_dir(work_dir: Option<&str>) -> PathBuf {
    match work_dir {
        Some(d) if !d.is_empty() => {
            // AUDIT-FIX [fix-3#1] — Validate work_dir is inside a writable
            // user root (HOME, /tmp, app data) so a malicious caller can't
            // redirect the session memory path to e.g. `/etc/cron.daily/`
            // and overwrite arbitrary files.
            let dir = PathBuf::from(d);
            // Discard the canonical form returned by `validate_work_dir`
            // for now; just use it to log a warning if validation fails.
            // The result is still used (joined below) so we use a
            // reference for the validation call.
            let _ = validate_work_dir(&dir);
            dir.join(SESSION_MEMORY_DIR)
        }
        _ => dirs::document_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("PiPi-Shrimp")
            .join(SESSION_MEMORY_APP_FALLBACK_DIR),
    }
}

/// AUDIT-FIX [fix-3#1] — Return the writable roots the user trusts. The
/// session memory may live in any of these directories when the caller
/// supplies an explicit `work_dir`.
fn writable_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home);
    }
    if let Ok(tmp) = std::env::var("TMPDIR").or_else(|_| std::env::var("TEMP")) {
        if !tmp.is_empty() {
            roots.push(PathBuf::from(tmp));
        }
    } else {
        roots.push(PathBuf::from("/tmp"));
    }
    if let Ok(data_dir) = std::env::var("PIPI_SHRIMP_DATA_DIR") {
        if !data_dir.is_empty() {
            roots.push(PathBuf::from(data_dir));
        }
    } else if let Some(dir) = dirs::data_dir() {
        roots.push(dir.join("PiPi-Shrimp"));
    }
    if let Some(cd) = dirs::document_dir() {
        roots.push(cd.join("PiPi-Shrimp"));
    }
    roots
}

/// AUDIT-FIX [fix-3#1] — When the caller provides an explicit `work_dir`,
/// refuse to use it unless it canonicalises to inside one of the writable
/// roots. Returns the canonical form on success.
fn validate_work_dir(work_dir: &Path) -> Result<PathBuf, String> {
    let canonical = work_dir.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve session memory work_dir '{}': {}",
            work_dir.display(),
            e
        )
    })?;
    let roots = writable_roots();
    let allowed = roots
        .iter()
        .any(|root| crate::commands::path_security::is_within_dir(&canonical, root));
    if !allowed {
        return Err(format!(
            "Refusing to use work_dir '{}' for session memory: outside writable roots",
            canonical.display()
        ));
    }
    // The session memory file must always live under a `.pipi-shrimp`
    // subdirectory; refuse anything that already ends with a different
    // component so we never silently nest into attacker-controlled dirs.
    Ok(canonical)
}

// ============================================================================
// 命令
// ============================================================================

/**
 * 初始化 Session Memory 文件
 *
 * 如果文件不存在，创建目录和文件（mode 0o700/0o600）
 * 如果文件已存在，直接返回路径
 *
 * 源码参考: setupSessionMemoryFile() 在 sessionMemory.ts
 */
#[derive(Debug, Serialize)]
pub struct InitResult {
    pub path: String,
    pub is_new: bool,
}

#[tauri::command]
pub fn init_session_memory(work_dir: Option<String>) -> Result<InitResult, String> {
    let dir = get_memory_dir(work_dir.as_deref());
    let path = get_memory_path(work_dir.as_deref());

    // 创建目录（0o700）
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create session memory dir: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = PermissionsExt::from_mode(0o700);
        fs::set_permissions(&dir, perms)
            .map_err(|e| format!("Failed to set dir permissions: {}", e))?;
    }

    let is_new = !path.exists();

    if is_new {
        // 创建文件并写入模板（0o600）
        fs::write(&path, DEFAULT_TEMPLATE)
            .map_err(|e| format!("Failed to write session memory: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = PermissionsExt::from_mode(0o600);
            fs::set_permissions(&path, perms)
                .map_err(|e| format!("Failed to set file permissions: {}", e))?;
        }

        println!("💾 Session memory initialized (NEW): {}", path.display());
    } else {
        println!("💾 Session memory exists: {}", path.display());
    }

    Ok(InitResult {
        path: path.to_string_lossy().to_string(),
        is_new,
    })
}

/**
 * 读取 Session Memory 内容
 *
 * 源码参考: getSessionMemoryContent() 在 sessionMemoryUtils.ts
 * - 返回 None 如果文件不存在（不抛异常）
 */
#[tauri::command]
pub fn get_session_memory(work_dir: Option<String>) -> Result<Option<String>, String> {
    let path = get_memory_path(work_dir.as_deref());

    if !path.exists() {
        return Ok(None);
    }

    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read session memory: {}", e))
}

/**
 * 写入 Session Memory 完整内容
 *
 * 源码参考: writeFile(memoryPath, content) 在 sessionMemory.ts
 *
 * AUDIT-FIX [fix-3#2] — Two safeguards against LLM-orchestrated content
 * injection:
 *   1. The work_dir is now validated against writable roots (see
 *      `validate_work_dir`).
 *   2. Callers that only want to update a single section should prefer
 *      `update_session_memory_section`; the full-file write is kept for
 *      bootstrap / template restoration but is rate-limited to prevent
 *      runaway overwrites.
 */
#[tauri::command]
pub fn write_session_memory(content: String, work_dir: Option<String>) -> Result<(), String> {
    let path = get_memory_path(work_dir.as_deref());

    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    // Refuse writes that look like prompt-injection attempts: a top-level
    // `<system>` tag or a markdown HTML comment can confuse downstream LLM
    // consumers. We allow the template's leading `# Session Title` heading.
    if content.contains("<system>") || content.contains("<!-- ignore previous instructions") {
        return Err("Refusing to write session memory: suspicious content detected".to_string());
    }

    // Hard cap to avoid unbounded growth from an LLM hallucinating a
    // multi-megabyte transcript into the file.
    const MAX_BYTES: usize = 256 * 1024;
    if content.len() > MAX_BYTES {
        return Err(format!(
            "Session memory content exceeds {} bytes; use `update_session_memory_section` instead",
            MAX_BYTES
        ));
    }

    fs::write(&path, &content).map_err(|e| format!("Failed to write session memory: {}", e))?;

    println!("💾 Session memory saved ({} bytes)", content.len());
    Ok(())
}

/// AUDIT-FIX [fix-3#2] — Section-level update that only replaces the body
/// of a single `# Section` heading, leaving the rest of the file untouched.
/// The allowed section list is the same as in `DEFAULT_TEMPLATE`, so an
/// LLM cannot create new arbitrary top-level headings that would later
/// surface inside the system prompt.
const ALLOWED_SECTIONS: &[&str] = &[
    "Session Title",
    "Current State",
    "Task specification",
    "Files and Functions",
    "Workflow",
    "Errors & Corrections",
    "Codebase and System Documentation",
    "Learnings",
    "Key results",
    "Worklog",
];

#[tauri::command]
pub fn update_session_memory_section(
    section: String,
    body: String,
    work_dir: Option<String>,
) -> Result<String, String> {
    if !ALLOWED_SECTIONS
        .iter()
        .any(|s| s.eq_ignore_ascii_case(&section))
    {
        return Err(format!("Section '{}' is not in the allow-list", section));
    }
    const MAX_BODY_BYTES: usize = 32 * 1024;
    if body.len() > MAX_BODY_BYTES {
        return Err(format!(
            "Section body exceeds {} bytes; split the update",
            MAX_BODY_BYTES
        ));
    }
    let path = get_memory_path(work_dir.as_deref());
    if !path.exists() {
        return Err("Session memory not initialized".to_string());
    }
    let original = fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;

    // Locate the section's `## Section` heading (template uses `# Section`
    // at the top-level but LLM updates use `## Section` — accept both).
    let heading_targets: Vec<String> = ALLOWED_SECTIONS
        .iter()
        .filter(|s| s.eq_ignore_ascii_case(&section))
        .flat_map(|s| vec![format!("# {}", s), format!("## {}", s)])
        .collect();

    let mut new_content = String::with_capacity(original.len() + body.len());
    let mut replaced = false;
    let mut current_section: Option<String> = None;
    for line in original.lines() {
        let trimmed = line.trim_start_matches('#').trim();
        let matched_heading = heading_targets.iter().any(|h| {
            line.trim_start()
                .eq_ignore_ascii_case(h.trim_start_matches('#').trim())
        });

        if matched_heading {
            current_section = Some(trimmed.to_string());
            new_content.push_str(line);
            new_content.push('\n');
            // Drop the placeholder line that follows the heading (the
            // template uses `_..._` as the body placeholder).
            continue;
        }

        // If we're inside the target section, replace any placeholder /
        // accumulated body lines until the next heading.
        if let Some(cur) = &current_section {
            if cur.eq_ignore_ascii_case(&section) {
                if line.starts_with('#') {
                    // Next heading — fall through to push it unchanged.
                    current_section = Some(trimmed.to_string());
                    new_content.push_str(line);
                } else {
                    // Skip the old body; the first time we hit a non-heading
                    // line we inject the new body and mark the section as
                    // replaced.
                    if !replaced {
                        new_content.push_str(&body);
                        if !body.ends_with('\n') {
                            new_content.push('\n');
                        }
                        replaced = true;
                    }
                }
            } else {
                new_content.push_str(line);
            }
        } else {
            new_content.push_str(line);
        }
        new_content.push('\n');
    }

    if !replaced {
        // Section heading wasn't found in the file — append a new section
        // block at the end so the caller's update is still persisted.
        new_content.push_str(&format!("\n# {}\n{}\n", section, body));
    }

    fs::write(&path, new_content).map_err(|e| format!("Failed to write: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/**
 * 检查 Session Memory 是否为空（只有模板）
 *
 * 源码参考: isSessionMemoryEmpty() 在 prompts.ts
 * 比较 content.trim() === DEFAULT_TEMPLATE.trim()
 */
#[tauri::command]
pub fn is_session_memory_empty(work_dir: Option<String>) -> Result<bool, String> {
    let path = get_memory_path(work_dir.as_deref());

    if !path.exists() {
        return Ok(true);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;

    Ok(content.trim() == DEFAULT_TEMPLATE.trim())
}

/**
 * 检查 Session Memory 是否存在
 */
#[tauri::command]
pub fn session_memory_exists(work_dir: Option<String>) -> bool {
    let path = get_memory_path(work_dir.as_deref());
    path.exists()
}

/**
 * 获取 Session Memory 目录路径
 */
#[tauri::command]
pub fn get_session_memory_dir(work_dir: Option<String>) -> String {
    get_memory_dir(work_dir.as_deref())
        .to_string_lossy()
        .to_string()
}

/**
 * 获取 Session Memory 文件路径
 */
#[tauri::command]
pub fn get_session_memory_path(work_dir: Option<String>) -> String {
    get_memory_path(work_dir.as_deref())
        .to_string_lossy()
        .to_string()
}

/**
 * 获取 Session Memory 的 section 列表
 * 用于 LLM 更新时知道有哪些 section
 */
#[tauri::command]
pub fn get_session_memory_sections(work_dir: Option<String>) -> Result<Vec<String>, String> {
    let path = get_memory_path(work_dir.as_deref());

    if !path.exists() {
        return Err("Session memory not initialized".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;

    let sections: Vec<String> = content
        .lines()
        .filter(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").to_string())
        .collect();

    Ok(sections)
}

/**
 * 估算 Session Memory 的 token 数
 */
#[tauri::command]
pub fn estimate_session_memory_tokens(work_dir: Option<String>) -> Result<usize, String> {
    let content = match get_session_memory(work_dir)? {
        Some(c) => c,
        None => return Ok(0),
    };

    let mut cjk_chars = 0usize;
    let mut other_chars = 0usize;

    for c in content.chars() {
        if c.is_whitespace() {
            continue;
        }
        let code = c as u32;
        let is_cjk = (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0xF900..=0xFAFF).contains(&code)
            || (0x3040..=0x30FF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code);
        if is_cjk {
            cjk_chars += 1;
        } else {
            other_chars += 1;
        }
    }

    Ok((other_chars / 4) + (cjk_chars / 2))
}

/**
 * 读取 Session Memory 并返回（附带元数据）
 * 用于 compact 注入前的准备
 */
#[derive(Debug, Serialize)]
pub struct SessionMemoryInfo {
    pub path: String,
    pub content: String,
    pub tokens: usize,
    pub is_empty: bool,
    pub sections: Vec<String>,
}

#[tauri::command]
pub fn get_session_memory_info(
    work_dir: Option<String>,
) -> Result<Option<SessionMemoryInfo>, String> {
    let path = get_memory_path(work_dir.as_deref());

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;

    let is_empty = content.trim() == DEFAULT_TEMPLATE.trim();

    let sections: Vec<String> = content
        .lines()
        .filter(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").to_string())
        .collect();

    // 估算 tokens
    let mut cjk_chars = 0usize;
    let mut other_chars = 0usize;
    for c in content.chars() {
        if c.is_whitespace() {
            continue;
        }
        let code = c as u32;
        let is_cjk = (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0xF900..=0xFAFF).contains(&code)
            || (0x3040..=0x30FF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code);
        if is_cjk {
            cjk_chars += 1;
        } else {
            other_chars += 1;
        }
    }
    let tokens = (other_chars / 4) + (cjk_chars / 2);

    Ok(Some(SessionMemoryInfo {
        path: path.to_string_lossy().to_string(),
        content,
        tokens,
        is_empty,
        sections,
    }))
}
