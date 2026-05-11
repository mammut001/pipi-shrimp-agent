use std::collections::HashMap;

use once_cell::sync::Lazy;
use tauri::Window;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::claude::composer::normalize_messages;
use crate::claude::message::{ChatResponse, Message, UsageInfo};
use crate::utils::{AppError, AppResult};

use super::{
    estimate_request_input_tokens, get_adapter_for_config, map_http_status, parse_plain_response,
    resolve_provider_config, run_with_retry, stream_response, ClaudeHttpError,
    ClaudeHttpTelemetry, ProviderId, DEFAULT_RETRY_POLICY,
};

static CANCEL_TOKENS: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .expect("Failed to build HTTP client")
}

#[allow(clippy::too_many_arguments)]
pub async fn send_request_impl(
    client: &reqwest::Client,
    messages: &[Message],
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system_prompt: Option<&str>,
    streaming: bool,
    no_tools: bool,
    window: Option<Window>,
    allow_browser_tools: bool,
    session_id: Option<&str>,
    api_format_hint: Option<&str>,
    response_format: Option<serde_json::Value>,
) -> Result<ChatResponse, ClaudeHttpError> {
    let config = resolve_provider_config(api_key, model, base_url, api_format_hint);
    let adapter = get_adapter_for_config(&config);
    let url = adapter.build_url(&config);
    let headers = adapter.build_headers(&config);

    #[cfg(debug_assertions)]
    {
        let key_preview = if config.api_key.len() > 8 {
            format!("{}...{} (len={})", &config.api_key[..4], &config.api_key[config.api_key.len()-4..], config.api_key.len())
        } else {
            format!("****(len={})", config.api_key.len())
        };
        eprintln!(
            "[claude-http] provider={:?} format={:?} url={} key={} hint={:?}",
            config.provider_id, config.api_format, url, key_preview, api_format_hint
        );
        for (name, value) in headers.iter() {
            let val_str = value.to_str().unwrap_or("<non-ascii>");
            if name == "authorization" || name == "x-api-key" {
                let preview = if val_str.len() > 20 {
                    format!("{}...{}", &val_str[..15], &val_str[val_str.len()-4..])
                } else {
                    val_str.to_string()
                };
                eprintln!("[claude-http]   header {}={}", name, preview);
            }
        }
    }
    let mut body = if streaming {
        adapter.build_stream_body(
            &config,
            messages,
            system_prompt,
            no_tools,
            allow_browser_tools,
        )
    } else {
        adapter.build_body(
            &config,
            messages,
            system_prompt,
            no_tools,
            allow_browser_tools,
        )
    };
    if config.api_format == super::ApiFormat::OpenAI {
        if let Some(response_format) = response_format {
            body["response_format"] = response_format;
        }
    }
    let estimated_input = estimate_request_input_tokens(
        config.provider_id,
        messages,
        system_prompt,
        allow_browser_tools,
    );
    let telemetry = ClaudeHttpTelemetry::start(provider_label(config.provider_id), model, &url);

    let response = run_with_retry(
        |_| {
            let url = url.clone();
            let headers = headers.clone();
            let body = body.clone();
            async move {
                let response = client
                    .post(url)
                    .headers(headers)
                    .json(&body)
                    .send()
                    .await
                    .map_err(ClaudeHttpError::from)?;

                let status = response.status();
                if status.is_success() {
                    Ok(response)
                } else {
                    let body_text = response.text().await.unwrap_or_default();
                    Err(map_http_status(status.as_u16(), Some(&body_text)))
                }
            }
        },
        DEFAULT_RETRY_POLICY,
    )
    .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!("[claude-http] {:?}", telemetry.finish_error(&error));
            return Err(error);
        }
    };

    let result = if streaming {
        stream_response(
            response,
            &config,
            window,
            estimated_input,
            session_id.map(|value| value.to_string()),
        )
        .await
        .map_err(|error| map_app_error(provider_label(config.provider_id), error))
    } else {
        let value: serde_json::Value = response.json().await.map_err(ClaudeHttpError::from)?;
        parse_plain_response(value, &config)
            .map_err(|error| map_app_error(provider_label(config.provider_id), error))
    };

    #[cfg(debug_assertions)]
    match &result {
        Ok(_) => eprintln!("[claude-http] {:?}", telemetry.finish_success()),
        Err(error) => eprintln!("[claude-http] {:?}", telemetry.finish_error(error)),
    }

    result
}

