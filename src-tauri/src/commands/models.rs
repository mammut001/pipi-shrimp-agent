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
    #[allow(non_snake_case)]
    apiKey: String,
    #[allow(non_snake_case)]
    baseUrl: Option<String>,
) -> AppResult<Vec<String>> {
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    match provider.as_str() {
        "minimax" => {
            // MiniMax 完整已知模型列表（用于 API 不可用时的 fallback）
            let fallback_models = vec![
                "MiniMax-Text-01".to_string(),
                "MiniMax-Text-01-Web".to_string(),
                "MiniMax-M2".to_string(),
                "MiniMax-M2.1".to_string(),
                "MiniMax-M2.1-highspeed".to_string(),
                "MiniMax-M2.5".to_string(),
                "MiniMax-M2.5-highspeed".to_string(),
            ];

            let base = baseUrl
                .as_deref()
                .unwrap_or("https://api.minimaxi.com/v1")
                .trim_end_matches('/');
            let endpoint = format!("{}/models", base);

            headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", apiKey))
                .map_err(|e| e.to_string())?);

            // 先尝试调用 /models 端点，失败时 fallback 到硬编码列表
            match client.get(&endpoint).headers(headers).send().await {
                Ok(resp) if resp.status().is_success() => {
                    match resp.json::<OpenAIModelsResponse>().await {
                        Ok(data) if !data.data.is_empty() => {
                            let mut models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();
                            models.sort();
                            Ok(models)
                        }
                        _ => Ok(fallback_models),
                    }
                }
                // API 不支持 /models（404）或网络错误，使用硬编码列表
                _ => Ok(fallback_models),
            }
        }
        "openai" | "custom" => {
            let url = if let Some(url) = baseUrl {
                url.trim_end_matches('/').to_string()
            } else if provider == "openai" {
                "https://api.openai.com/v1".to_string()
            } else {
                return Err("Base URL required for custom provider".to_string().into());
            };

            // Ensure URL ends with /v1 for OpenAI-compatible APIs
            let url = if !url.contains("/v1") && !url.contains("/models") {
                format!("{}/v1", url)
            } else {
                url
            };

            let endpoint = format!("{}/models", url);
            headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", apiKey))
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
            let url = baseUrl.unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
            let endpoint = format!("{}/models", url.trim_end_matches('/'));
            
            headers.insert("x-api-key", HeaderValue::from_str(&apiKey).map_err(|e| e.to_string())?);
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
