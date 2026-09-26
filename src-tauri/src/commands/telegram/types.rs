use serde::{Deserialize, Serialize};

/// Telegram bot information from getMe
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
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
#[serde(rename_all(serialize = "camelCase"))]
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
#[serde(rename_all(serialize = "camelCase"))]
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
#[serde(rename_all(serialize = "camelCase"))]
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
pub(crate) struct TelegramApiError {
    pub(crate) ok: bool,
    pub(crate) description: Option<String>,
}

/// Telegram getMe response
#[derive(Debug, Deserialize)]
pub(crate) struct GetMeResponse {
    pub(crate) ok: bool,
    pub(crate) result: TelegramBotInfo,
}

/// Telegram getUpdates response
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub(crate) struct GetUpdatesResponse {
    pub(crate) ok: bool,
    pub(crate) result: Vec<TelegramUpdate>,
}

/// Telegram update
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct TelegramUpdate {
    update_id: i64,
    #[serde(default)]
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SetWebhookResponse {
    pub(crate) ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
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
pub(crate) struct GetWebhookInfoResponse {
    pub(crate) ok: bool,
    pub(crate) result: TelegramWebhookInfo,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_me_parses_telegram_snake_case_and_serializes_camel_case() {
        let raw = r#"{"ok":true,"result":{"id":42,"is_bot":true,"first_name":"Pipi","username":"pipi_bot","can_join_groups":true,"can_read_all_group_messages":false,"supports_inline_queries":false}}"#;
        let parsed: GetMeResponse = serde_json::from_str(raw).expect("getMe payload must parse");
        assert!(parsed.ok);
        assert_eq!(parsed.result.first_name, "Pipi");

        let out = serde_json::to_value(&parsed.result).unwrap();
        assert_eq!(out["isBot"], true);
        assert_eq!(out["firstName"], "Pipi");
        assert_eq!(out["canJoinGroups"], true);
        assert!(out.get("is_bot").is_none());
    }

    #[test]
    fn get_updates_parses_telegram_snake_case() {
        let raw = r#"{"ok":true,"result":[{"update_id":7,"message":{"message_id":3,"date":1700000000,"chat":{"id":99,"type":"private","first_name":"A"},"from":{"id":99,"is_bot":false,"first_name":"A","language_code":"en"},"text":"hi"}}]}"#;
        let parsed: GetUpdatesResponse = serde_json::from_str(raw).expect("getUpdates payload must parse");
        let out = serde_json::to_value(&parsed.result[0]).unwrap();
        assert_eq!(out["updateId"], 7);
        assert_eq!(out["message"]["messageId"], 3);
        assert_eq!(out["message"]["chat"]["type"], "private");
        assert_eq!(out["message"]["from"]["languageCode"], "en");
    }

    #[test]
    fn get_webhook_info_parses_telegram_snake_case() {
        let raw = r#"{"ok":true,"result":{"url":"","has_custom_certificate":false,"pending_update_count":0}}"#;
        let parsed: GetWebhookInfoResponse = serde_json::from_str(raw).expect("getWebhookInfo payload must parse");
        let out = serde_json::to_value(&parsed.result).unwrap();
        assert_eq!(out["hasCustomCertificate"], false);
        assert_eq!(out["pendingUpdateCount"], 0);
    }
}
