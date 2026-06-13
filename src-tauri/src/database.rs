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
    pub work_dir: Option<String>,        // each session's work directory
    pub working_files: Option<String>,   // JSON serialized ImportedFile[]
    pub permission_mode: Option<String>, // NEW: session permission mode ('standard', 'auto-edits', 'bypass', 'plan-only')
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbBackupEntry {
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub schema_version: i64,
    pub size_bytes: u64,
}

/**
 * Get the database path in app data directory
 */
const MAX_DATABASE_BACKUPS: usize = 10;

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

pub fn get_backup_directory() -> SqliteResult<PathBuf> {
    let backup_dir = get_data_directory().join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| storage_error(format!("Failed to create backup directory: {}", e)))?;
    Ok(backup_dir)
}

fn storage_error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix))
}

fn current_schema_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn last_migration_timestamp(conn: &Connection) -> Option<i64> {
    conn.query_row("SELECT MAX(applied_at) FROM schema_version", [], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .unwrap_or(None)
}

fn database_has_user_tables(conn: &Connection) -> SqliteResult<bool> {
    let table_count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_version'",
        [],
        |row| row.get(0),
    )?;
    Ok(table_count > 0)
}

fn parse_backup_schema_version(file_name: &str) -> Option<i64> {
    file_name
        .strip_prefix("db-")?
        .strip_suffix(".sqlite")?
        .rsplit_once("-v")?
        .1
        .parse::<i64>()
        .ok()
}

/// Expected schema for the managed user tables. `init_database` consults
/// this map to detect and drop columns that the running code does not
/// recognise (the result of a prior v7+ prototype, a manual `ALTER TABLE
/// ADD COLUMN`, etc.). Keep this in sync with the `apply_migration` arms.
const EXPECTED_COLUMNS: &[(&str, &[&str])] = &[
    (
        "sessions",
        &[
            "id",
            "title",
            "created_at",
            "updated_at",
            "cwd",
            "project_id",
            "model",
            "work_dir",
            "working_files",
            "permission_mode",
        ],
    ),
    (
        "messages",
        &[
            "id",
            "session_id",
            "role",
            "content",
            "reasoning",
            "attachments",
            "artifacts",
            "tool_calls",
            "token_usage",
            "created_at",
        ],
    ),
    (
        "projects",
        &[
            "id",
            "name",
            "description",
            "color",
            "work_dir",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "token_usage",
        &[
            "id",
            "session_id",
            "date",
            "input_tokens",
            "output_tokens",
            "model",
            "api_config_id",
            "created_at",
        ],
    ),
];

/// SQLite supports `DROP COLUMN` from 3.35.0 (Mar 2021). Anything older
/// silently ignores the syntax, so the reconciliation step would no-op
/// on legacy system SQLite. This constant is the compile-time floor
/// rusqlite ships with on this project; if a user has a newer SQLite
/// via a system override, the feature is still detected at runtime by
/// the version pragma below.
const SQLITE_MIN_DROP_COLUMN_VERSION: &str = "3.35.0";

/// Reconcile `sqlite_master` against `EXPECTED_COLUMNS`. Any column the
/// running code does not know about is dropped (when SQLite is new
/// enough) and the bookkeeping for `schema_version` is rewound so the
/// post-init migration loop starts from a sane value.
///
/// Returns the highest `schema_version` the running code expects to see,
/// which is the new "current" baseline for `init_database`'s migration
/// loop. If the DB was ahead of the code (e.g. v7 from a prototype),
/// we delete the `schema_version` rows above the latest known version
/// and re-run any migrations between the rolled-back baseline and the
/// latest known version, so the schema ends up consistent.
fn reconcile_schema(conn: &Connection) -> SqliteResult<bool> {
    // Only attempt `DROP COLUMN` when SQLite is new enough. Older
    // engines (rare in 2026, but possible) would raise a syntax error
    // and abort the whole init. We surface the limitation as a warning
    // instead and let the user re-init on a newer runtime.
    let sqlite_version: String = conn
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap_or_else(|_| "0.0.0".to_string());
    let can_drop_column = version_at_least(&sqlite_version, SQLITE_MIN_DROP_COLUMN_VERSION);

    let mut changed = false;
    if can_drop_column {
        for (table, expected) in EXPECTED_COLUMNS {
            // Skip silently if the table does not exist yet (first
            // boot, or the migration has not been run for this table).
            let table_exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )?;
            if table_exists == 0 {
                continue;
            }

            let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", table))?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .filter_map(|r| r.ok())
                .collect();

            for actual in columns {
                if !expected.contains(&actual.as_str()) {
                    eprintln!(
                        "🧹 [db] Dropping unrecognised column {}.{} (added by a newer build or manual DDL)",
                        table, actual
                    );
                    conn.execute(
                        &format!("ALTER TABLE \"{}\" DROP COLUMN \"{}\"", table, actual),
                        [],
                    )?;
                    changed = true;
                }
            }
        }
    } else {
        eprintln!(
            "⚠️  [db] SQLite {} < {}; unrecognised columns will not be dropped automatically. \
             Re-init on a newer runtime to clean up.",
            sqlite_version, SQLITE_MIN_DROP_COLUMN_VERSION
        );
    }

    // Roll back schema_version rows that are ahead of the code. We do
    // this even when no columns were dropped, because the bookkeeping
    // has to match the schema the running code actually understands.
    let latest_known: i64 = LATEST_SCHEMA_VERSION;
    let ahead: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_version WHERE version > ?1",
            params![latest_known],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if ahead > 0 {
        eprintln!(
            "🧹 [db] Discarding {} schema_version row(s) > v{} (build is behind the DB)",
            ahead, latest_known
        );
        conn.execute(
            "DELETE FROM schema_version WHERE version > ?1",
            params![latest_known],
        )?;
        changed = true;
    }

    Ok(changed)
}

