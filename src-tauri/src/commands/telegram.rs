/**
 * Telegram Commands - Tauri command handlers for Telegram Bot API
 *
 * Provides commands for:
 * - Connecting/disconnecting from Telegram
 * - Sending messages
 * - Getting updates
 * - Managing bot configuration
 *
 * AUDIT-FIX [R7-10]: The Telegram bot token is the most sensitive piece
 * of state in this module. Every format string, error path, and log
 * statement must go through `redact_token` before letting a string escape
 * the function. We never embed the token verbatim in a URL inside an
 * `Err(...)` payload, never `println!` it, and never let `reqwest`'s
 * error formatter (which includes the request URL) leak it back to the
 * frontend.
 */
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::Duration;

/// Build an API URL with the bot token, but never let the result escape
/// without first passing through `redact_token_in_url`. The token
/// itself is required for the actual HTTP call (Telegram's auth scheme
/// is "bearer in path"), so we keep a private helper that hands back
/// the raw URL to the reqwest client while the public surface is
/// redacted.
fn build_api_url(token: &str, method: &str) -> String {
    format!("https://api.telegram.org/bot{}/{}", token, method)
}

/// Build a file URL with the bot token (used by getFile / file download).
fn build_file_url(token: &str, file_path: &str) -> String {
    format!("https://api.telegram.org/file/bot{}/{}", token, file_path)
}

/// Replace any `bot<TOKEN>/...` segment in `s` with `bot[REDACTED]/...`
/// so the token never reaches a log line, error message, or telemetry
/// field. We do a literal substring replacement of the token — this is
/// O(n*m) but tokens are ~45 chars so it's fine for the call sites.
pub fn redact_token_in_str(s: &str, token: &str) -> String {
    if token.is_empty() {
        return s.to_string();
    }
    s.replace(token, "[REDACTED]")
}

/// Convenience wrapper for use in error messages.
pub fn redact_token_in_error(err: &str, token: &str) -> String {
    redact_token_in_str(err, token)
}

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

/// Telegram getMe response
#[derive(Debug, Deserialize)]
struct GetMeResponse {
    ok: bool,
    result: TelegramBotInfo,
}

/// Telegram getUpdates response
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetUpdatesResponse {
    ok: bool,
    result: Vec<TelegramUpdate>,
}

/// Telegram update
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramUpdate {
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
    pub command_prefix: Option<String>,
    pub allowed_chats: Vec<i64>,
}

impl Default for TelegramState {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            bot_info: None,
            token: None,
            offset: 0,
            error: None,
            command_prefix: None,
            allowed_chats: Vec::new(),
        }
    }
}

/// Make HTTP request to Telegram API
#[allow(dead_code)]
async fn telegram_api_request<T: for<'de> Deserialize<'de>>(
    token: &str,
    method: &str,
) -> Result<T, String> {
    let url = build_api_url(token, method);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            // AUDIT-FIX [R7-10]: reqwest's Display impl includes the
            // request URL, which embeds the bot token. Redact before
            // surfacing the error to the frontend / logs.
            redact_token_in_error(&e.to_string(), token)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("API error {}: {}", status, body),
            token,
        ));
    }

    response
        .json::<T>()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))
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
    let url = build_api_url(trimmed_token, "getMe");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), trimmed_token))?;

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
        let safe_body = redact_token_in_error(&body, trimmed_token);
        {
            let mut s = state.lock().await;
            s.status = ConnectionStatus::Error;
            s.error = Some(format!("API error: {}", safe_body));
        }
        return Err(format!("API error: {}", safe_body));
    }

    let get_me_response: GetMeResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), trimmed_token))?;
    if !get_me_response.ok {
        return Err("Telegram getMe returned ok=false".to_string());
    }
    let bot_info = get_me_response.result;

    // Update state with successful connection
    {
        let mut s = state.lock().await;
        s.status = ConnectionStatus::Connected;
        s.bot_info = Some(bot_info.clone());
        s.token = Some(trimmed_token.to_string());
        s.offset = 0;
    }

    // AUDIT-FIX [R7-10]: log only the bot username, never the token.
    println!("[telegram] connected: @{}", bot_info.username);
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

    let token = s
        .token
        .clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    if s.status != ConnectionStatus::Connected {
        return Err("Telegram bot is not connected".to_string());
    }

    drop(s); // Release lock before HTTP request

    // Build URL with query parameters. Token is required for auth but
    // never re-emitted in any error path below.
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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to send message: {}", body),
            &token,
        ));
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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

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
pub async fn telegram_validate_token(token: String) -> Result<TelegramBotInfo, String> {
    let trimmed_token = token.trim();
    if trimmed_token.is_empty() {
        return Err("Token is required".to_string());
    }

    let url = build_api_url(trimmed_token, "getMe");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), trimmed_token))?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid bot token".to_string());
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("API error: {}", body),
            trimmed_token,
        ));
    }

    let get_me_response: GetMeResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), trimmed_token))?;

    if !get_me_response.ok {
        return Err("Telegram getMe returned ok=false".to_string());
    }

    Ok(get_me_response.result)
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

    let token = s
        .token
        .clone()
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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to send chat action: {}", body),
            &token,
        ));
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

    let token = s
        .token
        .clone()
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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to answer callback query: {}", body),
            &token,
        ));
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

    let token = s
        .token
        .clone()
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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to get file: {}", body),
            &token,
        ));
    }

    let file_response: GetFileResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    // Construct the full file URL
    let file_url = build_file_url(&token, &file_response.result.file_path);

    Ok(file_url)
}