#[allow(clippy::too_many_arguments)]
pub async fn send_streaming_request(
    client: &reqwest::Client,
    messages: &[Message],
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system_prompt: Option<&str>,
    no_tools: bool,
    window: Window,
    allow_browser_tools: bool,
    session_id: &str,
    api_format_hint: Option<&str>,
    response_format: Option<serde_json::Value>,
) -> Result<ChatResponse, ClaudeHttpError> {
    let cancel_token = CancellationToken::new();
    {
        let mut tokens_guard = CANCEL_TOKENS.lock().await;
        tokens_guard.insert(session_id.to_string(), cancel_token.clone());
    }

    let result = tokio::select! {
        _ = cancel_token.cancelled() => Ok(empty_response()),
        response = send_request_impl(
            client,
            messages,
            api_key,
            model,
            base_url,
            system_prompt,
            true,
            no_tools,
            Some(window),
            allow_browser_tools,
            Some(session_id),
            api_format_hint,
            response_format,
        ) => response,
    };

    {
        let mut tokens_guard = CANCEL_TOKENS.lock().await;
        tokens_guard.remove(session_id);
    }

    result
}

pub async fn stop_current_request(session_id: Option<String>) -> AppResult<()> {
    let mut tokens_guard = CANCEL_TOKENS.lock().await;
    if let Some(session_id) = session_id {
        if let Some(token) = tokens_guard.remove(&session_id) {
            token.cancel();
        }
    } else {
        for (_, token) in tokens_guard.drain() {
            token.cancel();
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub async fn has_running_request(session_id: Option<&str>) -> bool {
    let tokens_guard = CANCEL_TOKENS.lock().await;
    match session_id {
        Some(session_id) => tokens_guard.contains_key(session_id),
        None => !tokens_guard.is_empty(),
    }
}

pub fn validate_messages(messages: Vec<Message>, surface: &str) -> AppResult<Vec<Message>> {
    let (normalized, validation) = normalize_messages(&messages);
    if !validation.errors.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Message validation failed: {}",
            validation.errors.join(", ")
        )));
    }

    if !validation.warnings.is_empty() {
        eprintln!("[{}] Validation warnings: {:?}", surface, validation.warnings);
    }

    Ok(normalized)
}

pub fn empty_response() -> ChatResponse {
    ChatResponse {
        content: String::new(),
        artifacts: Vec::new(),
        model: String::new(),
        usage: UsageInfo {
            input_tokens: 0,
            output_tokens: 0,
        },
        tool_calls: Vec::new(),
    }
}

fn provider_label(provider_id: ProviderId) -> &'static str {
    match provider_id {
        ProviderId::Anthropic => "anthropic",
        ProviderId::OpenAI => "openai",
        ProviderId::MiniMax => "minimax",
        ProviderId::Gemini => "gemini",
        ProviderId::DeepSeek => "deepseek",
        ProviderId::Custom => "custom",
    }
}

fn map_app_error(provider: &str, error: AppError) -> ClaudeHttpError {
    match error.code.as_str() {
        "config_error" => ClaudeHttpError::Auth {
            provider_message: Some(error.message),
        },
        "invalid_input" => ClaudeHttpError::Validation {
            field: "request".to_string(),
            message: error.message,
        },
        "process_error" | "file_error" | "internal_error" | "not_found" | "security_error" => ClaudeHttpError::Provider {
            provider: provider.to_string(),
            message: error.message,
        },
        _ => ClaudeHttpError::Provider {
            provider: provider.to_string(),
            message: error.message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_app_errors_into_http_errors() {
        assert!(matches!(
            map_app_error("anthropic", AppError::ConfigError("bad key".to_string())),
            ClaudeHttpError::Auth { .. }
        ));
        assert!(matches!(
            map_app_error("openai", AppError::InvalidInput("bad request".to_string())),
            ClaudeHttpError::Validation { .. }
        ));
    }

    #[test]
    fn creates_empty_response_for_cancelled_requests() {
        let response = empty_response();
        assert!(response.content.is_empty());
        assert_eq!(response.usage.input_tokens, 0);
        assert!(response.tool_calls.is_empty());
    }
}