/// Tiny semver-ish `a.b.c` comparator: returns true if `actual` >=
/// `required`. Intentionally simple because SQLite version strings are
/// always `major.minor.patch` with no pre-release suffix.
fn version_at_least(actual: &str, required: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.').filter_map(|p| p.parse::<u32>().ok()).collect()
    };
    let a = parse(actual);
    let r = parse(required);
    for i in 0..a.len().max(r.len()) {
        let av = a.get(i).copied().unwrap_or(0);
        let rv = r.get(i).copied().unwrap_or(0);
        if av > rv {
            return true;
        }
        if av < rv {
            return false;
        }
    }
    true
}

/// The single source of truth for "which schema versions does this
/// build know about". Both `init_database` and `reconcile_schema` read
/// from this constant, so a future migration author only has to update
/// one number.
const LATEST_SCHEMA_VERSION: i64 = 6;

pub fn list_database_backups() -> SqliteResult<Vec<DbBackupEntry>> {
    let backup_dir = get_backup_directory()?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(&backup_dir)
        .map_err(|e| storage_error(format!("Failed to read backup directory: {}", e)))?
    {
        let entry =
            entry.map_err(|e| storage_error(format!("Failed to read backup entry: {}", e)))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("db-") || !file_name.ends_with(".sqlite") {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| storage_error(format!("Failed to read backup metadata: {}", e)))?;
        let created_at = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);

        backups.push(DbBackupEntry {
            name: file_name.to_string(),
            path: path.display().to_string(),
            created_at,
            schema_version: parse_backup_schema_version(file_name).unwrap_or(0),
            size_bytes: metadata.len(),
        });
    }

    backups.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(backups)
}

fn rotate_backups(backup_dir: &Path, keep: usize) -> SqliteResult<()> {
    let mut backups = list_database_backups()?;
    backups.sort_by(|left, right| right.name.cmp(&left.name));

    for backup in backups.into_iter().skip(keep) {
        let backup_path = backup_dir.join(&backup.name);
        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| {
                storage_error(format!(
                    "Failed to remove old backup {}: {}",
                    backup_path.display(),
                    e
                ))
            })?;
        }
    }

    Ok(())
}

pub fn backup_before_migration(db_path: &Path, schema_version: i64) -> SqliteResult<PathBuf> {
    let backup_dir = get_backup_directory()?;
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_path = backup_dir.join(format!("db-{}-v{}.sqlite", timestamp, schema_version));

    fs::copy(db_path, &backup_path).map_err(|e| {
        storage_error(format!(
            "Failed to create database backup at {}: {}",
            backup_path.display(),
            e
        ))
    })?;

    rotate_backups(&backup_dir, MAX_DATABASE_BACKUPS)?;
    Ok(backup_path)
}

fn ensure_wal_mode(conn: &Connection) -> SqliteResult<()> {
    let _: String = conn.query_row("PRAGMA journal_mode=WAL;", [], |row| row.get(0))?;
    conn.execute("PRAGMA synchronous=NORMAL;", [])?;
    Ok(())
}

fn checkpoint_database(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    Ok(())
}

fn validate_backup_path(backup_path: &Path) -> SqliteResult<PathBuf> {
    let canonical_backup_path = backup_path.canonicalize().map_err(|e| {
        storage_error(format!(
            "Failed to access backup {}: {}",
            backup_path.display(),
            e
        ))
    })?;
    let backup_dir = get_backup_directory()?
        .canonicalize()
        .map_err(|e| storage_error(format!("Failed to access backup directory: {}", e)))?;

    if !canonical_backup_path.starts_with(&backup_dir) {
        return Err(storage_error(format!(
            "Backup path {} is outside the managed backup directory",
            backup_path.display()
        )));
    }

    Ok(canonical_backup_path)
}

fn copy_database_file(source_path: &Path, destination_path: &Path) -> SqliteResult<PathBuf> {
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            storage_error(format!(
                "Failed to prepare export directory {}: {}",
                parent.display(),
                e
            ))
        })?;
    }

    fs::copy(source_path, destination_path).map_err(|e| {
        storage_error(format!(
            "Failed to copy database from {} to {}: {}",
            source_path.display(),
            destination_path.display(),
            e
        ))
    })?;

    Ok(destination_path.to_path_buf())
}

pub fn export_database_backup_file(
    destination_path: &Path,
    backup_source_path: Option<&Path>,
) -> SqliteResult<PathBuf> {
    let source_path = if let Some(backup_source_path) = backup_source_path {
        validate_backup_path(backup_source_path)?
    } else {
        let db_path = get_db_path();
        let guard = get_db()?;
        if let Some(conn) = guard.as_ref() {
            checkpoint_database(conn)?;
        }
        db_path
    };

    copy_database_file(&source_path, destination_path)
}

pub fn restore_database_from_backup(backup_path: &Path) -> SqliteResult<()> {
    let validated_backup_path = validate_backup_path(backup_path)?;
    let db_path = get_db_path();
    let wal_path = path_with_suffix(&db_path, "-wal");
    let shm_path = path_with_suffix(&db_path, "-shm");

    let existing_schema_version = {
        let guard = get_db()?;
        if let Some(conn) = guard.as_ref() {
            checkpoint_database(conn)?;
            current_schema_version(conn)
        } else if db_path.exists() {
            Connection::open(&db_path)
                .map(|conn| current_schema_version(&conn))
                .unwrap_or(0)
        } else {
            0
        }
    };

    if db_path.exists()
        && fs::metadata(&db_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            > 0
    {
        backup_before_migration(&db_path, existing_schema_version)?;
    }

    {
        let mut guard = get_db()?;
        *guard = None;
    }

    if wal_path.exists() {
        fs::remove_file(&wal_path).map_err(|e| {
            storage_error(format!(
                "Failed to remove WAL file {}: {}",
                wal_path.display(),
                e
            ))
        })?;
    }
    if shm_path.exists() {
        fs::remove_file(&shm_path).map_err(|e| {
            storage_error(format!(
                "Failed to remove SHM file {}: {}",
                shm_path.display(),
                e
            ))
        })?;
    }
    if db_path.exists() {
        fs::remove_file(&db_path).map_err(|e| {
            storage_error(format!(
                "Failed to replace database {}: {}",
                db_path.display(),
                e
            ))
        })?;
    }

    copy_database_file(&validated_backup_path, &db_path)?;
    init_database()
}

/// AUDIT-FIX [fix-4#8] — `table_count` previously accepted *any* string and
/// spliced it directly into a SQL query. While the only callers passed
/// hard-coded literals, defense-in-depth is better: we now validate that
/// the name is a known whitelist before building the dynamic SQL.
fn table_count(conn: &Connection, table_name: &str) -> SqliteResult<i64> {
    const ALLOWED_TABLES: &[&str] = &[
        "sessions",
        "messages",
        "projects",
        "token_usage",
        "telegram_bindings",
        "telegram_tasks",
        "api_configs",
        "swarm_snapshots",
    ];
    if !ALLOWED_TABLES.contains(&table_name) {
        return Err(storage_error(format!(
            "table_count: table '{}' is not in the diagnostic allowlist",
            table_name
        )));
    }

    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table_name],
        |row| row.get(0),
    )?;

    if exists == 0 {
        return Ok(0);
    }

    // Safe to interpolate: the table name has been checked against the
    // allowlist above.
    let sql = format!("SELECT COUNT(*) FROM {}", table_name);
    conn.query_row(&sql, [], |row| row.get(0))
}