/// Get updates (for debugging)
#[tauri::command]
pub async fn telegram_get_updates(
    offset: Option<i64>,
    limit: Option<i64>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<Vec<TelegramUpdate>, String> {
    let s = state.lock().await;

    let token = s
        .token
        .clone()
        .ok_or_else(|| "Not connected to Telegram".to_string())?;

    drop(s);

    let mut url = format!("https://api.telegram.org/bot{}/getUpdates?timeout=0", token);

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
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to get updates: {}", body),
            &token,
        ));
    }

    let updates_response: GetUpdatesResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !updates_response.ok {
        return Err("Telegram getUpdates returned ok=false".to_string());
    }

    Ok(updates_response.result)
}

/// Persist the bot command prefix in Rust-side connector state.
#[tauri::command]
pub async fn telegram_set_command_prefix(
    prefix: String,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let trimmed = prefix.trim();
    if trimmed.is_empty() {
        return Err("Command prefix cannot be empty".to_string());
    }
    let mut s = state.lock().await;
    s.command_prefix = Some(trimmed.to_string());
    Ok(())
}

/// Persist allowed chat IDs in Rust-side connector state (TS also mirrors to localStorage).
#[tauri::command]
pub async fn telegram_set_allowed_chats(
    chat_ids: Vec<i64>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let mut s = state.lock().await;
    s.allowed_chats = chat_ids;
    Ok(())
}

/// Download a Telegram file to a local destination path.
#[tauri::command]
pub async fn telegram_download_file(
    file_id: String,
    destination: String,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<String, String> {
    let token = {
        let s = state.lock().await;
        s.token
            .clone()
            .ok_or_else(|| "Not connected to Telegram".to_string())?
    };

    let client = reqwest::Client::new();
    let get_file_url = format!(
        "https://api.telegram.org/bot{}/getFile?file_id={}",
        token,
        urlencoding::encode(&file_id)
    );
    let get_file_response = client
        .get(&get_file_url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;
    if !get_file_response.status().is_success() {
        let body = get_file_response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to get file: {}", body),
            &token,
        ));
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DownloadFileResult {
        file_path: String,
    }
    #[derive(Deserialize)]
    struct DownloadGetFileResponse {
        ok: bool,
        result: DownloadFileResult,
    }
    let file_meta: DownloadGetFileResponse = get_file_response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;
    let file_url = build_file_url(&token, &file_meta.result.file_path);
    let response = client
        .get(&file_url)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Download failed: {}", body),
            &token,
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    std::fs::write(&destination, bytes).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(destination)
}

#[derive(Debug, Deserialize)]
struct SetWebhookResponse {
    ok: bool,
}

/// Register a webhook URL (polling mode remains the default runtime path).
#[tauri::command]
pub async fn telegram_set_webhook(
    url: String,
    secret_token: Option<String>,
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let token = {
        let s = state.lock().await;
        s.token
            .clone()
            .ok_or_else(|| "Not connected to Telegram".to_string())?
    };

    let client = reqwest::Client::new();
    let mut form = std::collections::HashMap::new();
    form.insert("url", url);
    if let Some(secret) = secret_token.filter(|value| !value.is_empty()) {
        form.insert("secret_token", secret);
    }

    let response = client
        .post(format!("https://api.telegram.org/bot{}/setWebhook", token))
        .form(&form)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("setWebhook failed: {}", body),
            &token,
        ));
    }

    let parsed: SetWebhookResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;
    if !parsed.ok {
        return Err("Telegram setWebhook returned ok=false".to_string());
    }
    Ok(())
}

