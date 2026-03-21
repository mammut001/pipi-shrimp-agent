/**
 * Database module - SQLite persistence for sessions and messages
 */

use rusqlite::{Connection, Result as SqliteResult, params, Row};
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

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
        permission_mode: row.get(9)?,  // NEW: session permission mode
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
fn row_to_token_usage(row: &Row) -> SqliteResult<DbTokenUsage> {
    Ok(DbTokenUsage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        date: row.get(2)?,
        input_tokens: row.get(3)?,
        output_tokens: row.get(4)?,
        model: row.get(5)?,
        created_at: row.get(6)?,
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
    pub work_dir: Option<String>,    // each session's work directory
    pub working_files: Option<String>, // JSON serialized ImportedFile[]
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
    pub tool_calls: Option<String>,  // JSON-serialized Vec<ToolCall>
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
    pub work_dir: Option<String>,   // NEW: path to local work directory
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
    pub date: String,  // YYYY-MM-DD format
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub model: String,
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
 * Initialize the database connection and create tables
 */
pub fn init_database() -> SqliteResult<()> {
    let db_path = get_db_path();
    println!("📂 Database path: {:?}", db_path);

    let conn = Connection::open(&db_path)?;

    // Create sessions table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            cwd TEXT,
            project_id TEXT,
            model TEXT,
            work_dir TEXT,
            working_files TEXT
        )",
        [],
    )?;

    // Create messages table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            reasoning TEXT,
            artifacts TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Handle migration: add reasoning column if it doesn't exist
    // Use pragmas for better compatibility
    let column_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "reasoning" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !column_exists {
        println!("🚀 Migrating database: adding 'reasoning' column to 'messages' table");
        // Ignore error if it somehow exists (e.g. race condition)
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN reasoning TEXT", []);
    }

    // Migration: add tool_calls column to messages table
    let tool_calls_col_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "tool_calls" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !tool_calls_col_exists {
        println!("🚀 Migrating database: adding 'tool_calls' column to 'messages' table");
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN tool_calls TEXT", []);
    }

    // Create index for faster message lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)",
        [],
    )?;

    // Check if project_id column exists in sessions table
    let project_id_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "project_id" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !project_id_exists {
        println!("🚀 Migrating database: adding 'project_id' column to 'sessions' table");
        // Ignore error if it somehow exists (e.g. race condition)
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN project_id TEXT", []);
    }

    // Check if model column exists in sessions table
    let model_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "model" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !model_exists {
        println!("🚀 Migrating database: adding 'model' column to 'sessions' table");
        // Ignore error if it somehow exists (e.g. race condition)
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN model TEXT", []);
    }

    // Migration: add work_dir column to sessions table for existing installs
    let sessions_work_dir_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "work_dir" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !sessions_work_dir_exists {
        println!("🚀 Migrating database: adding 'work_dir' column to 'sessions' table");
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN work_dir TEXT", []);
    }

    // Migration: add working_files column to sessions table
    let sessions_working_files_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "working_files" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !sessions_working_files_exists {
        println!("🚀 Migrating database: adding 'working_files' column to 'sessions' table");
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN working_files TEXT", []);
    }

    // Migration: add permission_mode column to sessions table
    let sessions_permission_mode_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "permission_mode" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !sessions_permission_mode_exists {
        println!("🚀 Migrating database: adding 'permission_mode' column to 'sessions' table");
        let _ = conn.execute("ALTER TABLE sessions ADD COLUMN permission_mode TEXT", []);
    }

    // Create projects table (work_dir included from the start for new installs)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Migration: add work_dir column for existing installs that pre-date this column.
    // Must run AFTER the CREATE TABLE above so the table is guaranteed to exist.
    let work_dir_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(projects)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in rows {
            if let Ok(name) = name {
                if name == "work_dir" {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if !work_dir_exists {
        println!("🚀 Migrating database: adding 'work_dir' column to 'projects' table");
        let _ = conn.execute("ALTER TABLE projects ADD COLUMN work_dir TEXT", []);
    }

    // Create index for faster lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)",
        [],
    )?;

    // Create token_usage table for tracking token consumption
    conn.execute(
        "CREATE TABLE IF NOT EXISTS token_usage (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            date TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            model TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create indexes for faster token stats queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(date)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model)",
        [],
    )?;

    println!("✅ Database initialized successfully");

    // Store connection globally
    let mut db = DATABASE.lock().unwrap();
    *db = Some(conn);

    Ok(())
}

/**
 * Get the database connection
 */
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
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])?;
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
 * Get all messages for a session
 */
pub fn get_messages_for_session(session_id: &str) -> SqliteResult<Vec<DbMessage>> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut messages = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, reasoning, artifacts, tool_calls, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
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
pub fn clear_messages_for_session(session_id: &str) -> SqliteResult<()> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])?;
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
        conn.execute("UPDATE sessions SET project_id = NULL WHERE project_id = ?1", params![project_id])?;
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
            "INSERT INTO token_usage (id, session_id, date, input_tokens, output_tokens, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                usage.id,
                usage.session_id,
                usage.date,
                usage.input_tokens,
                usage.output_tokens,
                usage.model,
                usage.created_at
            ],
        )?;
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
pub fn get_daily_token_stats(year_month: &str) -> SqliteResult<Vec<DailyTokenStats>> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT date, 
                    SUM(input_tokens) as total_input, 
                    SUM(output_tokens) as total_output,
                    SUM(input_tokens + output_tokens) as total
             FROM token_usage 
             WHERE date LIKE ?1 
             GROUP BY date 
             ORDER BY date DESC"
        )?;

        let pattern = format!("{}%", year_month);
        let rows = stmt.query_map(params![pattern], |row| {
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
pub fn get_monthly_token_stats() -> SqliteResult<Vec<DailyTokenStats>> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT SUBSTR(date, 1, 7) as month,
                    SUM(input_tokens) as total_input,
                    SUM(output_tokens) as total_output,
                    SUM(input_tokens + output_tokens) as total
             FROM token_usage
             GROUP BY month
             ORDER BY month DESC"
        )?;

        let rows = stmt.query_map([], |row| {
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
pub fn get_model_token_stats() -> SqliteResult<Vec<ModelTokenStats>> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();
    let mut stats = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT model,
                    SUM(input_tokens) as total_input,
                    SUM(output_tokens) as total_output,
                    SUM(input_tokens + output_tokens) as total
             FROM token_usage
             GROUP BY model
             ORDER BY total DESC"
        )?;

        let rows = stmt.query_map([], |row| {
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
pub fn get_total_token_stats() -> SqliteResult<(i64, i64, i64)> {
    let guard: std::sync::MutexGuard<Option<Connection>> = DATABASE.lock().unwrap();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(input_tokens + output_tokens), 0)
             FROM token_usage"
        )?;

        let row = stmt.query_row([], |row| {
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
