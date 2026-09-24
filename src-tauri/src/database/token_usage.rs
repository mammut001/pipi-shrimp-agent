use super::*;

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
