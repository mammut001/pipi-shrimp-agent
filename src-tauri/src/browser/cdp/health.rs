use chrono::Utc;
use serde::Serialize;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CdpHealthStatus {
    Disconnected,
    Connecting,
    Healthy,
    Degraded,
    Reconnecting,
    Failed,
}

impl CdpHealthStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::Connecting => "connecting",
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Reconnecting => "reconnecting",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CdpHealthSnapshot {
    pub status: CdpHealthStatus,
    pub consecutive_failures: u32,
    pub last_error: Option<String>,
    pub last_transition_at_ms: i64,
}

impl Default for CdpHealthSnapshot {
    fn default() -> Self {
        Self {
            status: CdpHealthStatus::Disconnected,
            consecutive_failures: 0,
            last_error: None,
            last_transition_at_ms: Utc::now().timestamp_millis(),
        }
    }
}

impl CdpHealthSnapshot {
    #[allow(dead_code)]
    pub fn note_failure(&mut self, error: impl Into<String>) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.last_error = Some(error.into());
        self.last_transition_at_ms = Utc::now().timestamp_millis();
    }

    #[allow(dead_code)]
    pub fn mark_connecting(&mut self) {
        self.transition(CdpHealthStatus::Connecting, None, true);
    }

    #[allow(dead_code)]
    pub fn mark_healthy(&mut self) {
        self.transition(CdpHealthStatus::Healthy, None, true);
    }

    #[allow(dead_code)]
    pub fn mark_degraded(&mut self, error: impl Into<String>) {
        self.transition(CdpHealthStatus::Degraded, Some(error.into()), false);
    }

    #[allow(dead_code)]
    pub fn mark_reconnecting(&mut self, error: impl Into<String>) {
        self.transition(CdpHealthStatus::Reconnecting, Some(error.into()), false);
    }

    #[allow(dead_code)]
    pub fn mark_failed(&mut self, error: impl Into<String>) {
        self.transition(CdpHealthStatus::Failed, Some(error.into()), false);
    }

    #[allow(dead_code)]
    pub fn mark_disconnected(&mut self) {
        self.transition(CdpHealthStatus::Disconnected, None, true);
    }

    fn transition(&mut self, next: CdpHealthStatus, error: Option<String>, reset_failures: bool) {
        self.status = next;
        if reset_failures {
            self.consecutive_failures = 0;
            self.last_error = error;
        } else {
            self.consecutive_failures = self.consecutive_failures.saturating_add(1);
            self.last_error = error;
        }
        self.last_transition_at_ms = Utc::now().timestamp_millis();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_failure_preserves_current_status() {
        let mut snapshot = CdpHealthSnapshot::default();
        snapshot.mark_healthy();

        snapshot.note_failure("ping timeout");

        assert_eq!(snapshot.status, CdpHealthStatus::Healthy);
        assert_eq!(snapshot.consecutive_failures, 1);
        assert_eq!(snapshot.last_error.as_deref(), Some("ping timeout"));
    }

    #[test]
    fn test_recovery_clears_error_and_failures() {
        let mut snapshot = CdpHealthSnapshot::default();

        snapshot.note_failure("first failure");
        snapshot.mark_reconnecting("retrying");
        snapshot.mark_healthy();

        assert_eq!(snapshot.status, CdpHealthStatus::Healthy);
        assert_eq!(snapshot.consecutive_failures, 0);
        assert_eq!(snapshot.last_error, None);
    }
}