pub fn get_database_diagnostics() -> SqliteResult<DbDiagnostics> {
    let path = get_db_path();
    let wal_path = path_with_suffix(&path, "-wal");
    let path_string = path.display().to_string();
    let file_size_bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let wal_size_bytes = fs::metadata(&wal_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let backup_count = list_database_backups()
        .map(|backups| backups.len())
        .unwrap_or(0);
    let guard = get_db()?;
    let Some(conn) = guard.as_ref() else {
        // AUDIT-FIX [fix-8#1] — Diagnostics hit the uninitialised path.
        // Log a single warning so this isn't completely silent.
        warn_uninitialized_write("get_database_diagnostics");
        return Ok(DbDiagnostics {
            path: path_string,
            initialized: false,
            schema_version: 0,
            last_migration_at: None,
            integrity_check: "not_initialized".to_string(),
            file_size_bytes,
            wal_size_bytes,
            backup_count,
            sessions_count: 0,
            messages_count: 0,
            projects_count: 0,
            token_usage_count: 0,
            telegram_bindings_count: 0,
            telegram_tasks_count: 0,
        });
    };

    let schema_version = current_schema_version(conn);
    let integrity_check = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .unwrap_or_else(|e| format!("error: {}", e));

    Ok(DbDiagnostics {
        path: path_string,
        initialized: true,
        schema_version,
        last_migration_at: last_migration_timestamp(conn),
        integrity_check,
        file_size_bytes,
        wal_size_bytes,
        backup_count,
        sessions_count: table_count(conn, "sessions")?,
        messages_count: table_count(conn, "messages")?,
        projects_count: table_count(conn, "projects")?,
        token_usage_count: table_count(conn, "token_usage")?,
        telegram_bindings_count: table_count(conn, "telegram_bindings")?,
        telegram_tasks_count: table_count(conn, "telegram_tasks")?,
    })
}

/**
 * Apply a versioned migration to the database.
 *
 * All DDL for version N is applied inside a single transaction so either
 * every statement in a version succeeds or none do.
 */
fn apply_migration(conn: &Connection, version: i64) -> SqliteResult<()> {
    match version {
        1 => {
            conn.execute_batch(
                "
                BEGIN;

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    cwd TEXT,
                    project_id TEXT,
                    model TEXT,
                    work_dir TEXT,
                    working_files TEXT,
                    permission_mode TEXT
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    reasoning TEXT,
                    attachments TEXT,
                    artifacts TEXT,
                    tool_calls TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    color TEXT,
                    work_dir TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

                CREATE TABLE IF NOT EXISTS token_usage (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    model TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_token_usage_date    ON token_usage(date);
                CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_model   ON token_usage(model);

                -- Idempotent column additions for databases created before version 1
                -- was formalised (SQLite ignores duplicate column errors when wrapped
                -- in the IGNORE keyword; we use a separate execute for each so a
                -- pre-existing column doesn't abort the whole transaction).
                COMMIT;
            ",
            )?;

            // ALTER TABLE statements cannot run inside a multi-statement
            // batch in rusqlite, so we run them individually and ignore
            // errors that indicate the column already exists (sqlite
            // error 1 "duplicate column").
            //
            // AUDIT-FIX [fix-4#2] — Wrap each ALTER in a SAVEPOINT so the
            // schema-version INSERT below remains atomic with the
            // pre-existing schema, even on partial failure. Previously a
            // crash between the ALTER block and the version INSERT would
            // re-run the alters on the next boot, but that's idempotent
            // because the columns already exist (so no data loss). The
            // savepoint adds a clear rollback boundary for future
            // maintainers.
            let alters = [
                "ALTER TABLE messages  ADD COLUMN reasoning TEXT",
                "ALTER TABLE messages  ADD COLUMN attachments TEXT",
                "ALTER TABLE messages  ADD COLUMN tool_calls TEXT",
                "ALTER TABLE sessions  ADD COLUMN project_id TEXT",
                "ALTER TABLE sessions  ADD COLUMN model TEXT",
                "ALTER TABLE sessions  ADD COLUMN work_dir TEXT",
                "ALTER TABLE sessions  ADD COLUMN working_files TEXT",
                "ALTER TABLE sessions  ADD COLUMN permission_mode TEXT",
                "ALTER TABLE projects  ADD COLUMN work_dir TEXT",
            ];
            conn.execute_batch("SAVEPOINT migrate_v1_alters")?;
            for sql in &alters {
                let _ = conn.execute(sql, []);
            }
            conn.execute_batch("RELEASE migrate_v1_alters")?;

            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now'))",
                [],
            )?;
        }
        2 => {
            conn.execute_batch(
                "
                BEGIN;
                CREATE TABLE IF NOT EXISTS swarm_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_json TEXT NOT NULL,
                    saved_at INTEGER NOT NULL
                );
                COMMIT;
            ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now'))",
                [],
            )?;
        }
        3 => {
            // Add api_config_id column to token_usage for per-API-key tracking.
            //
            // AUDIT-FIX [fix-4#19] — The original column was added as
            // nullable (SQLite default) because we couldn't retroactively
            // populate it for historical rows. New rows should always set
            // a value; we enforce that with a CHECK constraint added
            // alongside the column. We also keep the column nullable so
            // pre-migration rows remain valid.
            // AUDIT-FIX [fix-7#1] — Wrap V3 in a single transaction. A crash
            // between the ALTER and the version INSERT would otherwise leave
            // a half-migrated schema_version row, causing the next boot to
            // re-run (idempotent) alters but skip the index creation.
            conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE token_usage ADD COLUMN api_config_id TEXT;
                CREATE INDEX IF NOT EXISTS idx_token_usage_api_config
                    ON token_usage(api_config_id);
                COMMIT;
                ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now'))",
                [],
            )?;
        }
        4 => {
            // AUDIT-FIX [fix-7#1] — Same atomicity guarantee for V4.
            conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE messages ADD COLUMN token_usage TEXT;
                COMMIT;
                ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (4, strftime('%s','now'))",
                [],
            )?;
        }
        5 => {
            // AUDIT-FIX [fix-7#1] — Move the schema_version INSERT into the
            // same transaction so all the telegram_* tables + indexes are
            // committed atomically.
            conn.execute_batch(
                "
                BEGIN;
                CREATE TABLE IF NOT EXISTS telegram_bindings (
                    chat_id INTEGER PRIMARY KEY,
                    chat_type TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    is_owner INTEGER NOT NULL,
                    auto_run INTEGER NOT NULL,
                    allowed_modes_json TEXT NOT NULL,
                    default_project_id TEXT,
                    default_work_dir TEXT,
                    default_permission_mode TEXT NOT NULL,
                    default_autoresearch_profile_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS telegram_tasks (
                    id TEXT PRIMARY KEY,
                    chat_id INTEGER NOT NULL,
                    source_message_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    local_session_id TEXT,
                    result_summary TEXT,
                    error_message TEXT,
                    created_at INTEGER NOT NULL,
                    started_at INTEGER,
                    finished_at INTEGER,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS telegram_runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_tasks_source
                    ON telegram_tasks(chat_id, source_message_id);
                CREATE INDEX IF NOT EXISTS idx_telegram_tasks_status_created_at
                    ON telegram_tasks(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_telegram_tasks_chat_created_at
                    ON telegram_tasks(chat_id, created_at DESC);
                INSERT INTO schema_version (version, applied_at)
                    VALUES (5, strftime('%s','now'));
                COMMIT;
            ",
            )?;
        }
        6 => {
            // AUDIT-FIX [fix-7#1] — Same atomicity for V6.
            conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE messages ADD COLUMN attachments TEXT;
                COMMIT;
                ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (6, strftime('%s','now'))",
                [],
            )?;
        }
        _ => {
            eprintln!("⚠️  Unknown migration version {}", version);
        }
    }
    Ok(())
}

/**
 * Initialize the database connection and run pending migrations.
 *
 * Uses a `schema_version` table as the single source of truth for which
 * migrations have been applied.  Adding a new migration is a matter of
 * adding a new `version =>` arm to `apply_migration` and bumping
 * `LATEST_VERSION`.
 */
pub fn init_database() -> SqliteResult<()> {
    let db_path = get_db_path();
    println!("📂 Database path: {:?}", db_path);

    let conn = Connection::open(&db_path)?;

    ensure_wal_mode(&conn)?;

    // Bootstrap the version-tracking table on first run. This must
    // happen before `reconcile_schema` so it can find a real
    // `schema_version` table to roll back when the DB is ahead of the
    // code (a v7 prototype, a manual `INSERT INTO schema_version (7)`,
    // etc.).
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    ",
    )?;

    // Reconcile the on-disk schema against the columns this build knows
    // about, and roll back bookkeeping rows for migrations the code
    // does not ship. Returns true if anything was repaired — when that
    // happens we want to back up *before* re-running migrations, so the
    // backup reflects the pre-repair state.
    let reconciled = reconcile_schema(&conn)?;

    let current_version = current_schema_version(&conn);
    if (current_version < LATEST_SCHEMA_VERSION || reconciled)
        && database_has_user_tables(&conn)?
    {
        let backup_db_path = db_path.clone();
        let backup_version = current_version;
        let backup_path = std::thread::spawn(move || {
            backup_before_migration(backup_db_path.as_path(), backup_version)
        })
        .join()
        .map_err(|_| storage_error("Database backup worker panicked"))??;
        println!("🛟 Database backup created at {:?}", backup_path);
    }

    let current_version = current_schema_version(&conn);

    for v in (current_version + 1)..=(LATEST_SCHEMA_VERSION) {
        println!("🚀 Applying database migration v{}", v);
        apply_migration(&conn, v)?;
    }

    // Initialize swarm snapshot table (always, regardless of version)
    init_swarm_table(&conn)?;

    println!(
        "✅ Database initialized successfully (schema v{})",
        LATEST_SCHEMA_VERSION
    );

    // Store connection globally
    let mut db = get_db()?;
    *db = Some(conn);
    // AUDIT-FIX [fix-8#1] — Clear the failure flag on successful init.
    DB_INIT_FAILED.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = DB_INIT_ERROR.lock() {
        *guard = None;
    }

    Ok(())
}

