use crate::utils::AppResult;
use serde::{Deserialize, Serialize};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIModel {
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModel>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnthropicModel {
    id: String,
}

#[tauri::command]
pub async fn fetch_available_models(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> AppResult<Vec<String>> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    match provider.as_str() {
        "minimax" | "openai" | "custom" => {
            let url = if let Some(url) = base_url {
                url
            } else if provider == "minimax" {
                "https://api.minimaxi.com/v1".to_string()
            } else if provider == "openai" {
                "https://api.openai.com/v1".to_string()
            } else {
                return Err("Base URL required for custom provider".to_string().into());
            };

            let endpoint = format!("{}/models", url.trim_end_matches('/'));
            headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| e.to_string())?);

            let resp = client.get(endpoint)
                .headers(headers)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = resp.status();
            if !status.is_success() {
                let error_text = resp.text().await.unwrap_or_default();
                return Err(format!("API error ({}): {}", status, error_text).into());
            }

            let data: OpenAIModelsResponse = resp.json()
                .await
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;

            let mut models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();
            models.sort();
            Ok(models)
        }
        "anthropic" => {
            let url = base_url.unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
            let endpoint = format!("{}/models", url.trim_end_matches('/'));
            
            headers.insert("x-api-key", HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

            let resp = client.get(endpoint)
                .headers(headers)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = resp.status();
            if !status.is_success() {
                let error_text = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error ({}): {}", status, error_text).into());
            }

            let data: AnthropicModelsResponse = resp.json()
                .await
                .map_err(|e| format!("Failed to parse Anthropic JSON: {}", e))?;

            let mut models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();
            models.sort();
            Ok(models)
        }
        _ => Err(format!("Unknown provider: {}", provider).into()),
    }
}
