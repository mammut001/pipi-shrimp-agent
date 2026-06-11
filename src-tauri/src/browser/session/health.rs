use crate::browser::cdp::health::CdpHealthStatus;
use crate::browser::observability::{BrowserBenchmarkKind, BrowserEventKind, BrowserEventLevel};

use super::manager::BrowserSessionManager;
use super::state::BrowserLaunchMode;

const PING_FAILURES_BEFORE_DEGRADED: u32 = 2;

impl BrowserSessionManager {
    pub fn record_ping_failure(&mut self, error: impl Into<String>) -> bool {
        let error = error.into();
        if self.health.consecutive_failures.saturating_add(1) >= PING_FAILURES_BEFORE_DEGRADED {
            let previous_status = self.health.status;
            self.health.mark_degraded(error);
            self.emit_health_event_if_changed(previous_status);
            self.sync_session_health();
            true
        } else {
            self.health.note_failure(error);
            self.sync_session_health();
            false
        }
    }

    pub fn record_ping_success(&mut self, current_url: Option<String>) {
        let previous_status = self.health.status;
        self.health.mark_healthy();
        if let Some(session) = self.session.as_mut() {
            session.current_url = current_url;
        }
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
    }

    pub fn mark_reconnecting(&mut self, error: impl Into<String>) {
        let previous_status = self.health.status;
        self.health.mark_reconnecting(error);
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
    }

    pub fn clear_reconnect_worker(&mut self) {
        self.reconnect_worker = None;
    }

    pub fn reconnect_worker_running(&self) -> bool {
        self.reconnect_worker.is_some()
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_benchmark_sample(
        &self,
        key: String,
        label: String,
        kind: BrowserBenchmarkKind,
        duration_ms: u64,
        success: bool,
        detail: Option<String>,
        error: Option<String>,
        memory_before_bytes: Option<u64>,
        memory_after_bytes: Option<u64>,
    ) -> crate::browser::observability::BrowserBenchmarkSample {
        self.event_bus.build_benchmark_sample(
            key,
            label,
            kind,
            self.session
                .as_ref()
                .map(|session| session.launch_mode.as_str().to_string()),
            duration_ms,
            success,
            detail,
            error,
            memory_before_bytes,
            memory_after_bytes,
        )
    }

    pub(super) fn record_connect_benchmark(
        &self,
        launch_mode: BrowserLaunchMode,
        duration_ms: u64,
        success: bool,
        error: Option<String>,
    ) {
        let sample = self.event_bus.build_benchmark_sample(
            format!("connect.{}", launch_mode.as_str()),
            format!("connect ({})", launch_mode.as_str()),
            BrowserBenchmarkKind::Connect,
            Some(launch_mode.as_str().to_string()),
            duration_ms,
            success,
            None,
            error,
            None,
            None,
        );
        self.event_bus.record_benchmark_sample(sample);
    }

    pub(super) fn emit_health_event_if_changed(&self, previous_status: CdpHealthStatus) {
        if self.health.status == previous_status {
            return;
        }

        let level = match self.health.status {
            CdpHealthStatus::Healthy => BrowserEventLevel::Success,
            CdpHealthStatus::Failed => BrowserEventLevel::Error,
            CdpHealthStatus::Degraded | CdpHealthStatus::Reconnecting => BrowserEventLevel::Warning,
            _ => BrowserEventLevel::Info,
        };

        self.event_bus.publish(
            BrowserEventKind::HealthChanged,
            level,
            format!("Health: {}", self.health.status.as_str()),
            self.health.last_error.clone(),
            None,
            None,
        );
    }
}

#[cfg(test)]
mod tests {
    use crate::browser::cdp::{health::CdpHealthStatus, CdpConfig};

    use super::*;
    use crate::browser::session::state::{BrowserLaunchMode, BrowserSession};

    #[test]
    fn test_record_ping_failures_degrades_and_recovery_resets_health() {
        let mut manager = BrowserSessionManager::new(CdpConfig::default());
        manager.session = Some(BrowserSession::new(
            "ws://127.0.0.1:9222/devtools/browser/test".to_string(),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));
        manager.health.mark_healthy();
        manager.sync_session_health();

        assert!(!manager.record_ping_failure("first ping timeout"));
        assert_eq!(manager.health.status, CdpHealthStatus::Healthy);
        assert_eq!(manager.health.consecutive_failures, 1);
        assert_eq!(
            manager.health.last_error.as_deref(),
            Some("first ping timeout")
        );

        assert!(manager.record_ping_failure("second ping timeout"));
        assert_eq!(manager.health.status, CdpHealthStatus::Degraded);
        assert_eq!(manager.health.consecutive_failures, 2);
        assert_eq!(
            manager.health.last_error.as_deref(),
            Some("second ping timeout")
        );

        manager.mark_reconnecting("reconnect started");
        assert_eq!(manager.health.status, CdpHealthStatus::Reconnecting);

        manager.record_ping_success(Some("https://github.com/copilot".to_string()));
        assert_eq!(manager.health.status, CdpHealthStatus::Healthy);
        assert_eq!(manager.health.consecutive_failures, 0);
        assert_eq!(manager.health.last_error, None);

        let session = manager
            .session
            .as_ref()
            .expect("session should remain present");
        assert_eq!(session.health.status, CdpHealthStatus::Healthy);
        assert_eq!(session.health.consecutive_failures, 0);
        assert_eq!(session.health.last_error, None);
        assert_eq!(
            session.current_url.as_deref(),
            Some("https://github.com/copilot")
        );

        let state = manager.connection_state();
        assert_eq!(state.health_status, "healthy");
        assert_eq!(state.health_failures, 0);
        assert_eq!(
            state.current_url.as_deref(),
            Some("https://github.com/copilot")
        );
    }
}
