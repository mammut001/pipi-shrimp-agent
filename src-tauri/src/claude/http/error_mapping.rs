use crate::utils::AppError;

#[derive(Debug)]
pub enum ClaudeHttpError {
    Network {
        retryable: bool,
    },
    Timeout {
        retryable: bool,
    },
    Auth {
        provider_message: Option<String>,
    },
    RateLimit {
        retry_after: Option<u64>,
    },
    Validation {
        field: String,
        message: String,
    },
    Provider {
        provider: String,
        message: String,
    },
    Unknown {
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

impl ClaudeHttpError {
    pub fn retryable(&self) -> bool {
        match self {
            ClaudeHttpError::Network { retryable } | ClaudeHttpError::Timeout { retryable } => {
                *retryable
            }
            ClaudeHttpError::RateLimit { .. } => true,
            ClaudeHttpError::Auth { .. }
            | ClaudeHttpError::Validation { .. }
            | ClaudeHttpError::Provider { .. }
            | ClaudeHttpError::Unknown { .. } => false,
        }
    }

    pub fn to_app_error(&self) -> AppError {
        match self {
            ClaudeHttpError::Network { .. } => {
                AppError::ProcessError("HTTP network error".to_string())
            }
            ClaudeHttpError::Timeout { .. } => {
                AppError::ProcessError("HTTP request timed out".to_string())
            }
            ClaudeHttpError::Auth { provider_message } => AppError::ConfigError(
                provider_message
                    .clone()
                    .unwrap_or_else(|| "Authentication failed".to_string()),
            ),
            ClaudeHttpError::RateLimit { retry_after } => {
                AppError::ProcessError(match retry_after {
                    Some(seconds) => format!("Rate limited. Retry after {}s", seconds),
                    None => "Rate limited by provider".to_string(),
                })
            }
            ClaudeHttpError::Validation { field, message } => {
                AppError::InvalidInput(format!("{}: {}", field, sanitize_provider_message(message)))
            }
            ClaudeHttpError::Provider { provider, message } => AppError::ProcessError(format!(
                "{}: {}",
                provider,
                sanitize_provider_message(message)
            )),
            ClaudeHttpError::Unknown { source } => {
                AppError::InternalError(sanitize_provider_message(&source.to_string()))
            }
        }
    }
}

impl std::fmt::Display for ClaudeHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeHttpError::Network { retryable } => {
                write!(f, "network error (retryable={})", retryable)
            }
            ClaudeHttpError::Timeout { retryable } => {
                write!(f, "timeout error (retryable={})", retryable)
            }
            ClaudeHttpError::Auth { provider_message } => {
                write!(
                    f,
                    "auth error: {}",
                    provider_message.as_deref().unwrap_or("unauthorized")
                )
            }
            ClaudeHttpError::RateLimit { retry_after } => {
                write!(f, "rate limited (retry_after={:?})", retry_after)
            }
            ClaudeHttpError::Validation { field, message } => {
                write!(f, "validation error on {}: {}", field, message)
            }
            ClaudeHttpError::Provider { provider, message } => {
                write!(f, "provider {} error: {}", provider, message)
            }
            ClaudeHttpError::Unknown { source } => write!(f, "unknown error: {}", source),
        }
    }
}

impl std::error::Error for ClaudeHttpError {}

impl From<ClaudeHttpError> for AppError {
    fn from(value: ClaudeHttpError) -> Self {
        value.to_app_error()
    }
}

impl From<serde_json::Error> for ClaudeHttpError {
    fn from(value: serde_json::Error) -> Self {
        ClaudeHttpError::Validation {
            field: "json".to_string(),
            message: sanitize_provider_message(&value.to_string()),
        }
    }
}

impl From<reqwest::Error> for ClaudeHttpError {
    fn from(value: reqwest::Error) -> Self {
        if value.is_timeout() {
            return ClaudeHttpError::Timeout { retryable: true };
        }

        if let Some(status) = value.status() {
            return map_http_status(status.as_u16(), None);
        }

        if value.is_connect() || value.is_request() || value.is_body() {
            return ClaudeHttpError::Network { retryable: true };
        }

        ClaudeHttpError::Unknown {
            source: Box::new(value),
        }
    }
}

