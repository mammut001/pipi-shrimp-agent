use std::time::Instant;

use super::error_mapping::{sanitize_provider_message, ClaudeHttpError};

#[derive(Debug, Clone)]
pub struct ClaudeHttpTelemetry {
    provider: String,
    model: String,
    endpoint: String,
    started_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeHttpTelemetryOutcome {
    pub provider: String,
    pub model: String,
    pub endpoint: String,
    pub duration_ms: u128,
    pub status: &'static str,
    pub detail: Option<String>,
}

impl ClaudeHttpTelemetry {
    pub fn start(provider: impl Into<String>, model: impl Into<String>, endpoint: impl AsRef<str>) -> Self {
        Self {
            provider: provider.into(),
            model: model.into(),
            endpoint: sanitize_endpoint(endpoint.as_ref()),
            started_at: Instant::now(),
        }
    }

    pub fn finish_success(&self) -> ClaudeHttpTelemetryOutcome {
        ClaudeHttpTelemetryOutcome {
            provider: self.provider.clone(),
            model: self.model.clone(),
            endpoint: self.endpoint.clone(),
            duration_ms: self.started_at.elapsed().as_millis(),
            status: "success",
            detail: None,
        }
    }

    pub fn finish_error(&self, error: &ClaudeHttpError) -> ClaudeHttpTelemetryOutcome {
        ClaudeHttpTelemetryOutcome {
            provider: self.provider.clone(),
            model: self.model.clone(),
            endpoint: self.endpoint.clone(),
            duration_ms: self.started_at.elapsed().as_millis(),
            status: "error",
            detail: Some(sanitize_provider_message(&error.to_string())),
        }
    }
}

pub fn sanitize_endpoint(endpoint: &str) -> String {
    endpoint
        .split('?')
        .next()
        .unwrap_or(endpoint)
        .split('#')
        .next()
        .unwrap_or(endpoint)
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_query_and_fragment_from_endpoint() {
        assert_eq!(
            sanitize_endpoint("https://api.example.com/v1/messages?api_key=secret#frag"),
            "https://api.example.com/v1/messages",
        );
    }

    #[test]
    fn captures_success_and_error_outcomes() {
        let telemetry = ClaudeHttpTelemetry::start("anthropic", "claude", "https://api.example.com/v1/messages");
        let success = telemetry.finish_success();
        assert_eq!(success.status, "success");

        let error = telemetry.finish_error(&ClaudeHttpError::Auth {
            provider_message: Some("bad key".to_string()),
        });
        assert_eq!(error.status, "error");
        assert!(error.detail.unwrap().contains("bad key"));
    }
}
