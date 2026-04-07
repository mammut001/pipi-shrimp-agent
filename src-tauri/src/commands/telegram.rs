/**
 * Telegram Commands - Tauri command handlers for Telegram Bot API
 *
 * Provides commands for:
 * - Connecting/disconnecting from Telegram
 * - Sending messages
 * - Getting updates
 * - Managing bot configuration
 */

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::Duration;

/// Telegram bot information from getMe
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramBotInfo {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    pub username: String,
    pub can_join_groups: bool,
    pub can_read_all_group_messages: bool,
    pub supports_inline_queries: bool,
    #[serde(default)]
    pub can_connect_to_business: bool,
    #[serde(default)]
    pub has_main_web_app: bool,
}

/// Telegram connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error,
    Reconnecting,
}

/// Telegram message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramMessage {
    pub message_id: i64,
    pub date: i64,
    pub chat: TelegramChat,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<TelegramUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
}

/// Telegram chat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
}

/// Telegram user
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramUser {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
}

/// Telegram API error response
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramApiError {
    ok: bool,
    description: Option<String>,
}

/// Telegram getUpdates response
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetUpdatesResponse {
    ok: bool,
    result: Vec<Update>,
}

/// Telegram update
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Update {
    update_id: i64,
    #[serde(default)]
    message: Option<TelegramMessage>,
}

/// Telegram state managed by the app
pub struct TelegramState {
    pub status: ConnectionStatus,
    pub bot_info: Option<TelegramBotInfo>,
    pub token: Option<String>,
    pub offset: i64,
    pub error: Option<String>,
}

impl Default for TelegramState {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            bot_info: None,
            token: None,
            offset: 0,
            error: None,
        }
    }
}

