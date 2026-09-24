use super::*;

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
