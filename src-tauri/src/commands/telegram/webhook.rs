use tokio::time::Duration;

use super::{redact_token_in_error, GetWebhookInfoResponse, SetWebhookResponse, TelegramWebhookInfo};

pub(super) async fn set_webhook_impl(
    token: &str,
    url: String,
    secret_token: Option<String>,
) -> Result<(), String> {
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
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("setWebhook failed: {}", body),
            token,
        ));
    }

    let parsed: SetWebhookResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;
    if !parsed.ok {
        return Err("Telegram setWebhook returned ok=false".to_string());
    }
    Ok(())
}

pub(super) async fn delete_webhook_impl(token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("https://api.telegram.org/bot{}/deleteWebhook", token))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("deleteWebhook failed: {}", body),
            token,
        ));
    }
    Ok(())
}

pub(super) async fn get_webhook_info_impl(token: &str) -> Result<TelegramWebhookInfo, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "https://api.telegram.org/bot{}/getWebhookInfo",
            token
        ))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("getWebhookInfo failed: {}", body),
            token,
        ));
    }

    let parsed: GetWebhookInfoResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;
    if !parsed.ok {
        return Err("Telegram getWebhookInfo returned ok=false".to_string());
    }
    Ok(parsed.result)
}