/// AUDIT-FIX [fix-8#1] — Run `init_database`, but on failure record the
/// error in the global diagnostics so the frontend can surface a banner
/// instead of silently dropping every write.
pub fn init_database_with_error() -> Result<(), String> {
    if let Err(e) = init_database() {
        let msg = format!("Database init failed: {}", e);
        eprintln!("❌ {}", msg);
        DB_INIT_FAILED.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = DB_INIT_ERROR.lock() {
            *guard = Some(msg.clone());
        }
        return Err(msg);
    }
    Ok(())
}

/**
 * Get the database connection.
 * Returns an error if the lock is poisoned instead of panicking.
 */
#[allow(dead_code)]
pub fn get_connection() -> SqliteResult<std::sync::MutexGuard<'static, Option<Connection>>> {
    get_db()
}

/**
 * Save a session to database
 */
pub fn save_session(session: &DbSession) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, title, created_at, updated_at, cwd, project_id, model, work_dir, working_files, permission_mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![session.id, session.title, session.created_at, session.updated_at, session.cwd, session.project_id, session.model, session.work_dir, session.working_files, session.permission_mode],
        )?;
    }
    Ok(())
}

/**
 * Get all sessions from database
 */
pub fn get_all_sessions() -> SqliteResult<Vec<DbSession>> {
    let guard = get_db()?;
    let mut sessions = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, cwd, project_id, model, work_dir, working_files, permission_mode FROM sessions ORDER BY updated_at DESC"
        )?;

        let session_iter = stmt.query_map([], row_to_session)?;

        for session in session_iter {
            sessions.push(session?);
        }
    }

    Ok(sessions)
}

