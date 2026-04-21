use serde::Serialize;

use crate::browser::cdp::CdpHealthSnapshot;
use chrono::Utc;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserLaunchMode {
    Attach,
    Launch,
}

impl BrowserLaunchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Attach => "attach",
            Self::Launch => "launch",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserSession {
    pub browser_ws_url: String,
    pub target_id: Option<String>,
    pub session_id: Option<String>,
    pub current_url: Option<String>,
    pub last_navigation_id: Option<String>,
    pub launch_mode: BrowserLaunchMode,
    pub health: CdpHealthSnapshot,
    pub last_activity_at_ms: i64,
}

impl BrowserSession {
    pub fn new(browser_ws_url: String, launch_mode: BrowserLaunchMode, health: CdpHealthSnapshot) -> Self {
        Self {
            browser_ws_url,
            target_id: None,
            session_id: None,
            current_url: None,
            last_navigation_id: None,
            launch_mode,
            health,
            last_activity_at_ms: Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserConnectionState {
    pub connected: bool,
    pub launch_mode: Option<String>,
    pub health_status: String,
    pub health_failures: u32,
    pub health_last_transition_at_ms: i64,
    pub websocket_url: Option<String>,
    pub current_url: Option<String>,
    pub last_error: Option<String>,
    pub target_id: Option<String>,
    pub session_id: Option<String>,
    pub last_activity_at_ms: i64,
    pub idle_timeout_ms: u64,
}