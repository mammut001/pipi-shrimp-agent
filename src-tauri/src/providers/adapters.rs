/// Model fetch adapters.
///
/// Two adapter functions handle the two API endpoint styles (OpenAI and Anthropic).
/// `fetch_available_models` in `commands/models.rs` routes to the right adapter
/// via the provider registry — no per-provider branches needed there.

use reqwest::{Client, header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE}};
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIModelsResponse {
    pub data: Vec<OpenAIModel>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIModel {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnthropicModelsResponse {
    pub data: Vec<AnthropicModel>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnthropicModel {
    pub id: String,
}

// ── OpenAI-style adapter ─────────────────────────────────────────────────────

/// Fetch models from an OpenAI-compatible `/models` endpoint.
///
/// * `base_url` — must end with `/v1` or be otherwise path-complete
/// * `api_key`  — Bearer token
/// * `fallback_models` — returned as-is when the endpoint is unreachable or returns
///    an empty list; pass an empty slice if no fallback is desired.
pub async fn fetch_openai_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
    fallback_models: &[&str],
) -> Result<Vec<String>, String> {
    // Normalise base URL: ensure it contains /v1
    let base = if !base_url.contains("/v1") && !base_url.contains("/models") {
        format!("{}/v1", base_url.trim_end_matches('/'))
    } else {
        base_url.trim_end_matches('/').to_string()
    };
    let endpoint = format!("{}/models", base);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key)).map_err(|e| e.to_string())?,
    );

    match client.get(&endpoint).headers(headers).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<OpenAIModelsResponse>().await {
                Ok(data) if !data.data.is_empty() => {
                    let mut models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();
                    models.sort();
                    Ok(models)
                }
                // Empty or unparseable response → fallback
                _ => Ok(fallback_models.iter().map(|s| s.to_string()).collect()),
            }
        }
        // Non-2xx or network error → fallback (or error if no fallback)
        Ok(resp) => {
            if !fallback_models.is_empty() {
                Ok(fallback_models.iter().map(|s| s.to_string()).collect())
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                Err(format!("API error ({}): {}", status, body))
            }
        }
        Err(e) => {
            if !fallback_models.is_empty() {
                Ok(fallback_models.iter().map(|s| s.to_string()).collect())
            } else {
                Err(format!("Request failed: {}", e))
            }
        }
    }
}

// ── Anthropic-style adapter ──────────────────────────────────────────────────

/// Fetch models from an Anthropic-compatible `/models` endpoint.
///
/// * `base_url` — e.g. `https://api.anthropic.com/v1`
/// * `api_key`  — value for the `x-api-key` header
/// * `fallback_models` — same semantics as `fetch_openai_models`
pub async fn fetch_anthropic_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
    fallback_models: &[&str],
) -> Result<Vec<String>, String> {
    let endpoint = format!("{}/models", base_url.trim_end_matches('/'));

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

    let resp = client
        .get(&endpoint)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        if !fallback_models.is_empty() {
            return Ok(fallback_models.iter().map(|s| s.to_string()).collect());
        }
        return Err(format!("Anthropic API error ({}): {}", status, body));
    }

    match resp.json::<AnthropicModelsResponse>().await {
        Ok(data) if !data.data.is_empty() => {
            let mut models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();
            models.sort();
            Ok(models)
        }
        _ => Ok(fallback_models.iter().map(|s| s.to_string()).collect()),
    }
}
