use crate::database::{
    clear_swarm_snapshots, delete_message, delete_project, delete_session,
    find_telegram_task_by_source, get_all_projects, get_all_sessions, get_daily_token_stats,
    get_database_diagnostics, get_messages_for_session, get_model_token_stats, get_monthly_token_stats, get_telegram_binding,
    get_telegram_runtime_state, get_telegram_task, get_total_token_stats, list_telegram_bindings,
    list_telegram_tasks_by_statuses, list_telegram_tasks_for_chat, load_swarm_snapshot,
    save_message, save_project, save_session, save_swarm_snapshot, save_telegram_binding,
    save_telegram_task, save_token_usage, set_telegram_runtime_state, update_project,
    DailyTokenStats, DbMessage, DbProject, DbSession, DbTelegramBinding, DbTelegramTask,
    DbDiagnostics, DbTokenUsage, ModelTokenStats,
};

#[tauri::command]
pub fn db_get_diagnostics() -> Result<DbDiagnostics, String> {
    get_database_diagnostics().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_session(session: DbSession) -> Result<(), String> {
    save_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_all_sessions() -> Result<Vec<DbSession>, String> {
    get_all_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_session(session_id: String) -> Result<(), String> {
    delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_message(message: DbMessage) -> Result<(), String> {
    save_message(&message).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_messages(session_id: String) -> Result<Vec<DbMessage>, String> {
    get_messages_for_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_message(message_id: String) -> Result<(), String> {
    delete_message(&message_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_messages_by_ids(messageIds: Vec<String>) -> Result<(), String> {
    crate::database::delete_messages_by_ids(&messageIds).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct CompactBoundaryPayload {
    id: String,
    content: String,
    subtype: String,
    compact_type: String,
    pre_compact_token_count: i32,
    post_compact_token_count: i32,
    summary_version: i64,
    created_at: i64,
    session_memory_path: Option<String>,
    preserved_segment: Option<serde_json::Value>,
    pre_compact_discovered_tools: Option<serde_json::Value>,
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_compact_boundary(
    sessionId: String,
    boundary: CompactBoundaryPayload,
) -> Result<(), String> {
    let artifacts = serde_json::to_string(&boundary).ok();
    let message = crate::database::DbMessage {
        id: boundary.id,
        session_id: sessionId,
        role: "system".to_string(),
        content: boundary.content,
        reasoning: None,
        artifacts,
        tool_calls: None,
        token_usage: None,
        created_at: boundary.created_at,
    };
    crate::database::save_message(&message).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_project(project: DbProject) -> Result<(), String> {
    save_project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_all_projects() -> Result<Vec<DbProject>, String> {
    get_all_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_project(project_id: String) -> Result<(), String> {
    delete_project(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_project(project: DbProject) -> Result<(), String> {
    update_project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_telegram_binding(binding: DbTelegramBinding) -> Result<(), String> {
    save_telegram_binding(&binding).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_telegram_binding(chat_id: i64) -> Result<Option<DbTelegramBinding>, String> {
    get_telegram_binding(chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_list_telegram_bindings() -> Result<Vec<DbTelegramBinding>, String> {
    list_telegram_bindings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_telegram_task(task: DbTelegramTask) -> Result<(), String> {
    save_telegram_task(&task).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_telegram_task(task_id: String) -> Result<Option<DbTelegramTask>, String> {
    get_telegram_task(&task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_find_telegram_task_by_source(
    chat_id: i64,
    source_message_id: i64,
) -> Result<Option<DbTelegramTask>, String> {
    find_telegram_task_by_source(chat_id, source_message_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_list_telegram_tasks_for_chat(
    chat_id: i64,
    limit: Option<i64>,
) -> Result<Vec<DbTelegramTask>, String> {
    let normalized_limit = normalize_positive_limit(limit);
    list_telegram_tasks_for_chat(chat_id, normalized_limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_list_telegram_tasks_by_statuses(
    statuses: Vec<String>,
    limit: Option<i64>,
) -> Result<Vec<DbTelegramTask>, String> {
    let normalized_limit = normalize_positive_limit(limit);
    list_telegram_tasks_by_statuses(&statuses, normalized_limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_telegram_runtime_state(key: String, value: String) -> Result<(), String> {
    set_telegram_runtime_state(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_telegram_runtime_state(key: String) -> Result<Option<String>, String> {
    get_telegram_runtime_state(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_token_usage(usage: DbTokenUsage) -> Result<(), String> {
    save_token_usage(&usage).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_daily_token_stats(
    year_month: String,
    api_config_id: Option<String>,
) -> Result<Vec<DailyTokenStats>, String> {
    get_daily_token_stats(&year_month, api_config_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_monthly_token_stats(
    api_config_id: Option<String>,
) -> Result<Vec<DailyTokenStats>, String> {
    get_monthly_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_model_token_stats(api_config_id: Option<String>) -> Result<Vec<ModelTokenStats>, String> {
    get_model_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_total_token_stats(api_config_id: Option<String>) -> Result<(i64, i64, i64), String> {
    get_total_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn swarm_save_snapshot(snapshot: serde_json::Value) -> Result<(), String> {
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let saved_at = chrono::Utc::now().timestamp();
    save_swarm_snapshot(&snapshot_json, saved_at).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn swarm_load_snapshot() -> Result<Option<serde_json::Value>, String> {
    let result = load_swarm_snapshot().map_err(|e| e.to_string())?;
    match result {
        Some(json_str) => {
            let value: serde_json::Value =
                serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn swarm_clear_snapshot() -> Result<(), String> {
    clear_swarm_snapshots().map_err(|e| e.to_string())
}

fn normalize_positive_limit(limit: Option<i64>) -> Option<usize> {
    limit.and_then(|value| if value > 0 { Some(value as usize) } else { None })
}