/// Make HTTP request to Telegram API
#[allow(dead_code)]
async fn telegram_api_request<T: for<'de> Deserialize<'de>>(
    token: &str,
    method: &str,
) -> Result<T, String> {
    let url = format!("https://api.telegram.org/bot{}/{}", token, method);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    response
        .json::<T>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Connect to Telegram with a bot token
#[tauri::command]
pub async fn telegram_connect(
    token: String,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<TelegramBotInfo, String> {
    let trimmed_token = token.trim();
    if trimmed_token.is_empty() {
        return Err("Token is required".to_string());
    }

    // Update state to connecting
    {
        let mut s = state.lock().await;
        s.status = ConnectionStatus::Connecting;
        s.error = None;
    }

    // Validate token by calling getMe
    let url = format!(
        "https://api.telegram.org/bot{}/getMe",
        trimmed_token
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        {
            let mut s = state.lock().await;
            s.status = ConnectionStatus::Error;
            s.error = Some("Invalid bot token".to_string());
        }
        return Err("Invalid bot token".to_string());
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        {
            let mut s = state.lock().await;
            s.status = ConnectionStatus::Error;
            s.error = Some(format!("API error: {}", body));
        }
        return Err(format!("API error: {}", body));
    }

    let bot_info: TelegramBotInfo = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse bot info: {}", e))?;

    // Update state with successful connection
    {
        let mut s = state.lock().await;
        s.status = ConnectionStatus::Connected;
        s.bot_info = Some(bot_info.clone());
        s.token = Some(trimmed_token.to_string());
        s.offset = 0;
    }

    println!("✅ Telegram bot connected: @{}", bot_info.username);
    Ok(bot_info)
}

/// Disconnect from Telegram
#[tauri::command]
pub async fn telegram_disconnect(
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let mut s = state.lock().await;
    s.status = ConnectionStatus::Disconnected;
    s.bot_info = None;
    s.token = None;
    s.offset = 0;
    s.error = None;

    println!("🔌 Telegram bot disconnected");
    Ok(())
}

/// Send a message to a chat
#[tauri::command]
pub async fn telegram_send_message(
    chat_id: i64,
    text: String,
    reply_to_message_id: Option<i64>,
    parse_mode: Option<String>,
    disable_web_page_preview: Option<bool>,
    disable_notification: Option<bool>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<TelegramMessage, String> {
    let s = state.lock().await;

    let token = s.token.clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    if s.status != ConnectionStatus::Connected {
        return Err("Telegram bot is not connected".to_string());
    }

    drop(s); // Release lock before HTTP request

    // Build URL with query parameters
    let mut url = format!(
        "https://api.telegram.org/bot{}/sendMessage?chat_id={}&text={}",
        token,
        chat_id,
        urlencoding::encode(&text)
    );

    if let Some(reply_to) = reply_to_message_id {
        url.push_str(&format!("&reply_to_message_id={}", reply_to));
    }

    if let Some(mode) = parse_mode {
        url.push_str(&format!("&parse_mode={}", urlencoding::encode(&mode)));
    }

    if disable_web_page_preview.unwrap_or(false) {
        url.push_str("&disable_web_page_preview=true");
    }

    if disable_notification.unwrap_or(false) {
        url.push_str("&disable_notification=true");
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to send message: {}", body));
    }

    #[allow(dead_code)]
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SendMessageResponse {
        ok: bool,
        result: TelegramMessage,
    }

    let send_response: SendMessageResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(send_response.result)
}

/// Get current connection status
#[tauri::command]
pub async fn telegram_get_status(
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<ConnectionStatus, String> {
    let s = state.lock().await;
    Ok(s.status.clone())
}

/// Get bot information
#[tauri::command]
pub async fn telegram_get_bot_info(
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<Option<TelegramBotInfo>, String> {
    let s = state.lock().await;
    Ok(s.bot_info.clone())
}

/// Validate a bot token without connecting
#[tauri::command]
pub async fn telegram_validate_token(
    token: String,
) -> Result<TelegramBotInfo, String> {
    let trimmed_token = token.trim();
    if trimmed_token.is_empty() {
        return Err("Token is required".to_string());
    }

    let url = format!("https://api.telegram.org/bot{}/getMe", trimmed_token);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid bot token".to_string());
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", body));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Get pending messages count
#[tauri::command]
pub async fn telegram_get_pending_count(
    _state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<i64, String> {
    // For now, return 0 as we don't track pending messages
    // This can be expanded to track messages awaiting response
    Ok(0)
}

/// Send typing indicator
#[tauri::command]
pub async fn telegram_send_typing(
    chat_id: i64,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    telegram_send_chat_action(chat_id, "typing".to_string(), state).await
}

/// Send a chat action (typing, uploading, etc.)
#[tauri::command]
pub async fn telegram_send_chat_action(
    chat_id: i64,
    action: String,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let s = state.lock().await;

    let token = s.token.clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    if s.status != ConnectionStatus::Connected {
        return Err("Telegram bot is not connected".to_string());
    }

    drop(s);

    let url = format!(
        "https://api.telegram.org/bot{}/sendChatAction?chat_id={}&action={}",
        token,
        chat_id,
        urlencoding::encode(&action)
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to send chat action: {}", body));
    }

    Ok(())
}

/// Answer a callback query
#[tauri::command]
pub async fn telegram_answer_callback_query(
    callback_query_id: String,
    text: Option<String>,
    url: Option<String>,
    show_alert: Option<bool>,
    cache_time: Option<i64>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let s = state.lock().await;

    let token = s.token.clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    if s.status != ConnectionStatus::Connected {
        return Err("Telegram bot is not connected".to_string());
    }

    drop(s);

    let mut params = format!(
        "callback_query_id={}",
        urlencoding::encode(&callback_query_id)
    );

    if let Some(t) = text {
        params.push_str(&format!("&text={}", urlencoding::encode(&t)));
    }

    if let Some(u) = url {
        params.push_str(&format!("&url={}", urlencoding::encode(&u)));
    }

    if show_alert.unwrap_or(false) {
        params.push_str("&show_alert=true");
    }

    if let Some(ct) = cache_time {
        params.push_str(&format!("&cache_time={}", ct));
    }

    let url = format!(
        "https://api.telegram.org/bot{}/answerCallbackQuery?{}",
        token, params
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to answer callback query: {}", body));
    }

    Ok(())
}

/// Get file URL
#[tauri::command]
pub async fn telegram_get_file_url(
    file_id: String,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<String, String> {
    let s = state.lock().await;

    let token = s.token.clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    drop(s);

    #[allow(dead_code)]
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GetFileResponse {
        ok: bool,
        result: FileResult,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FileResult {
        file_path: String,
    }

    let url = format!(
        "https://api.telegram.org/bot{}/getFile?file_id={}",
        token,
        urlencoding::encode(&file_id)
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get file: {}", body));
    }

    let file_response: GetFileResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Construct the full file URL
    let file_url = format!(
        "https://api.telegram.org/file/bot{}/{}",
        token,
        file_response.result.file_path
    );

    Ok(file_url)
}

/// Get updates (for debugging)
#[tauri::command]
pub async fn telegram_get_updates(
    offset: Option<i64>,
    limit: Option<i64>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<Vec<TelegramMessage>, String> {
    let s = state.lock().await;

    let token = s.token.clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    drop(s);

    let mut url = format!(
        "https://api.telegram.org/bot{}/getUpdates?timeout=0",
        token
    );

    if let Some(off) = offset {
        url.push_str(&format!("&offset={}", off));
    }

    if let Some(lim) = limit {
        url.push_str(&format!("&limit={}", lim.min(100)));
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get updates: {}", body));
    }

    let updates_response: GetUpdatesResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(updates_response
        .result
        .into_iter()
        .filter_map(|u| u.message)
        .collect())
}