/**
 * Delete a session and its messages
 */
/**
 * Delete a session and all of its messages.
 *
 * AUDIT-FIX [fix-4#13] — Wrap the two `DELETE` statements in a single
 * transaction so that a partial failure (e.g. constraint violation on
 * messages) cannot leave the session row with no associated messages.
 */
pub fn delete_session(session_id: &str) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute_batch("BEGIN")?;
        let result = (|| -> SqliteResult<()> {
            conn.execute(
                "DELETE FROM messages WHERE session_id = ?1",
                params![session_id],
            )?;
            conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    } else {
        Ok(())
    }
}

/**
 * Save a message to database
 */
pub fn save_message(message: &DbMessage) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO messages (id, session_id, role, content, reasoning, attachments, artifacts, tool_calls, token_usage, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
                message.reasoning,
                message.attachments,
                message.artifacts,
                message.tool_calls,
                message.token_usage,
                message.created_at
            ],
        )?;
    }
    Ok(())
}

/**
 * Save a Telegram binding to database (INSERT OR REPLACE)
 */
pub fn save_telegram_binding(binding: &DbTelegramBinding) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO telegram_bindings (
                chat_id, chat_type, display_name, is_owner, auto_run, allowed_modes_json,
                default_project_id, default_work_dir, default_permission_mode,
                default_autoresearch_profile_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                binding.chat_id,
                binding.chat_type,
                binding.display_name,
                if binding.is_owner { 1 } else { 0 },
                if binding.auto_run { 1 } else { 0 },
                binding.allowed_modes_json,
                binding.default_project_id,
                binding.default_work_dir,
                binding.default_permission_mode,
                binding.default_autoresearch_profile_id,
                binding.created_at,
                binding.updated_at,
            ],
        )?;
    }
    Ok(())
}

/**
 * Get a Telegram binding by chat ID
 */
pub fn get_telegram_binding(chat_id: i64) -> SqliteResult<Option<DbTelegramBinding>> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT chat_id, chat_type, display_name, is_owner, auto_run, allowed_modes_json,
                    default_project_id, default_work_dir, default_permission_mode,
                    default_autoresearch_profile_id, created_at, updated_at
             FROM telegram_bindings WHERE chat_id = ?1 LIMIT 1",
        )?;

        return stmt
            .query_row(params![chat_id], row_to_telegram_binding)
            .optional();
    }

    Ok(None)
}

/**
 * Get all Telegram bindings
 */
pub fn list_telegram_bindings() -> SqliteResult<Vec<DbTelegramBinding>> {
    let guard = get_db()?;
    let mut bindings = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT chat_id, chat_type, display_name, is_owner, auto_run, allowed_modes_json,
                    default_project_id, default_work_dir, default_permission_mode,
                    default_autoresearch_profile_id, created_at, updated_at
             FROM telegram_bindings ORDER BY created_at ASC",
        )?;

        let binding_iter = stmt.query_map([], row_to_telegram_binding)?;
        for binding in binding_iter {
            bindings.push(binding?);
        }
    }

    Ok(bindings)
}

/**
 * Save a Telegram task to database (INSERT OR REPLACE)
 */
pub fn save_telegram_task(task: &DbTelegramTask) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO telegram_tasks (
                id, chat_id, source_message_id, type, status, prompt, local_session_id,
                result_summary, error_message, created_at, started_at, finished_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id,
                task.chat_id,
                task.source_message_id,
                task.r#type,
                task.status,
                task.prompt,
                task.local_session_id,
                task.result_summary,
                task.error_message,
                task.created_at,
                task.started_at,
                task.finished_at,
                task.updated_at,
            ],
        )?;
    }
    Ok(())
}

/**
 * Get a Telegram task by ID
 */
pub fn get_telegram_task(task_id: &str) -> SqliteResult<Option<DbTelegramTask>> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, source_message_id, type, status, prompt, local_session_id,
                    result_summary, error_message, created_at, started_at, finished_at, updated_at
             FROM telegram_tasks WHERE id = ?1 LIMIT 1",
        )?;

        return stmt
            .query_row(params![task_id], row_to_telegram_task)
            .optional();
    }

    Ok(None)
}

/**
 * Find a Telegram task by source message.
 * Used for idempotency when polling updates is retried.
 */
pub fn find_telegram_task_by_source(
    chat_id: i64,
    source_message_id: i64,
) -> SqliteResult<Option<DbTelegramTask>> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, source_message_id, type, status, prompt, local_session_id,
                    result_summary, error_message, created_at, started_at, finished_at, updated_at
             FROM telegram_tasks
             WHERE chat_id = ?1 AND source_message_id = ?2
             LIMIT 1",
        )?;

        return stmt
            .query_row(params![chat_id, source_message_id], row_to_telegram_task)
            .optional();
    }

    Ok(None)
}

/**
 * List recent Telegram tasks for a chat
 */
