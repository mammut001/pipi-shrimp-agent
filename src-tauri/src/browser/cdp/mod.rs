pub mod client;
pub mod config;
pub mod discovery;
pub mod health;
pub mod timeout;

use thiserror::Error;

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum CdpError {
    #[error("CDP operation '{operation}' timed out after {timeout_ms}ms")]
    Timeout { operation: String, timeout_ms: u64 },
    #[error("CDP discovery failed: {0}")]
    Discovery(String),
    #[error("CDP connection failed: {0}")]
    Connection(String),
    #[error("CDP session failed: {0}")]
    Session(String),
    #[error("CDP invalid response: {0}")]
    InvalidResponse(String),
}

pub use client::ChromiumoxideCdpClient;
pub use config::CdpConfig;
pub use discovery::discover_browser_ws_url;
pub use health::CdpHealthSnapshot;
pub use timeout::run_with_timeout;