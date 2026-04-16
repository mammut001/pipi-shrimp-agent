use once_cell::sync::Lazy;
/**
 * Database module - SQLite persistence for sessions and messages
 */
use rusqlite::{params, Connection, Result as SqliteResult, Row};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

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
        artifacts: row.get(5)?,
        tool_calls: row.get(6)?,
        created_at: row.get(7)?,
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
    pub artifacts: Option<String>,
    pub tool_calls: Option<String>, // JSON-serialized Vec<ToolCall>
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
 * Get the database path in app data directory
 */
fn get_db_path() -> PathBuf {
    let app_data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pipi-shrimp-agent");

    std::fs::create_dir_all(&app_data_dir).ok();
    app_data_dir.join("data.db")
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

            // ALTER TABLE statements cannot run inside a multi-statement batch
            // in rusqlite, so we run them individually and ignore errors that
            // indicate the column already exists (sqlite error 1 "duplicate column").
            let alters = [
                "ALTER TABLE messages  ADD COLUMN reasoning TEXT",
                "ALTER TABLE messages  ADD COLUMN tool_calls TEXT",
                "ALTER TABLE sessions  ADD COLUMN project_id TEXT",
                "ALTER TABLE sessions  ADD COLUMN model TEXT",
                "ALTER TABLE sessions  ADD COLUMN work_dir TEXT",
                "ALTER TABLE sessions  ADD COLUMN working_files TEXT",
                "ALTER TABLE sessions  ADD COLUMN permission_mode TEXT",
                "ALTER TABLE projects  ADD COLUMN work_dir TEXT",
            ];
            for sql in &alters {
                let _ = conn.execute(sql, []);
            }

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
            // Add api_config_id column to token_usage for per-API-key tracking
            let _ = conn.execute(
                "ALTER TABLE token_usage ADD COLUMN api_config_id TEXT",
                [],
            );
            // Index for efficient per-key queries
            let _ = conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_token_usage_api_config ON token_usage(api_config_id)",
                [],
            );
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now'))",
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
    const LATEST_VERSION: i64 = 3;

    let db_path = get_db_path();
    println!("📂 Database path: {:?}", db_path);

    let conn = Connection::open(&db_path)?;

    // Bootstrap the version-tracking table on first run
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    ",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for v in (current_version + 1)..=(LATEST_VERSION) {
        println!("🚀 Applying database migration v{}", v);
        apply_migration(&conn, v)?;
    }

    // Initialize swarm snapshot table (always, regardless of version)
    init_swarm_table(&conn)?;

    println!(
        "✅ Database initialized successfully (schema v{})",
        LATEST_VERSION
    );

    // Store connection globally
    let mut db = DATABASE.lock().unwrap();
    *db = Some(conn);

    Ok(())
}

/**
 * Get the database connection
 */
#[allow(dead_code)]
pub fn get_connection() -> std::sync::MutexGuard<'static, Option<Connection>> {
    DATABASE.lock().unwrap()
}

/**
 * Save a session to database
 */
pub fn save_session(session: &DbSession) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
pub fn delete_session(session_id: &str) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
    }
    Ok(())
}

/**
 * Save a message to database
 */
pub fn save_message(message: &DbMessage) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO messages (id, session_id, role, content, reasoning, artifacts, tool_calls, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
                message.reasoning,
                message.artifacts,
                message.tool_calls,
                message.created_at
            ],
        )?;
    }
    Ok(())
}

/**
 * Delete a specific message by ID
 */
pub fn delete_message(message_id: &str) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
    }
    Ok(())
}

/**
 * Delete multiple messages by IDs
 */
pub fn delete_messages_by_ids(message_ids: &[String]) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut messages = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, reasoning, artifacts, tool_calls, created_at
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
pub fn delete_project(project_id: &str) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        // Delete all sessions in this project first
        conn.execute(
            "UPDATE sessions SET project_id = NULL WHERE project_id = ?1",
            params![project_id],
        )?;
        // Delete the project
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
    }
    Ok(())
}

/**
 * Update a project
 */
pub fn update_project(project: &DbProject) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
 */
pub fn save_token_usage(usage: &DbTokenUsage) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT INTO token_usage (id, session_id, date, input_tokens, output_tokens, model, api_config_id, created_at)
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
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
pub fn get_daily_token_stats(year_month: &str, api_config_id: Option<&str>) -> SqliteResult<Vec<DailyTokenStats>> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let pattern = format!("{}%", year_month);
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id {
            Some(config_id) => (
                "SELECT date, 
                        SUM(input_tokens) as total_input, 
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage 
                 WHERE date LIKE ?1 AND api_config_id = ?2
                 GROUP BY date 
                 ORDER BY date DESC".to_string(),
                vec![Box::new(pattern) as Box<dyn rusqlite::types::ToSql>, Box::new(config_id.to_string())],
            ),
            None => (
                "SELECT date, 
                        SUM(input_tokens) as total_input, 
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage 
                 WHERE date LIKE ?1
                 GROUP BY date 
                 ORDER BY date DESC".to_string(),
                vec![Box::new(pattern) as Box<dyn rusqlite::types::ToSql>],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id {
            Some(config_id) => (
                "SELECT SUBSTR(date, 1, 7) as month,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 WHERE api_config_id = ?1
                 GROUP BY month
                 ORDER BY month DESC".to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT SUBSTR(date, 1, 7) as month,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 GROUP BY month
                 ORDER BY month DESC".to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id {
            Some(config_id) => (
                "SELECT model,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 WHERE api_config_id = ?1
                 GROUP BY model
                 ORDER BY total DESC".to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT model,
                        SUM(input_tokens) as total_input,
                        SUM(output_tokens) as total_output,
                        SUM(input_tokens + output_tokens) as total
                 FROM token_usage
                 GROUP BY model
                 ORDER BY total DESC".to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
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
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();

    if let Some(conn) = guard.as_ref() {
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match api_config_id {
            Some(config_id) => (
                "SELECT COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0),
                        COALESCE(SUM(input_tokens + output_tokens), 0)
                 FROM token_usage
                 WHERE api_config_id = ?1".to_string(),
                vec![Box::new(config_id.to_string()) as Box<dyn rusqlite::types::ToSql>],
            ),
            None => (
                "SELECT COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0),
                        COALESCE(SUM(input_tokens + output_tokens), 0)
                 FROM token_usage".to_string(),
                vec![],
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
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
    let guard = DATABASE.lock().unwrap();
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
    let guard = DATABASE.lock().unwrap();
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
    let guard = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM swarm_snapshots", [])?;
    }
    Ok(())
}