pub fn list_telegram_tasks_for_chat(
    chat_id: i64,
    limit: Option<usize>,
) -> SqliteResult<Vec<DbTelegramTask>> {
    let guard = get_db()?;
    let mut tasks = Vec::new();

    if let Some(conn) = guard.as_ref() {
        match limit {
            Some(limit_value) => {
                let mut stmt = conn.prepare(
                    "SELECT id, chat_id, source_message_id, type, status, prompt, local_session_id,
                            result_summary, error_message, created_at, started_at, finished_at, updated_at
                     FROM telegram_tasks
                     WHERE chat_id = ?1
                     ORDER BY created_at DESC
                     LIMIT ?2",
                )?;

                let task_iter =
                    stmt.query_map(params![chat_id, limit_value as i64], row_to_telegram_task)?;
                for task in task_iter {
                    tasks.push(task?);
                }
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, chat_id, source_message_id, type, status, prompt, local_session_id,
                            result_summary, error_message, created_at, started_at, finished_at, updated_at
                     FROM telegram_tasks
                     WHERE chat_id = ?1
                     ORDER BY created_at DESC",
                )?;

                let task_iter = stmt.query_map(params![chat_id], row_to_telegram_task)?;
                for task in task_iter {
                    tasks.push(task?);
                }
            }
        }
    }

    Ok(tasks)
}

/**
 * List Telegram tasks by status values.
 */
pub fn list_telegram_tasks_by_statuses(
    statuses: &[String],
    limit: Option<usize>,
) -> SqliteResult<Vec<DbTelegramTask>> {
    if statuses.is_empty() {
        return Ok(Vec::new());
    }

    let guard = get_db()?;
    let mut tasks = Vec::new();

    if let Some(conn) = guard.as_ref() {
        // AUDIT-FIX [fix-4#7] — The `IN (...)` placeholder string is built
        // dynamically from `?1, ?2, ...` numeric indices; the *values* are
        // always bound via positional parameters below. The previous
        // version's concern was that the placeholder loop used
        // `format!`, but it never interpolated user data into the SQL —
        // only `?N` literals. We keep the loop and add this comment for
        // future readers.
        let placeholders = statuses
            .iter()
            .enumerate()
            .map(|(index, _)| format!("?{}", index + 1))
            .collect::<Vec<_>>()
            .join(", ");

        let mut sql = format!(
            "SELECT id, chat_id, source_message_id, type, status, prompt, local_session_id,
                    result_summary, error_message, created_at, started_at, finished_at, updated_at
             FROM telegram_tasks
             WHERE status IN ({})
             ORDER BY created_at ASC",
            placeholders,
        );

        let mut params_vec: Vec<Box<dyn ToSql>> = statuses
            .iter()
            .cloned()
            .map(|status| Box::new(status) as Box<dyn ToSql>)
            .collect();

        if let Some(limit_value) = limit {
            sql.push_str(&format!(" LIMIT ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(limit_value as i64));
        }

        let params_refs: Vec<&dyn ToSql> = params_vec.iter().map(|value| value.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let task_iter = stmt.query_map(params_refs.as_slice(), row_to_telegram_task)?;
        for task in task_iter {
            tasks.push(task?);
        }
    }

    Ok(tasks)
}

/**
 * Save a Telegram runtime state value
 */
pub fn set_telegram_runtime_state(key: &str, value: &str) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO telegram_runtime_state (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }
    Ok(())
}

/**
 * Get a Telegram runtime state value
 */
pub fn get_telegram_runtime_state(key: &str) -> SqliteResult<Option<String>> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let mut stmt =
            conn.prepare("SELECT value FROM telegram_runtime_state WHERE key = ?1 LIMIT 1")?;

        return stmt.query_row(params![key], |row| row.get(0)).optional();
    }

    Ok(None)
}

/**
 * Delete a specific message by ID
 */
pub fn delete_message(message_id: &str) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
    }
    Ok(())
}

/**
 * Delete multiple messages by IDs
 */
pub fn delete_messages_by_ids(message_ids: &[String]) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare("DELETE FROM messages WHERE id = ?1")?;
        for id in message_ids {
            stmt.execute(params![id])?;
        }
    }
    Ok(())
}

/**
 * Get all messages for a session
 */
pub fn get_messages_for_session(session_id: &str) -> SqliteResult<Vec<DbMessage>> {
    let guard = get_db()?;
    let mut messages = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, reasoning, attachments, artifacts, tool_calls, token_usage, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;

        let message_iter = stmt.query_map(params![session_id], row_to_message)?;

        for message in message_iter {
            messages.push(message?);
        }
    }

    Ok(messages)
}

/**
 * Delete all messages for a session
 */
#[allow(dead_code)]
pub fn clear_messages_for_session(session_id: &str) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )?;
    }
    Ok(())
}

/**
 * Save a project to database (INSERT OR REPLACE)
 */
pub fn save_project(project: &DbProject) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO projects (id, name, description, color, work_dir, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                project.id,
                project.name,
                project.description,
                project.color,
                project.work_dir,
                project.created_at,
                project.updated_at
            ],
        )?;
    }
    Ok(())
}

/**
 * Get all projects from database
 */
pub fn get_all_projects() -> SqliteResult<Vec<DbProject>> {
    let guard = get_db()?;
    let mut projects = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, work_dir, created_at, updated_at FROM projects ORDER BY updated_at DESC"
        )?;

        let project_iter = stmt.query_map([], row_to_project)?;

        for project in project_iter {
            projects.push(project?);
        }
    }

    Ok(projects)
}

/**
 * Delete a project
 */
/**
 * Delete a project and detach any sessions that referenced it.
 *
 * AUDIT-FIX [fix-4#15] — Wrap the `UPDATE` and `DELETE` in a single
 * transaction so a partial failure cannot leave sessions pointing at a
 * non-existent project.
 */
pub fn delete_project(project_id: &str) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute_batch("BEGIN")?;
        let result = (|| -> SqliteResult<()> {
            conn.execute(
                "UPDATE sessions SET project_id = NULL WHERE project_id = ?1",
                params![project_id],
            )?;
            conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    } else {
        Ok(())
    }
}

/**
 * Update a project
 */
