use serde::Deserialize;
use tokio::time::Duration;

use super::{build_file_url, redact_token_in_error};

pub(super) async fn get_file_url_impl(token: &str, file_id: &str) -> Result<String, String> {
    #[allow(dead_code)]
    #[derive(Deserialize)]
    struct GetFileResponse {
        ok: bool,
        result: FileResult,
    }

    #[derive(Deserialize)]
    struct FileResult {
        file_path: String,
    }

    let url = format!(
        "https://api.telegram.org/bot{}/getFile?file_id={}",
        token,
        urlencoding::encode(file_id)
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Failed to get file: {}", body),
            token,
        ));
    }

    let file_response: GetFileResponse = response
        .json()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    // Construct the full file URL
    let file_url = build_file_url(token, &file_response.result.file_path);

    Ok(file_url)
}

pub(super) async fn download_file_impl(
    token: &str,
    file_id: &str,
    destination: &str,
) -> Result<String, String> {
    let file_url = get_file_url_impl(token, file_id).await?;
    let response = reqwest::Client::new()
        .get(&file_url)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(redact_token_in_error(
            &format!("Download failed: {}", body),
            token,
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| redact_token_in_error(&e.to_string(), token))?;

    tokio::fs::write(destination, bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(destination.to_string())
}
