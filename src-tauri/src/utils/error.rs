/**
 * Error handling utilities
 *
 * Defines custom error types for the application
 */

use serde::Serialize;
use std::fmt;

/// Application-specific error types
#[derive(Debug)]
#[allow(dead_code)]
pub enum AppError {
    /// Resource not found
    NotFound(String),
    /// Invalid input parameters
    InvalidInput(String),
    /// Process execution error
    ProcessError(String),
    /// File system error
    FileError(String),
    /// Configuration error
    ConfigError(String),
    /// Security error (path validation, dangerous commands)
    SecurityError(String),
    /// Internal error
    InternalError(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AppError::NotFound(msg) => write!(f, "Not found: {}", msg),
            AppError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            AppError::ProcessError(msg) => write!(f, "Process error: {}", msg),
            AppError::FileError(msg) => write!(f, "File error: {}", msg),
            AppError::ConfigError(msg) => write!(f, "Config error: {}", msg),
            AppError::SecurityError(msg) => write!(f, "Security error: {}", msg),
            AppError::InternalError(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::InternalError(s)
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Alias for Result with AppError
pub type AppResult<T> = Result<T, AppError>;
