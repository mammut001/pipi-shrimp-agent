mod backup;
mod projects;
mod schema;
mod sessions;
mod swarm;
mod token_usage;

pub use backup::{
    backup_before_migration, export_database_backup_file, get_backup_directory,
    list_database_backups, restore_database_from_backup, DbBackupEntry,
};
pub use projects::*;
pub use schema::{get_database_diagnostics, init_database, init_database_with_error};
pub use sessions::*;
pub use swarm::*;
pub use token_usage::*;

#[cfg(test)]
use backup::{rotate_backups, validate_backup_path};
#[cfg(test)]
mod tests;

use once_cell::sync::Lazy;
/**
 * Database module - SQLite persistence for sessions and messages
 */
use rusqlite::{params, types::ToSql, Connection, OptionalExtension, Result as SqliteResult, Row};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Acquire the global database mutex, mapping a poisoned lock to a Sqlite error
/// instead of panicking. Every public function should call this instead of
/// `DATABASE.lock().unwrap()`.
fn get_db() -> SqliteResult<std::sync::MutexGuard<'static, Option<Connection>>> {
    DATABASE.lock().map_err(|e| {
        rusqlite::Error::InvalidParameterName(format!("Database lock poisoned: {}", e))
    })
}

/// AUDIT-FIX [fix-8#1] — Wraps a closure with a clear error when the
/// database is uninitialised. The old `if let Some(conn) = guard.as_ref()`
/// pattern silently returned `Ok(())`, which is a fail-open for every
/// write path (sessions, messages, projects, telegram tasks, etc.).
/// Callers should pass `&mut guard` and the connection will be available
/// as `Some(conn)` inside the closure; otherwise we surface
/// `DatabaseNotInitialized` so the Tauri command layer can render a
/// visible error to the user.
pub fn with_connection<F, T>(f: F) -> SqliteResult<T>
where
    F: FnOnce(&Connection) -> SqliteResult<T>,
{
    let guard = get_db()?;
    match guard.as_ref() {
        Some(conn) => f(conn),
        None => Err(rusqlite::Error::InvalidParameterName(
            "Database is not initialized; please restart the application".to_string(),
        )),
    }
}

/**
 * Helper to map a row to DbSession
 */
fn row_to_session(row: &Row) -> SqliteResult<DbSession> {
    Ok(DbSession {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        cwd: row.get(4)?,
        project_id: row.get(5)?,
        model: row.get(6)?,
        work_dir: row.get(7)?,
        working_files: row.get(8)?,
        permission_mode: row.get(9)?, // NEW: session permission mode
        // Two-folder model columns (v7+). Use `get(...).ok()` so the
        // mapper is tolerant of pre-v7 rows that don't have the columns
        // yet (defence-in-depth — the SELECT statements below do project
        // a `NULL` for missing columns, but if a pre-v7 schema somehow
        // survives the `reconcile_schema` step the mapper won't panic).
        project_dir: row.get::<_, Option<String>>(10).ok().flatten(),
        pipi_output_dir: row.get::<_, Option<String>>(11).ok().flatten(),
        execution_mode: row.get::<_, Option<String>>(12).ok().flatten(),
    })
}

/**
 * Helper to map a row to DbMessage
 */
fn row_to_message(row: &Row) -> SqliteResult<DbMessage> {
    Ok(DbMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        reasoning: row.get(4)?,
        attachments: row.get(5)?,
        artifacts: row.get(6)?,
        tool_calls: row.get(7)?,
        token_usage: row.get(8)?,
        created_at: row.get(9)?,
    })
}

/**
 * Helper to map a row to DbTelegramBinding
 */
