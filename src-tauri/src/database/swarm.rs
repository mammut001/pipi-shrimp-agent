use super::*;

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
