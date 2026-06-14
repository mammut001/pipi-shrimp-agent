use crate::database::{self, DbMessage, DbSession};
use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionData {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub cwd: Option<String>,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub attachments: Option<String>,
    pub artifacts: Option<String>,
    pub tool_calls: Option<String>,
    pub token_usage: Option<String>,
    pub tool_call_id: Option<String>,
    pub timestamp: u64,
}

pub(crate) fn get_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn new_session_record(session_id: String, timestamp: i64) -> DbSession {
    DbSession {
        id: session_id,
        title: "New Chat".to_string(),
        created_at: timestamp,
        updated_at: timestamp,
        cwd: None,
        project_id: None,
        model: None,
        work_dir: None,
        working_files: None,
        permission_mode: Some("standard".to_string()),
        // Two-folder model: leave the new columns null on first
        // creation. `project_dir` falls back to `work_dir` (the legacy
        // mirror) on read, and `pipi_output_dir` falls back to the
        // app-managed `{Documents|HOME}/PiPi-Shrimp/chats/{id}/`
        // computed by `get_app_default_dir` on the JS side.
        project_dir: None,
        pipi_output_dir: None,
    }
}

fn db_session_to_session_data(db_session: DbSession) -> AppResult<SessionData> {
    let messages = database::get_messages_for_session(&db_session.id)
        .map_err(|e| AppError::InternalError(format!("Failed to get messages: {}", e)))?
        .into_iter()
        .map(|message| Message {
            role: message.role,
            content: message.content,
            reasoning: message.reasoning,
            attachments: message.attachments,
            artifacts: message.artifacts,
            tool_calls: message.tool_calls,
            token_usage: message.token_usage,
            tool_call_id: None,
            timestamp: message.created_at as u64,
        })
        .collect();

    Ok(SessionData {
        id: db_session.id,
        title: db_session.title,
        created_at: db_session.created_at as u64,
        updated_at: db_session.updated_at as u64,
        cwd: db_session.cwd,
        messages,
    })
}

pub async fn start_session_service() -> AppResult<String> {
    let session_id = Uuid::new_v4().to_string();
    let timestamp = get_timestamp() as i64;
    let session = new_session_record(session_id.clone(), timestamp);

    database::save_session(&session)
        .map_err(|e| AppError::InternalError(format!("Failed to save session: {}", e)))?;

    println!("📝 Created new session in database: {}", session_id);
    Ok(session_id)
}

pub async fn send_message_service(req: SendMessageRequest) -> AppResult<SendMessageResponse> {
    let timestamp = get_timestamp() as i64;
    let message_id = Uuid::new_v4().to_string();

    let user_message = DbMessage {
        id: message_id,
        session_id: req.session_id.clone(),
        role: "user".to_string(),
        content: req.content,
        reasoning: None,
        attachments: None,
        artifacts: None,
        tool_calls: None,
        token_usage: None,
        created_at: timestamp,
    };

    database::save_message(&user_message)
        .map_err(|e| AppError::InternalError(format!("Failed to save user message: {}", e)))?;

    if let Ok(sessions) = database::get_all_sessions() {
        if let Some(session) = sessions.iter().find(|session| session.id == req.session_id) {
            let mut updated_session = session.clone();
            updated_session.updated_at = timestamp;
            let _ = database::save_session(&updated_session);
        }
    }

    Ok(SendMessageResponse {
        id: Uuid::new_v4().to_string(),
        content: String::new(),
        artifacts: vec![],
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn save_message_to_db_service(
    session_id: String,
    role: String,
    content: String,
    reasoning: Option<String>,
    attachments: Option<String>,
    artifacts: Option<String>,
    tool_calls: Option<String>,
    token_usage: Option<String>,
) -> AppResult<String> {
    let timestamp = get_timestamp() as i64;
    let message_id = Uuid::new_v4().to_string();

    let message = DbMessage {
        id: message_id.clone(),
        session_id,
        role,
        content,
        reasoning,
        attachments,
        artifacts,
        tool_calls,
        token_usage,
        created_at: timestamp,
    };

    database::save_message(&message)
        .map_err(|e| AppError::InternalError(format!("Failed to save message: {}", e)))?;

    Ok(message_id)
}

pub async fn get_session_service(session_id: String) -> AppResult<String> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    let session = sessions
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| AppError::NotFound(format!("Session {} not found", session_id)))?;

    let session_data = db_session_to_session_data(session)?;

    serde_json::to_string(&session_data)
        .map_err(|e| AppError::InternalError(format!("Failed to serialize session: {}", e)))
}

pub async fn list_sessions_service() -> AppResult<Vec<SessionData>> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    let mut result = Vec::new();
    for session in sessions {
        result.push(SessionData {
            id: session.id,
            title: session.title,
            created_at: session.created_at as u64,
            updated_at: session.updated_at as u64,
            cwd: session.cwd,
            messages: vec![],
        });
    }

    result.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(result)
}

pub async fn delete_session_service(session_id: String) -> AppResult<()> {
    database::delete_session(&session_id)
        .map_err(|e| AppError::InternalError(format!("Failed to delete session: {}", e)))?;

    println!("🗑️ Deleted session: {}", session_id);
    Ok(())
}

pub async fn reset_token_estimate_service() -> AppResult<()> {
    database::delete_all_token_usage()
        .map_err(|e| AppError::InternalError(format!("Failed to reset token estimate: {}", e)))?;

    println!("🔄 Token estimate reset successfully");
    Ok(())
}

pub async fn update_session_title_service(session_id: String, title: String) -> AppResult<()> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    if let Some(mut session) = sessions
        .into_iter()
        .find(|session| session.id == session_id)
    {
        session.title = title;
        session.updated_at = get_timestamp() as i64;
        database::save_session(&session)
            .map_err(|e| AppError::InternalError(format!("Failed to update session: {}", e)))?;
    }

    Ok(())
}

pub async fn update_session_cwd_service(session_id: String, cwd: String) -> AppResult<()> {
    let sessions = database::get_all_sessions()
        .map_err(|e| AppError::InternalError(format!("Failed to get sessions: {}", e)))?;

    if let Some(mut session) = sessions
        .into_iter()
        .find(|session| session.id == session_id)
    {
        // Two-folder model: `cwd` is the Project Folder. Mirror it into
        // both `project_dir` and `work_dir` so JS code that hasn't yet
        // been migrated (legacy `workDir` consumers, the v7 SELECT
        // projection, etc.) keeps working. `pipi_output_dir` stays
        // untouched here — the chat store manages it separately.
        session.work_dir = Some(cwd.clone());
        session.project_dir = Some(cwd);
        session.updated_at = get_timestamp() as i64;
        database::save_session(&session)
            .map_err(|e| AppError::InternalError(format!("Failed to update cwd: {}", e)))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_session_record_uses_expected_defaults() {
        let session = new_session_record("session-1".to_string(), 123);

        assert_eq!(session.id, "session-1");
        assert_eq!(session.title, "New Chat");
        assert_eq!(session.created_at, 123);
        assert_eq!(session.updated_at, 123);
        assert_eq!(session.permission_mode.as_deref(), Some("standard"));
        assert!(session.work_dir.is_none());
    }
}