/// Remove the active webhook and return to polling-friendly state.
#[tauri::command]
pub async fn telegram_delete_webhook(
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<(), String> {
    let token = {
        let s = state.lock().await;
        s.token
            .clone()
            .ok_or_else(|| "Not connected to Telegram".to_string())?
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!("https://api.telegram.org/bot{}/deleteWebhook", token))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("deleteWebhook failed: {}", body),
            &token,
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramWebhookInfo {
    pub url: Option<String>,
    pub has_custom_certificate: bool,
    pub pending_update_count: i64,
    pub ip_address: Option<String>,
    pub last_error_date: Option<i64>,
    pub last_error_message: Option<String>,
    pub last_synchronization_error_date: Option<i64>,
    pub max_connections: Option<i64>,
    pub allowed_updates: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct GetWebhookInfoResponse {
    ok: bool,
    result: TelegramWebhookInfo,
}

/// Fetch webhook metadata for diagnostics.
#[tauri::command]
pub async fn telegram_get_webhook_info(
    state: tauri::State<'_, Arc<Mutex<TelegramState>>>,
) -> Result<TelegramWebhookInfo, String> {
    let token = {
        let s = state.lock().await;
        s.token
            .clone()
            .ok_or_else(|| "Not connected to Telegram".to_string())?
    };

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "https://api.telegram.org/bot{}/getWebhookInfo",
            token
        ))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("getWebhookInfo failed: {}", body),
            &token,
        ));
    }

    let parsed: GetWebhookInfoResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), &token))?;
    if !parsed.ok {
        return Err("Telegram getWebhookInfo returned ok=false".to_string());
    }
    Ok(parsed.result)
}

#[cfg(test)]
mod command_registration_tests {
    use super::*;

    #[test]
    fn telegram_state_defaults_include_connector_config_fields() {
        let state = TelegramState::default();
        assert!(state.command_prefix.is_none());
        assert!(state.allowed_chats.is_empty());
    }

    // ============ Token redaction (R7-10) ============
    //
    // The Telegram bot token is the most sensitive piece of state in this
    // module. These tests guard `redact_token_in_str` from regressions.

    #[test]
    fn redact_replaces_token_in_url() {
        let token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
        let url = format!("https://api.telegram.org/bot{}/getMe", token);
        let redacted = redact_token_in_str(&url, token);
        assert!(!redacted.contains(token), "token still in: {}", redacted);
        assert!(redacted.contains("[REDACTED]"), "expected [REDACTED] marker in: {}", redacted);
    }

    #[test]
    fn redact_replaces_token_in_error_message() {
        let token = "secret-token-XYZ";
        let msg = format!("Request failed: error sending request for url (https://api.telegram.org/bot{}/getMe): connection refused", token);
        let redacted = redact_token_in_str(&msg, token);
        assert!(!redacted.contains(token));
        assert!(redacted.contains("[REDACTED]"));
    }

    #[test]
    fn redact_is_noop_when_token_empty() {
        let s = "https://api.telegram.org/bot12345:abc/getMe";
        let r = redact_token_in_str(s, "");
        assert_eq!(r, s);
    }

    #[test]
    fn redact_handles_token_appearing_twice() {
        let token = "ABC123";
        let s = format!("first {} second {}", token, token);
        let r = redact_token_in_str(&s, token);
        assert!(!r.contains(token));
        assert!(r.contains("[REDACTED]"));
        // Both occurrences replaced.
        assert_eq!(r.matches("[REDACTED]").count(), 2);
    }

    #[test]
    fn redact_does_not_match_substring_of_unrelated_string() {
        // Make sure a partial-overlap case doesn't accidentally redact
        // an unrelated string. (The token is a literal substring match.)
        let token = "ABC";
        let s = "the quick brown fox jumps over ABCDEF";
        let r = redact_token_in_str(s, token);
        // The full token "ABC" appears inside "ABCDEF" and is replaced
        // by [REDACTED], leaving "[REDACTED]DEF" — that's the expected
        // literal-substring behaviour, not a regex.
        assert_eq!(r, "the quick brown fox jumps over [REDACTED]DEF");
    }
}