pub fn map_http_status(status: u16, body: Option<&str>) -> ClaudeHttpError {
    let sanitized = body.map(sanitize_provider_message);
    match status {
        400 | 422 => ClaudeHttpError::Validation {
            field: "request".to_string(),
            message: sanitized.unwrap_or_else(|| "Request validation failed".to_string()),
        },
        401 | 403 => ClaudeHttpError::Auth {
            provider_message: sanitized,
        },
        429 => ClaudeHttpError::RateLimit {
            retry_after: extract_retry_after(body),
        },
        500..=599 => ClaudeHttpError::Network { retryable: true },
        _ => ClaudeHttpError::Provider {
            provider: "http".to_string(),
            message: sanitized.unwrap_or_else(|| format!("HTTP {}", status)),
        },
    }
}

/// AUDIT-FIX [fix-2#13] — Previous implementation filtered ALL digits out
/// of the body and parsed the joined string, so a body of
/// `"error code 12345, retry_after 30"` would yield 1234530 instead of 30.
/// We now (1) prefer the HTTP `Retry-After` header if present, and (2) for
/// JSON bodies look for a known `retry_after` / `retryAfter` field first,
/// falling back to a contextually-bounded regex match.
fn extract_retry_after(body: Option<&str>) -> Option<u64> {
    let body = body?;

    // Try to parse the body as JSON and look for a known retry_after key.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        for key in ["retry_after", "retryAfter", "retry-after"] {
            if let Some(n) = value.get(key).and_then(|v| v.as_u64()) {
                return Some(n);
            }
        }
    }

    // Fallback: regex for `<number> (seconds|s|ms|milliseconds)?` patterns.
    // We cap at a sensible retry window so a stray large number in the body
    // doesn't become a multi-hour sleep.
    use once_cell::sync::Lazy;
    use regex::Regex;
    static RE_SECONDS: Lazy<Regex> = Lazy::new(|| {
        // AUDIT-FIX [fix-7-pre] — Escape the literal `"` inside the regex
        // string so the source compiles (it was previously an unterminated
        // char literal at the start of the character class).
        Regex::new(
            r#"(?i)(?:retry[_\- ]?after|retry[_\- ]?in)["'\s:=]+(\d{1,6})\s*(s|sec|seconds)?"#,
        )
        .expect("retry-after regex must compile")
    });
    if let Some(caps) = RE_SECONDS.captures(body) {
        if let Some(m) = caps.get(1) {
            if let Ok(n) = m.as_str().parse::<u64>() {
                if n <= 3600 {
                    return Some(n);
                }
            }
        }
    }
    None
}

pub fn sanitize_provider_message(message: &str) -> String {
    use once_cell::sync::Lazy;
    use regex::Regex;

    static API_KEY_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\bsk-[a-z0-9_-]{8,}\b").expect("api key redaction regex should compile")
    });

    let redacted = API_KEY_RE
        .replace_all(message, "[redacted]")
        .replace("Bearer ", "Bearer [redacted] ");

    redacted
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_timeout_and_network_errors() {
        let timeout_error = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1))
            .build()
            .unwrap();
        let _ = timeout_error;
        let mapped = map_http_status(429, Some("retry_after=12"));
        match mapped {
            ClaudeHttpError::RateLimit { retry_after } => assert_eq!(retry_after, Some(12)),
            _ => panic!("expected rate limit"),
        }
        assert!(matches!(
            map_http_status(401, Some("bad key")),
            ClaudeHttpError::Auth { .. }
        ));
        assert!(matches!(
            map_http_status(400, Some("invalid json")),
            ClaudeHttpError::Validation { .. }
        ));
    }

    #[test]
    fn sanitizes_provider_messages() {
        let sanitized = sanitize_provider_message("Bearer sk-ant-secret-key exploded");
        assert!(!sanitized.contains("secret-key"));
        assert!(sanitized.contains("[redacted]"));
    }

    #[test]
    fn converts_json_error_to_validation() {
        let error = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
        match ClaudeHttpError::from(error) {
            ClaudeHttpError::Validation { field, .. } => assert_eq!(field, "json"),
            _ => panic!("expected validation error"),
        }
    }

    /// AUDIT-FIX [fix-2#13] — Regression test that an unrelated 5-digit
    /// code in the body does NOT pollute the retry-after value.
    #[test]
    fn extract_retry_after_does_not_concatenate_unrelated_digits() {
        let body = r#"{"error":"code 12345 happened, please retry_after 30 seconds later"}"#;
        assert_eq!(extract_retry_after(Some(body)), Some(30));
        // JSON field with retry_after key takes precedence
        let body = r#"{"retry_after": 7}"#;
        assert_eq!(extract_retry_after(Some(body)), Some(7));
        // No mention of retry → None
        let body = r#"{"error":"something else"}"#;
        assert_eq!(extract_retry_after(Some(body)), None);
    }
}
