use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[allow(non_snake_case)]
impl AppError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        retryable: bool,
        details: Option<Value>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            details,
        }
    }

    pub fn NotFound(message: impl Into<String>) -> Self {
        Self::new("not_found", message, false, None)
    }

    pub fn InvalidInput(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message, false, None)
    }

    pub fn ProcessError(message: impl Into<String>) -> Self {
        Self::new("process_error", message, true, None)
    }

    pub fn FileError(message: impl Into<String>) -> Self {
        Self::new("file_error", message, false, None)
    }

    pub fn ConfigError(message: impl Into<String>) -> Self {
        Self::new("config_error", message, false, None)
    }

    pub fn SecurityError(message: impl Into<String>) -> Self {
        Self::new("security_error", message, false, None)
    }

    pub fn InternalError(message: impl Into<String>) -> Self {
        Self::new("internal_error", message, true, None)
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::InternalError(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::InternalError(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_style_constructor_builds_structured_error() {
        let error = AppError::InvalidInput("bad input");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(error.message, "bad input");
        assert!(!error.retryable);
        assert!(error.details.is_none());
    }

    #[test]
    fn internal_error_can_attach_details() {
        let error = AppError::InternalError("boom")
            .with_details(serde_json::json!({ "source": "test" }));

        assert_eq!(error.details, Some(serde_json::json!({ "source": "test" })));
    }
}
