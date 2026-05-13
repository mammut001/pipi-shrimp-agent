use std::collections::VecDeque;
use std::sync::Weak;
use std::time::{Duration, Instant};

use chromiumoxide::browser::Browser;
use chromiumoxide::page::Page;
use chrono::Utc;
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

use crate::browser::cdp::{
    CdpConfig, CdpError, CdpHealthSnapshot, ChromiumoxideCdpClient,
};
use crate::browser::dom::PageState;

use crate::browser::observability::{
    BrowserEventBus, BrowserObservabilitySnapshot,
};
use crate::browser::session::snapshot_cache::SnapshotCache;

use super::cleanup::{CleanupReason, SessionCleanup};
use super::state::{BrowserLaunchMode, BrowserSession};
use super::BrowserConnectionState;

pub struct BrowserSessionManager {
    pub(super) config: CdpConfig,
    pub(super) client: ChromiumoxideCdpClient,
    pub(crate) session: Option<BrowserSession>,
    pub(super) browser: Option<Browser>,
    pub(super) page: Option<Page>,
    pub(super) handler: Option<JoinHandle<()>>,
    pub(super) health: CdpHealthSnapshot,
    pub(super) health_worker: Option<JoinHandle<()>>,
    pub(super) reconnect_worker: Option<JoinHandle<()>>,
    pub(super) idle_worker: Option<JoinHandle<()>>,
    pub(super) runtime_event_worker: Option<JoinHandle<()>>,
    pub(super) worker_shutdown: Option<watch::Sender<bool>>,
    pub(super) manager_handle: Option<Weak<Mutex<BrowserSessionManager>>>,
    pub(crate) snapshot_cache: SnapshotCache,
    pub(super) test_page_state_captures: VecDeque<Result<PageState, CdpError>>,
    pub(super) test_page_state_capture_count: usize,
    pub(crate) event_bus: BrowserEventBus,
    pub(super) last_activity: Instant,
    pub(super) last_activity_at_ms: i64,
    pub(crate) last_successful_action: Option<String>,
}

impl Default for BrowserSessionManager {
    fn default() -> Self {
        Self::new(CdpConfig::from_env())
    }
}

impl BrowserSessionManager {
    pub fn new(config: CdpConfig) -> Self {
        let event_bus =
            BrowserEventBus::new(config.event_history_limit, config.benchmark_sample_limit);
        let client = ChromiumoxideCdpClient::new(config.clone());
        let snapshot_cache = SnapshotCache::new(config.snapshot_cache_limit);
        Self {
            config,
            client,
            session: None,
            browser: None,
            page: None,
            handler: None,
            health: CdpHealthSnapshot::default(),
            health_worker: None,
            reconnect_worker: None,
            idle_worker: None,
            runtime_event_worker: None,
            worker_shutdown: None,
            manager_handle: None,
            snapshot_cache,
            test_page_state_captures: VecDeque::new(),
            test_page_state_capture_count: 0,
            event_bus,
            last_activity: Instant::now(),
            last_activity_at_ms: Utc::now().timestamp_millis(),
            last_successful_action: None,
        }
    }

    pub fn has_connection(&self) -> bool {
        self.browser.is_some() && self.page.is_some()
    }

    pub fn page_cloned(&self) -> Option<Page> {
        self.page.clone()
    }

    pub fn session_snapshot(&self) -> Option<BrowserSession> {
        self.session.clone()
    }

    pub fn cached_page_state(&self) -> Option<PageState> {
        self.snapshot_cache.peek_active_page_state()
    }

    pub fn consume_cached_page_state(&mut self) -> Option<PageState> {
        let active_key = self.snapshot_cache.active_key().map(str::to_string);
        let page_state = self.snapshot_cache.active_page_state();
        if let (Some(cache_key), Some(page_state)) = (active_key.as_deref(), page_state.as_ref()) {
            self.record_snapshot_cache_hit_event(cache_key, &page_state.url);
        }
        page_state
    }

    pub(crate) fn set_cached_page_state_for_test(&mut self, page_state: PageState) {
        let cache_metadata =
            crate::browser::dom::PageStateCacheMetadata::from_page_state(&page_state, "viewport:test");
        let cache_key = self.build_snapshot_cache_key(&page_state, &cache_metadata);
        self.store_page_state_in_cache(cache_key, &page_state);
    }

    pub(crate) fn enqueue_page_state_capture_for_test(
        &mut self,
        result: Result<PageState, CdpError>,
    ) {
        self.test_page_state_captures.push_back(result);
    }

    pub(crate) fn page_state_capture_count_for_test(&self) -> usize {
        self.test_page_state_capture_count
    }

    #[cfg(test)]
    pub(crate) fn snapshot_cache_entry_count_for_test(&self) -> usize {
        self.snapshot_cache.len()
    }