fn row_to_telegram_binding(row: &Row) -> SqliteResult<DbTelegramBinding> {
    Ok(DbTelegramBinding {
        chat_id: row.get(0)?,
        chat_type: row.get(1)?,
        display_name: row.get(2)?,
        is_owner: row.get::<_, i64>(3)? != 0,
        auto_run: row.get::<_, i64>(4)? != 0,
        allowed_modes_json: row.get(5)?,
        default_project_id: row.get(6)?,
        default_work_dir: row.get(7)?,
        default_permission_mode: row.get(8)?,
        default_autoresearch_profile_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/**
 * Helper to map a row to DbTelegramTask
 */
fn row_to_telegram_task(row: &Row) -> SqliteResult<DbTelegramTask> {
    Ok(DbTelegramTask {
        id: row.get(0)?,
        chat_id: row.get(1)?,
        source_message_id: row.get(2)?,
        r#type: row.get(3)?,
        status: row.get(4)?,
        prompt: row.get(5)?,
        local_session_id: row.get(6)?,
        result_summary: row.get(7)?,
        error_message: row.get(8)?,
        created_at: row.get(9)?,
        started_at: row.get(10)?,
        finished_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

/**
 * Helper to map a row to DbProject
 */
fn row_to_project(row: &Row) -> SqliteResult<DbProject> {
    Ok(DbProject {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        work_dir: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

/**
 * Helper to map a row to DbTokenUsage
 */
#[allow(dead_code)]
fn row_to_token_usage(row: &Row) -> SqliteResult<DbTokenUsage> {
    Ok(DbTokenUsage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        date: row.get(2)?,
        input_tokens: row.get(3)?,
        output_tokens: row.get(4)?,
        model: row.get(5)?,
        api_config_id: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/**
 * Global database connection
 */
static DATABASE: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

/// AUDIT-FIX [fix-8#1] — Tracks whether `init_database` ever failed.
/// When true, every write that hits the silent no-op path emits a warning
/// so the developer can see the broken state in the logs, and the
/// diagnostics surface this to the frontend so a banner can be shown.
static DB_INIT_FAILED: AtomicBool = AtomicBool::new(false);

/// AUDIT-FIX [fix-8#1] — Last init error message (for diagnostics).
static DB_INIT_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// AUDIT-FIX [fix-8#1] — Public accessor for the frontend diagnostics
/// command. Returns the last captured init error if any.
pub fn database_init_error() -> Option<String> {
    DB_INIT_ERROR.lock().ok().and_then(|guard| guard.clone())
}

/// AUDIT-FIX [fix-8#1] — Centralised "should we warn the dev that this
/// write is being silently dropped" helper. Returns true once per
/// `init_database` failure so we don't flood the logs with one warning
/// per call.
pub fn warn_uninitialized_write(operation: &str) -> bool {
    if DB_INIT_FAILED.load(Ordering::SeqCst) {
        eprintln!(
            "⚠️  [db] Silent no-op for '{}' — database is not initialized",
            operation
        );
        return true;
    }
    false
}

/**
 * Session model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbSession {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub cwd: Option<String>,
    pub project_id: Option<String>,
    pub model: Option<String>,
    pub work_dir: Option<String>,        // legacy single-folder mirror of `project_dir`
    pub working_files: Option<String>,   // JSON serialized ImportedFile[]
    pub permission_mode: Option<String>, // NEW: session permission mode ('standard', 'auto-edits', 'bypass', 'plan-only')
    /// Two-folder model: the user's repo/project path. Tools run
    /// commands and read/write project files relative to this folder.
    /// Replaces the v6 single-folder `work_dir` for tool cwd and file
    /// resolution; `work_dir` is kept as a mirror for downgrade safety.
    pub project_dir: Option<String>,
    /// Two-folder model: app-owned output root (`.pipi-shrimp/`,
    /// generated docs, memory, chat outputs, AutoResearch artifacts).
    /// Defaults to `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}/`
    /// when null — see `get_app_default_dir`.
    pub pipi_output_dir: Option<String>,
    /// 5-mode composer selection (`ask`, `plan`, `debug`, `agent`, `bypass`).
    pub execution_mode: Option<String>,
}

/**
 * Message model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub attachments: Option<String>,
    pub artifacts: Option<String>,
    pub tool_calls: Option<String>,  // JSON-serialized Vec<ToolCall>
    pub token_usage: Option<String>, // JSON-serialized token usage
    pub created_at: i64,
}

/**
 * Project model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbProject {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub work_dir: Option<String>, // NEW: path to local work directory
    pub created_at: i64,
    pub updated_at: i64,
}

/**
 * Token usage model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTokenUsage {
    pub id: String,
    pub session_id: Option<String>,
    pub date: String, // YYYY-MM-DD format
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub model: String,
    pub api_config_id: Option<String>,
    pub created_at: i64,
}

/**
 * Telegram binding model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTelegramBinding {
    pub chat_id: i64,
    pub chat_type: String,
    pub display_name: String,
    pub is_owner: bool,
    pub auto_run: bool,
    pub allowed_modes_json: String,
    pub default_project_id: Option<String>,
    pub default_work_dir: Option<String>,
    pub default_permission_mode: String,
    pub default_autoresearch_profile_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/**
 * Telegram task model for database
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTelegramTask {
    pub id: String,
    pub chat_id: i64,
    pub source_message_id: i64,
    pub r#type: String,
    pub status: String,
    pub prompt: String,
    pub local_session_id: Option<String>,
    pub result_summary: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbDiagnostics {
    pub path: String,
    pub initialized: bool,
    pub schema_version: i64,
    pub last_migration_at: Option<i64>,
    pub integrity_check: String,
    pub file_size_bytes: u64,
    pub wal_size_bytes: u64,
    pub backup_count: usize,
    pub sessions_count: i64,
    pub messages_count: i64,
    pub projects_count: i64,
    pub token_usage_count: i64,
    pub telegram_bindings_count: i64,
    pub telegram_tasks_count: i64,
}

/**
 * Get the database path in app data directory
 */
fn get_app_data_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("PIPI_SHRIMP_DATA_DIR") {
        return PathBuf::from(override_dir);
    }

    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pipi-shrimp-agent")
}

pub fn get_data_directory() -> PathBuf {
    let app_data_dir = get_app_data_dir();
    std::fs::create_dir_all(&app_data_dir).ok();
    app_data_dir
}

fn get_db_path() -> PathBuf {
    let app_data_dir = get_data_directory();
    app_data_dir.join("data.db")
}

fn storage_error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix))
}

/**
 * Get the database connection.
 * Returns an error if the lock is poisoned instead of panicking.
 */
#[allow(dead_code)]
pub fn get_connection() -> SqliteResult<std::sync::MutexGuard<'static, Option<Connection>>> {
    get_db()
}