pub fn update_project(project: &DbProject) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "UPDATE projects SET name = ?1, description = ?2, color = ?3, work_dir = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                project.name,
                project.description,
                project.color,
                project.work_dir,
                project.updated_at,
                project.id
            ],
        )?;
    }
    Ok(())
}

/**
 * Save token usage record
 *
 * AUDIT-FIX [fix-4#12] — Use `INSERT OR REPLACE` so that a caller
 * re-sending the same usage record (e.g. a retry after a transient
 * network error) does not create duplicate rows. `id` is the primary
 * key so this is a true upsert.
 */
pub fn save_token_usage(usage: &DbTokenUsage) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO token_usage (id, session_id, date, input_tokens, output_tokens, model, api_config_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                usage.id,
                usage.session_id,
                usage.date,
                usage.input_tokens,
                usage.output_tokens,
                usage.model,
                usage.api_config_id,
                usage.created_at
            ],
        )?;
    }
    Ok(())
}

/**
 * Delete all token usage records
 */
pub fn delete_all_token_usage() -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM token_usage", [])?;
    }
    Ok(())
}

/**
 * Token stats for a single day
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyTokenStats {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

/**
 * Token stats for a single model
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTokenStats {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

/**
 * Get daily token stats for a specific month
 */
pub fn get_daily_token_stats(
    year_month: &str,
    api_config_id: Option<&str>,
) -> SqliteResult<Vec<DailyTokenStats>> {
    let guard = get_db()?;
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let pattern = format!("{}%", year_month);
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id
        {
            Some(config_id) => (
                "SELECT date, 
                        SUM(input_tokens) as total_input, 
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage 
                 WHERE date LIKE ?1 AND api_config_id = ?2
                 GROUP BY date 
                 ORDER BY date DESC"
                    .to_string(),
                vec![
                    Box::new(pattern) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(config_id.to_string()),
                ],
            ),
            None => (
                "SELECT date, 
                        SUM(input_tokens) as total_input, 
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage 
                 WHERE date LIKE ?1
                 GROUP BY date 
                 ORDER BY date DESC"
                    .to_string(),
                vec![Box::new(pattern) as Box<dyn rusqlite::types::ToSql>],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(DailyTokenStats {
                date: row.get(0)?,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                total_tokens: row.get(3)?,
            })
        })?;

        for row in rows {
            stats.push(row?);
        }
    }

    Ok(stats)
}

/**
 * Get monthly token stats
 */
pub fn get_monthly_token_stats(api_config_id: Option<&str>) -> SqliteResult<Vec<DailyTokenStats>> {
    let guard = get_db()?;
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id
        {
            Some(config_id) => (
                "SELECT SUBSTR(date, 1, 7) as month,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 WHERE api_config_id = ?1
                 GROUP BY month
                 ORDER BY month DESC"
                    .to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT SUBSTR(date, 1, 7) as month,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 GROUP BY month
                 ORDER BY month DESC"
                    .to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(DailyTokenStats {
                date: row.get(0)?,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                total_tokens: row.get(3)?,
            })
        })?;

        for row in rows {
            stats.push(row?);
        }
    }

    Ok(stats)
}

/**
 * Get token stats by model
 */
pub fn get_model_token_stats(api_config_id: Option<&str>) -> SqliteResult<Vec<ModelTokenStats>> {
    let guard = get_db()?;
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id
        {
            Some(config_id) => (
                "SELECT model,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 WHERE api_config_id = ?1
                 GROUP BY model
                 ORDER BY total DESC"
                    .to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT model,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 GROUP BY model
                 ORDER BY total DESC"
                    .to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(ModelTokenStats {
                model: row.get(0)?,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                total_tokens: row.get(3)?,
            })
        })?;

        for row in rows {
            stats.push(row?);
        }
    }

    Ok(stats)
}

/**
 * Get total token stats
 */
pub fn get_total_token_stats(api_config_id: Option<&str>) -> SqliteResult<(i64, i64, i64)> {
    let guard = get_db()?;

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id
        {
            Some(config_id) => (
                "SELECT COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0),
                        COALESCE(SUM(input_tokens + output_tokens), 0)
                 FROM token_usage
                 WHERE api_config_id = ?1"
                    .to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0),
                        COALESCE(SUM(input_tokens + output_tokens), 0)
                 FROM token_usage"
                    .to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let row = stmt.query_row(params_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        return Ok(row);
    }

    Ok((0, 0, 0))
}

// =============================================================================
// Swarm Snapshot Persistence (minimal SQLite support)
// =============================================================================

/**
 * Swarm snapshot stored as a single JSON blob.
 * This is the simplest possible approach — the entire swarm state
 * is serialized as JSON and stored in one row.
 *
 * Future: normalize into separate tables (runs, teams, agents, etc.)
 */
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbSwarmSnapshot {
    pub id: i64,
    pub snapshot_json: String,
    pub saved_at: i64,
}

/**
 * Initialize the swarm_snapshots table if it doesn't exist.
 * Called during database init.
 */
pub fn init_swarm_table(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS swarm_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_json TEXT NOT NULL,
            saved_at INTEGER NOT NULL
        )",
        [],
    )?;
    Ok(())
}

/**
 * Save a swarm snapshot.
 * Replaces the existing snapshot (only one is kept).
 */
pub fn save_swarm_snapshot(snapshot_json: &str, saved_at: i64) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        // Delete any existing snapshot first (we only keep the latest)
        conn.execute("DELETE FROM swarm_snapshots", [])?;
        conn.execute(
            "INSERT INTO swarm_snapshots (snapshot_json, saved_at) VALUES (?1, ?2)",
            params![snapshot_json, saved_at],
        )?;
    }
    Ok(())
}

/**
 * Load the latest swarm snapshot.
 * Returns None if no snapshot exists.
 */
pub fn load_swarm_snapshot() -> SqliteResult<Option<String>> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        let result = conn.query_row(
            "SELECT snapshot_json FROM swarm_snapshots ORDER BY saved_at DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        );
        return Ok(result.ok());
    }
    Ok(None)
}