    pub(crate) async fn install_connected_page_for_test(
        &mut self,
        page: Page,
        launch_mode: BrowserLaunchMode,
    ) -> Result<(), CdpError> {
        self.page = Some(page);
        self.health.mark_healthy();
        self.snapshot_cache.clear();
        self.session = Some(BrowserSession::new(
            "ws://browser-action-test/devtools/browser/test".to_string(),
            launch_mode,
            self.health.clone(),
        ));
        self.restart_runtime_event_worker_if_running();
        self.touch_activity();
        self.refresh_session_metadata().await?;
        self.sync_session_health();
        Ok(())
    }

    pub fn observability_snapshot(&self) -> BrowserObservabilitySnapshot {
        self.event_bus.snapshot(
            self.snapshot_cache.snapshot(),
            self.last_activity_at_ms,
            duration_as_ms(self.config.idle_timeout),
        )
    }

    pub fn export_benchmark_markdown(&self) -> String {
        self.event_bus.export_markdown()
    }

    pub fn note_manual_activity(&mut self) {
        self.touch_activity();
    }

    pub(super) fn worker_snapshot(&self) -> Option<WorkerSnapshot> {
        let page = self.page.clone()?;
        Some(WorkerSnapshot {
            client: self.client.clone(),
            page,
        })
    }

    pub fn connection_state(&self) -> BrowserConnectionState {
        BrowserConnectionState {
            connected: self.has_connection(),
            launch_mode: self
                .session
                .as_ref()
                .map(|session| session.launch_mode.as_str().to_string()),
            health_status: self.health.status.as_str().to_string(),
            health_failures: self.health.consecutive_failures,
            health_last_transition_at_ms: self.health.last_transition_at_ms,
            websocket_url: self
                .session
                .as_ref()
                .map(|session| session.browser_ws_url.clone()),
            current_url: self
                .session
                .as_ref()
                .and_then(|session| session.current_url.clone()),
            last_error: self.health.last_error.clone(),
            target_id: self
                .session
                .as_ref()
                .and_then(|session| session.target_id.clone()),
            session_id: self
                .session
                .as_ref()
                .and_then(|session| session.session_id.clone()),
            last_activity_at_ms: self.last_activity_at_ms,
            idle_timeout_ms: duration_as_ms(self.config.idle_timeout),
        }
    }

    pub async fn disconnect(&mut self) {
        let session_id = self
            .session
            .as_ref()
            .and_then(|session| session.session_id.clone())
            .or_else(|| self.session.as_ref().and_then(|session| session.target_id.clone()))
            .unwrap_or_else(|| "browser-session".to_string());

        let _ = self
            .cleanup_session(&session_id, CleanupReason::UserClosed)
            .await;
    }

    pub(super) fn touch_activity(&mut self) {
        self.last_activity = Instant::now();
        self.last_activity_at_ms = Utc::now().timestamp_millis();
        if let Some(session) = self.session.as_mut() {
            session.last_activity_at_ms = self.last_activity_at_ms;
        }
    }

    pub(super) fn idle_timed_out(&self) -> bool {
        self.last_activity.elapsed() >= self.config.idle_timeout
    }

    pub(super) fn idle_elapsed_ms(&self) -> u64 {
        duration_as_ms(self.last_activity.elapsed())
    }

}

#[async_trait::async_trait]
impl SessionCleanup for BrowserSessionManager {
    async fn cleanup_session(
        &mut self,
        _session_id: &str,
        reason: CleanupReason,
    ) -> Result<(), CdpError> {
        self.disconnect_with_reason(reason.as_reason_key(), reason.is_idle_cleanup())
            .await;
        Ok(())
    }
}

#[derive(Clone)]
pub(super) struct WorkerSnapshot {
    pub client: ChromiumoxideCdpClient,
    pub page: Page,
}

pub(super) fn duration_as_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

pub(super) fn runtime_invalidation_reason_label(reason: &str) -> &'static str {
    match reason {
        "cdp_frame_navigated" => "frameNavigated",
        "cdp_same_document_navigation" => "sameDocumentNavigation",
        "cdp_frame_detached" => "frameDetached",
        "cdp_document_opened" => "documentOpened",
        "cdp_dom_document_updated" => "domDocumentUpdated",
        "manual_invalidation" => "manualInvalidation",
        _ => "unknownInvalidation",
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_timeout_uses_last_activity_timestamp() {
        let mut config = CdpConfig::default();
        config.idle_timeout = Duration::from_secs(5);
        let mut manager = BrowserSessionManager::new(config);

        assert!(!manager.idle_timed_out());

        manager.last_activity = Instant::now() - Duration::from_secs(6);
        assert!(manager.idle_timed_out());

        manager.note_manual_activity();
        assert!(!manager.idle_timed_out());
    }
}
