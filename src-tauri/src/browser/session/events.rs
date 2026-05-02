use crate::browser::cdp::CdpConfig;
use crate::browser::observability::{BrowserBenchmarkKind, BrowserEventKind, BrowserEventLevel};

use super::manager::BrowserSessionManager;
use super::state::{BrowserLaunchMode, BrowserSession};

impl BrowserSessionManager {
    pub fn record_action_started(&mut self, action_name: &str, detail: Option<String>) {
        self.touch_activity();
        self.event_bus.publish(
            BrowserEventKind::ActionStarted,
            BrowserEventLevel::Info,
            format!("{} started", action_name),
            detail,
            Some(action_name.to_string()),
            None,
        );
    }

    pub fn record_action_finished(
        &mut self,
        action_name: &str,
        detail: Option<String>,
        duration_ms: u64,
        success: bool,
        error_kind: Option<String>,
        error: Option<String>,
    ) {
        if success {
            self.last_successful_action = Some(action_name.to_string());
        } else if let Some(error_message) = error.clone() {
            let _ = self.record_failure_snapshot(action_name, error_kind.clone(), error_message);
        }

        let benchmark = self.build_benchmark_sample(
            format!("action.{}", action_name),
            format!("action: {}", action_name),
            BrowserBenchmarkKind::Action,
            duration_ms,
            success,
            detail.clone(),
            error.clone(),
            None,
            None,
        );

        self.event_bus.publish(
            if success {
                BrowserEventKind::ActionCompleted
            } else {
                BrowserEventKind::ActionFailed
            },
            if success {
                BrowserEventLevel::Success
            } else {
                BrowserEventLevel::Error
            },
            format!(
                "{} {}",
                action_name,
                if success { "completed" } else { "failed" }
            ),
            error.clone().or(detail),
            Some(action_name.to_string()),
            Some(benchmark),
        );
    }

    pub fn record_navigation(&mut self, title: Option<String>, current_url: Option<String>) {
        self.record_navigation_event(current_url, title);
    }

    pub(super) fn record_navigation_event(&self, current_url: Option<String>, title: Option<String>) {
        let detail = current_url.clone();
        let title = title
            .filter(|value| !value.trim().is_empty())
            .or(current_url)
            .unwrap_or_else(|| "Navigation committed".to_string());

        self.event_bus.publish(
            BrowserEventKind::Navigation,
            BrowserEventLevel::Info,
            title,
            detail,
            None,
            None,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_events_and_benchmarks_are_recorded() {
        let mut manager = BrowserSessionManager::new(CdpConfig::default());
        manager.session = Some(BrowserSession::new(
            "ws://127.0.0.1:9222/devtools/browser/test".to_string(),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));

        manager.record_action_started("click", Some("index=3".to_string()));
        manager.record_action_finished(
            "click",
            Some("index=3".to_string()),
            120,
            true,
            None,
            None,
        );

        let snapshot = manager.observability_snapshot();
        assert_eq!(snapshot.recent_events.len(), 2);
        assert!(snapshot
            .benchmark_report
            .metrics
            .iter()
            .any(|metric| metric.key == "action.click" && metric.sample_count == 1));
    }
}