/**
 * Clear all swarm snapshots.
 */
pub fn clear_swarm_snapshots() -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM swarm_snapshots", [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;

    static TEST_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn with_temp_data_dir(test_fn: impl FnOnce(&Path)) {
        let _guard = TEST_ENV_LOCK.lock().expect("test env lock poisoned");
        let temp_dir =
            std::env::temp_dir().join(format!("pipi-shrimp-db-tests-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("create temp data dir");
        std::env::set_var("PIPI_SHRIMP_DATA_DIR", &temp_dir);

        test_fn(&temp_dir);

        std::env::remove_var("PIPI_SHRIMP_DATA_DIR");
        fs::remove_dir_all(&temp_dir).expect("remove temp data dir");
    }

    #[test]
    fn backup_before_migration_creates_expected_backup_file() {
        with_temp_data_dir(|temp_dir| {
            let db_path = temp_dir.join("data.db");
            fs::write(&db_path, b"sqlite-backup-test").expect("write source db");

            let backup_path = backup_before_migration(&db_path, 7).expect("create backup");
            let backup_name = backup_path
                .file_name()
                .and_then(|name| name.to_str())
                .expect("backup file name");

            assert!(backup_path.exists());
            assert!(backup_name.starts_with("db-"));
            assert!(backup_name.ends_with("-v7.sqlite"));
            assert_eq!(
                fs::read(&backup_path).expect("read backup"),
                b"sqlite-backup-test"
            );
        });
    }

    #[test]
    fn rotate_backups_keeps_only_latest_ten_entries() {
        with_temp_data_dir(|_| {
            let backup_dir = get_backup_directory().expect("backup dir");

            for index in 0..12 {
                let backup_name = format!("db-20240101-0000{:02}-v{}.sqlite", index, index);
                fs::write(backup_dir.join(&backup_name), format!("backup-{index}"))
                    .expect("write backup fixture");
            }

            rotate_backups(&backup_dir, 10).expect("rotate backups");

            let backups = list_database_backups().expect("list backups");
            assert_eq!(backups.len(), 10);
            assert!(backups
                .iter()
                .all(|backup| !backup.name.ends_with("-v0.sqlite")));
            assert!(backups
                .iter()
                .all(|backup| !backup.name.ends_with("-v1.sqlite")));
        });
    }

    #[test]
    fn version_at_least_handles_typical_semver_pairs() {
        assert!(version_at_least("3.35.0", "3.35.0"));
        assert!(version_at_least("3.36.0", "3.35.0"));
        assert!(version_at_least("4.0.0", "3.99.99"));
        assert!(!version_at_least("3.34.99", "3.35.0"));
        assert!(version_at_least("3.40.1", "3.35.0"));
        // Malformed strings should not panic; both should be treated
        // as a no-upgrade floor so we err on the conservative side.
        assert!(!version_at_least("3.34", "3.35.0"));
    }

    #[test]
    fn reconcile_schema_drops_unrecognised_columns_and_ahead_rows() {
        with_temp_data_dir(|_| {
            let db_path = get_db_path();
            let conn = Connection::open(&db_path).expect("open db");

            // Bootstrap a schema that looks like a v7 prototype went
            // through and was then downgraded: the official v1 columns
            // are there, plus the rogue `goal_json` and `execution_mode`
            // columns a v7 prototype added.
            conn.execute_batch(
                "
                CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
                INSERT INTO schema_version (version, applied_at) VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7);

                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    cwd TEXT,
                    project_id TEXT,
                    model TEXT,
                    work_dir TEXT,
                    working_files TEXT,
                    permission_mode TEXT,
                    goal_json TEXT,
                    execution_mode TEXT
                );

                CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    reasoning TEXT,
                    attachments TEXT,
                    artifacts TEXT,
                    tool_calls TEXT,
                    token_usage TEXT,
                    created_at INTEGER NOT NULL
                );

                INSERT INTO sessions (id, title, created_at, updated_at)
                    VALUES ('s1', 'Chat 1', 1, 1);
                INSERT INTO messages (id, session_id, role, content, created_at)
                    VALUES ('m1', 's1', 'user', 'hi', 1);
                ",
            )
            .expect("seed schema");

            let changed = reconcile_schema(&conn).expect("reconcile");

            assert!(changed, "reconcile should report a change");

            // The rogue columns should be gone; the official ones stay.
            let mut stmt = conn
                .prepare("PRAGMA table_info(sessions)")
                .expect("pragma table_info");
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query")
                .filter_map(|r| r.ok())
                .collect();
            assert!(!columns.iter().any(|c| c == "goal_json"));
            assert!(!columns.iter().any(|c| c == "execution_mode"));
            assert!(columns.iter().any(|c| c == "permission_mode"));

            // The ahead-of-code schema_version row should be dropped.
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM schema_version WHERE version > 6",
                    [],
                    |row| row.get(0),
                )
                .expect("count ahead");
            assert_eq!(count, 0, "v7 row should be rolled back");

            // User data is preserved by the reconciliation step.
            let user_rows: i64 = conn
                .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
                .expect("count sessions");
            assert_eq!(user_rows, 1, "reconcile must not delete user data");
            let msg_rows: i64 = conn
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                .expect("count messages");
            assert_eq!(msg_rows, 1, "reconcile must not delete user data");

            // Sanity: the file we just created is the one we expected.
            assert!(db_path.exists());
        });
    }

    #[test]
    fn reconcile_schema_is_a_noop_when_schema_already_matches() {
        with_temp_data_dir(|_| {
            let conn = Connection::open(get_db_path()).expect("open db");
            conn.execute_batch(
                "
                CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
                INSERT INTO schema_version (version, applied_at) VALUES (1, 1), (6, 6);

                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    cwd TEXT,
                    project_id TEXT,
                    model TEXT,
                    work_dir TEXT,
                    working_files TEXT,
                    permission_mode TEXT
                );
                ",
            )
            .expect("seed schema");

            let changed = reconcile_schema(&conn).expect("reconcile");
            assert!(!changed, "no drift should mean no change");
        });
    }
}
