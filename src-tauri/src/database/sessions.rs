use super::*;

/**
 * Save a session to database
 */
pub fn save_session(session: &DbSession) -> SqliteResult<()> {
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, title, created_at, updated_at, cwd, project_id, model, work_dir, working_files, permission_mode, project_dir, pipi_output_dir, execution_mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                session.id,
                session.title,
                session.created_at,
                session.updated_at,
                session.cwd,
                session.project_id,
                session.model,
                session.work_dir,
                session.working_files,
                session.permission_mode,
                session.project_dir,
                session.pipi_output_dir,
                session.execution_mode,
            ],
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
        // Two-folder model: project the v7 columns (project_dir,
        // pipi_output_dir) as NULL when they're missing so a pre-v7 row
        // still maps cleanly. The migration backfills project_dir from
        // work_dir so the JS-side `getSessionProjectDir` helper has a
        // non-null value as soon as v7 has run.
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, cwd, project_id, model, work_dir, working_files, permission_mode, project_dir, pipi_output_dir, execution_mode FROM sessions ORDER BY updated_at DESC"
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
 * Save multiple messages in a single SQLite transaction.
 *
 * Used by hydrate terminalize so scrubbed orphan tool_calls and the
 * interrupted notice land together — a crash mid-batch cannot leave
 * scrubbed rows without the notice (or the reverse).
 */
pub fn save_messages(messages: &[DbMessage]) -> SqliteResult<()> {
    if messages.is_empty() {
        return Ok(());
    }
    let guard = get_db()?;
    if let Some(conn) = guard.as_ref() {
        conn.execute_batch("BEGIN")?;
        let result = (|| -> SqliteResult<()> {
            for message in messages {
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
