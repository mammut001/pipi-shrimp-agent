use crate::utils::AppResult;
use crate::providers::registry::{find_provider, EndpointStyle};
use crate::providers::adapters::{fetch_openai_models, fetch_anthropic_models};
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: Option<String>,
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

    let entry = find_provider(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    // Resolve effective base URL: user-supplied > registry default > error
    let base_url = if let Some(url) = &baseUrl {
        let url = url.trim();
        if !url.is_empty() {
            url.to_string()
        } else if !entry.default_base_url.is_empty() {
            entry.default_base_url.to_string()
        } else {
            return Err(format!("Base URL required for provider '{}'", provider).into());
        }
    } else if !entry.default_base_url.is_empty() {
        entry.default_base_url.to_string()
    } else {
        return Err(format!("Base URL required for provider '{}'", provider).into());
    };

    let fallback: &[&str] = entry.fallback_models;

    match entry.endpoint_style {
        EndpointStyle::OpenAI => {
            fetch_openai_models(&client, &base_url, &apiKey, fallback)
                .await
                .map_err(|e| e.into())
        }
        EndpointStyle::Anthropic => {
            fetch_anthropic_models(&client, &base_url, &apiKey, fallback)
                .await
                .map_err(|e| e.into())
        }
    }
}

