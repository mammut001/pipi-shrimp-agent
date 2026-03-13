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
        artifacts: row.get(4)?,
        created_at: row.get(5)?,
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
    pub artifacts: Option<String>,
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
            cwd TEXT
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
            artifacts TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index for faster message lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)",
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
    let guard = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, title, created_at, updated_at, cwd)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session.id, session.title, session.created_at, session.updated_at, session.cwd],
        )?;
    }
    Ok(())
}

/**
 * Get all sessions from database
 */
pub fn get_all_sessions() -> SqliteResult<Vec<DbSession>> {
    let guard = DATABASE.lock().unwrap();
    let mut sessions = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, cwd FROM sessions ORDER BY updated_at DESC"
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
    let guard = DATABASE.lock().unwrap();
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
    let guard = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO messages (id, session_id, role, content, artifacts, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
                message.artifacts,
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
    let guard = DATABASE.lock().unwrap();
    let mut messages = Vec::new();

    if let Some(conn) = guard.as_ref() {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, artifacts, created_at
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
    let guard = DATABASE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])?;
    }
    Ok(())
}
