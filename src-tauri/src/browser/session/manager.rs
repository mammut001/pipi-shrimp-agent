use std::collections::VecDeque;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use chrono::Utc;
use chromiumoxide::browser::Browser;
use chromiumoxide::cdp::browser_protocol::dom::EventDocumentUpdated;
use chromiumoxide::cdp::browser_protocol::page::{
    EventDocumentOpened, EventFrameDetached, EventFrameNavigated, EventNavigatedWithinDocument,
};
use chromiumoxide::cdp::browser_protocol::target::{TargetId, TargetInfo};
use chromiumoxide::page::Page;
use futures::StreamExt;
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

use crate::browser::cdp::health::CdpHealthStatus;
use crate::browser::cdp::{
    discover_browser_ws_url, CdpConfig, CdpError, CdpHealthSnapshot, ChromiumoxideCdpClient,
};
use crate::browser::dom::PageStateCacheMetadata;
use crate::browser::dom::{self as dom, InteractiveElement, PageState};
use crate::browser::observability::{
    sample_process_memory_bytes, BrowserBenchmarkKind, BrowserEventBus, BrowserEventKind,
    BrowserEventLevel, BrowserObservabilitySnapshot,
};
use crate::browser::session::reconnect::next_reconnect_delay;
use crate::browser::session::snapshot_cache::{SnapshotCache, SnapshotCacheKey};

use super::state::{BrowserLaunchMode, BrowserSession};
use super::BrowserConnectionState;

const EXISTING_TARGET_SETTLE_DELAY_MS: u64 = 75;
const PING_FAILURES_BEFORE_DEGRADED: u32 = 2;

pub struct BrowserSessionManager {
    config: CdpConfig,
    client: ChromiumoxideCdpClient,
    session: Option<BrowserSession>,
    browser: Option<Browser>,
    page: Option<Page>,
    handler: Option<JoinHandle<()>>,
    health: CdpHealthSnapshot,
    health_worker: Option<JoinHandle<()>>,
    reconnect_worker: Option<JoinHandle<()>>,
    idle_worker: Option<JoinHandle<()>>,
    runtime_event_worker: Option<JoinHandle<()>>,
    worker_shutdown: Option<watch::Sender<bool>>,
    manager_handle: Option<Weak<Mutex<BrowserSessionManager>>>,
    snapshot_cache: SnapshotCache,
    test_page_state_captures: VecDeque<Result<PageState, CdpError>>,
    test_page_state_capture_count: usize,
    event_bus: BrowserEventBus,
    last_activity: Instant,
    last_activity_at_ms: i64,
}

impl Default for BrowserSessionManager {
    fn default() -> Self {
        Self::new(CdpConfig::from_env())
    }
}

impl BrowserSessionManager {
    pub fn new(config: CdpConfig) -> Self {
        let event_bus = BrowserEventBus::new(config.event_history_limit, config.benchmark_sample_limit);
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
        self.snapshot_cache.active_page_state()
    }

    pub(crate) fn set_cached_page_state_for_test(&mut self, page_state: PageState) {
        let cache_metadata = PageStateCacheMetadata::from_page_state(&page_state, "viewport:test");
        self.store_page_state_in_cache(&page_state, &cache_metadata);
    }

    pub(crate) fn enqueue_page_state_capture_for_test(&mut self, result: Result<PageState, CdpError>) {
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

    pub fn invalidate_page_state(&mut self) {
        self.snapshot_cache.invalidate_active("manual_invalidation");
    }

    fn invalidate_page_state_for_runtime_event(&mut self, reason: &'static str) -> bool {
        self.touch_activity();
        self.snapshot_cache.invalidate_active(reason).is_some()
    }

    fn upgrade_runtime_event_invalidation_reason(
        &mut self,
        from_reason: &'static str,
        to_reason: &'static str,
    ) -> bool {
        self.touch_activity();
        self.snapshot_cache
            .upgrade_latest_invalidation_reason(from_reason, to_reason)
    }

    pub fn worker_snapshot(&self) -> Option<WorkerSnapshot> {
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
            websocket_url: self.session.as_ref().map(|session| session.browser_ws_url.clone()),
            current_url: self.session.as_ref().and_then(|session| session.current_url.clone()),
            last_error: self.health.last_error.clone(),
            target_id: self.session.as_ref().and_then(|session| session.target_id.clone()),
            session_id: self.session.as_ref().and_then(|session| session.session_id.clone()),
            last_activity_at_ms: self.last_activity_at_ms,
            idle_timeout_ms: duration_as_ms(self.config.idle_timeout),
        }
    }

    pub async fn connect_attach(&mut self) -> Result<BrowserSession, CdpError> {
        if self.has_connection() {
            return self.session_snapshot().ok_or_else(|| {
                CdpError::Session("Manager is connected but session metadata is missing".to_string())
            });
        }

        let connect_started_at = Instant::now();
        let previous_status = self.health.status;
        self.health.mark_connecting();
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();

        let result: Result<BrowserSession, CdpError> = async {
            let ws_url = discover_browser_ws_url(&self.config).await?;
            self.connect_with_ws_url(ws_url, BrowserLaunchMode::Attach).await
        }
        .await;

        if let Err(error) = &result {
            let previous_status = self.health.status;
            self.health.mark_failed(error.to_string());
            self.emit_health_event_if_changed(previous_status);
            self.sync_session_health();
            self.record_connect_benchmark(
                BrowserLaunchMode::Attach,
                duration_as_ms(connect_started_at.elapsed()),
                false,
                Some(error.to_string()),
            );
        } else {
            self.record_connect_benchmark(
                BrowserLaunchMode::Attach,
                duration_as_ms(connect_started_at.elapsed()),
                true,
                None,
            );
        }

        result
    }

    pub async fn connect_launch(&mut self) -> Result<BrowserSession, CdpError> {
        if self.has_connection() {
            return self.session_snapshot().ok_or_else(|| {
                CdpError::Session("Manager is connected but session metadata is missing".to_string())
            });
        }

        let connect_started_at = Instant::now();
        let previous_status = self.health.status;
        self.health.mark_connecting();
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
        let deadline = Instant::now() + self.config.timeout;

        let timeout_error = loop {
            match discover_browser_ws_url(&self.config).await {
                Ok(ws_url) => {
                    let result = self.connect_with_ws_url(ws_url, BrowserLaunchMode::Launch).await;
                    if let Err(error) = &result {
                        let previous_status = self.health.status;
                        self.health.mark_failed(error.to_string());
                        self.emit_health_event_if_changed(previous_status);
                        self.sync_session_health();
                        self.record_connect_benchmark(
                            BrowserLaunchMode::Launch,
                            duration_as_ms(connect_started_at.elapsed()),
                            false,
                            Some(error.to_string()),
                        );
                    } else {
                        self.record_connect_benchmark(
                            BrowserLaunchMode::Launch,
                            duration_as_ms(connect_started_at.elapsed()),
                            true,
                            None,
                        );
                    }
                    return result;
                }
                Err(error) => {
                    let error_message = error.to_string();

                    if Instant::now() >= deadline {
                        break CdpError::Discovery(format!(
                            "Chrome debug port did not become ready within {}ms: {}",
                            self.config.timeout.as_millis(),
                            error_message
                        ));
                    }

                    let previous_status = self.health.status;
                    self.health.mark_reconnecting(error_message);
                    self.emit_health_event_if_changed(previous_status);
                    self.sync_session_health();
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        };

        let previous_status = self.health.status;
        self.health.mark_failed(timeout_error.to_string());
        self.emit_health_event_if_changed(previous_status);
        self.sync_session_health();
        self.record_connect_benchmark(
            BrowserLaunchMode::Launch,
            duration_as_ms(connect_started_at.elapsed()),
            false,
            Some(timeout_error.to_string()),
        );
        Err(timeout_error)
    }

    pub async fn resync_page(&mut self) -> Result<(), CdpError> {
        let browser = self
            .browser
            .as_ref()
            .ok_or_else(|| CdpError::Session("Browser not connected".to_string()))?;

        let active_page = self.select_active_page(browser).await?;
        self.page = Some(active_page);
    self.restart_runtime_event_worker_if_running();
        self.refresh_session_metadata().await?;
        self.touch_activity();
        self.record_navigation_event(
            self.session.as_ref().and_then(|session| session.current_url.clone()),
            Some("Page reference re-synced".to_string()),
        );
        self.invalidate_page_state();
        Ok(())
    }

    pub async fn capture_page_state(&mut self) -> Result<PageState, CdpError> {
        self.capture_page_state_with_mode(true).await
    }

    async fn capture_page_state_with_mode(&mut self, emit_observability: bool) -> Result<PageState, CdpError> {
        let capture_started_at = Instant::now();
        let memory_before = sample_process_memory_bytes();
        self.snapshot_cache.record_miss();

        if let Some(result) = self.test_page_state_captures.pop_front() {
            self.test_page_state_capture_count += 1;
            let page_state = result?;
            let memory_after = sample_process_memory_bytes();
            let cache_metadata = PageStateCacheMetadata::from_page_state(&page_state, "viewport:test");
            return Ok(self.record_captured_page_state(
                page_state,
                cache_metadata,
                emit_observability,
                capture_started_at,
                memory_before,
                memory_after,
            ));
        }

        let page = self
            .page
            .as_ref()
            .ok_or_else(|| CdpError::Session("Browser not connected".to_string()))?;
        let capture = dom::capture_page_state_capture(page, self.config.timeout).await?;
        let memory_after = sample_process_memory_bytes();

        Ok(self.record_captured_page_state(
            capture.page_state,
            capture.cache_metadata,
            emit_observability,
            capture_started_at,
            memory_before,
            memory_after,
        ))
    }

    fn record_captured_page_state(
        &mut self,
        page_state: PageState,
        cache_metadata: PageStateCacheMetadata,
        emit_observability: bool,
        capture_started_at: Instant,
        memory_before: Option<u64>,
        memory_after: Option<u64>,
    ) -> PageState {
        if let Some(session) = self.session.as_mut() {
            session.current_url = Some(page_state.url.clone());
            session.last_navigation_id = Some(page_state.navigation_id.clone());
            session.health = self.health.clone();
        }

        self.store_page_state_in_cache(&page_state, &cache_metadata);
        if emit_observability {
            let benchmark = self.build_benchmark_sample(
                "page_state".to_string(),
                "get_page_state".to_string(),
                BrowserBenchmarkKind::PageState,
                duration_as_ms(capture_started_at.elapsed()),
                true,
                Some(page_state.url.clone()),
                None,
                memory_before,
                memory_after,
            );
            self.event_bus.publish(
                BrowserEventKind::PageStateUpdated,
                BrowserEventLevel::Success,
                if page_state.title.trim().is_empty() {
                    "PageState updated".to_string()
                } else {
                    page_state.title.clone()
                },
                Some(page_state.url.clone()),
                None,
                Some(benchmark),
            );
        }

        page_state
    }

    fn store_page_state_in_cache(
        &mut self,
        page_state: &PageState,
        cache_metadata: &PageStateCacheMetadata,
    ) {
        let cache_key = self.build_snapshot_cache_key(page_state, cache_metadata);
        self.snapshot_cache.store(cache_key, page_state.clone());
    }

    fn build_snapshot_cache_key(
        &self,
        page_state: &PageState,
        cache_metadata: &PageStateCacheMetadata,
    ) -> SnapshotCacheKey {
        SnapshotCacheKey::new(
            self.session
                .as_ref()
                .and_then(|session| session.target_id.clone())
                .unwrap_or_else(|| "cdp-target".to_string()),
            page_state.navigation_id.clone(),
            cache_metadata.viewport_signature.clone(),
            cache_metadata.dom_version.clone(),
        )
    }

    pub async fn page_state_text(&mut self) -> Result<String, CdpError> {
        Ok(self.capture_page_state().await?.to_text())
    }

    pub async fn resolve_interactive_element(
        &mut self,
        element_index: u64,
    ) -> Result<InteractiveElement, CdpError> {
        let page_state = match self.cached_page_state() {
            Some(page_state) => page_state,
            None => self.capture_page_state().await?,
        };

        page_state
            .find_element(element_index)
            .cloned()
            .ok_or_else(|| {
                CdpError::Session(format!(
                    "Interactive element {} not found in current page state",
                    element_index
                ))
            })
    }

    pub async fn refresh_connection_metadata(&mut self) -> Result<(), CdpError> {
        self.refresh_session_metadata().await
    }

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
        error: Option<String>,
    ) {
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

    pub fn start_background_workers(&mut self, manager_handle: Arc<Mutex<BrowserSessionManager>>) {
        self.manager_handle = Some(Arc::downgrade(&manager_handle));
        self.stop_background_workers();

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.worker_shutdown = Some(shutdown_tx);
        self.health_worker = Some(spawn_health_worker(manager_handle.clone(), shutdown_rx));
        let idle_shutdown_rx = self
            .worker_shutdown
            .as_ref()
            .map(|shutdown| shutdown.subscribe())
            .expect("idle worker shutdown channel should exist");
        self.idle_worker = Some(spawn_idle_worker(manager_handle.clone(), idle_shutdown_rx));
        self.restart_runtime_event_worker_if_running();
    }

    pub async fn disconnect(&mut self) {
        self.disconnect_with_reason("manual_disconnect", false).await;
    }

    fn stop_background_workers(&mut self) {
        if let Some(shutdown_tx) = self.worker_shutdown.take() {
            let _ = shutdown_tx.send(true);
        }
        if let Some(worker) = self.health_worker.take() {
            worker.abort();
        }
        if let Some(worker) = self.reconnect_worker.take() {
            worker.abort();
        }
        if let Some(worker) = self.runtime_event_worker.take() {
            worker.abort();
        }
        self.idle_worker.take();
    }

    async fn connect_with_ws_url(
        &mut self,
        ws_url: String,
        launch_mode: BrowserLaunchMode,
    ) -> Result<BrowserSession, CdpError> {
        let (mut browser, handler) = self.client.connect(&ws_url).await?;
        let page = match launch_mode {
            BrowserLaunchMode::Attach => self.select_attach_page(&mut browser).await?,
            BrowserLaunchMode::Launch => self.select_active_page(&browser).await?,
        };

        self.replace_runtime(browser, page, handler, ws_url, launch_mode).await?;
        self.session_snapshot().ok_or_else(|| {
            CdpError::Session("Connected to browser but failed to materialize session metadata".to_string())
        })
    }

    async fn select_attach_page(&self, browser: &mut Browser) -> Result<Page, CdpError> {
        select_attach_page_with_client(&self.client, browser).await
    }

    async fn select_active_page(&self, browser: &Browser) -> Result<Page, CdpError> {
        select_active_page_with_client(&self.client, browser).await
    }

    async fn replace_runtime(
        &mut self,
        browser: Browser,
        page: Page,
        handler: JoinHandle<()>,
        ws_url: String,
        launch_mode: BrowserLaunchMode,
    ) -> Result<(), CdpError> {
        if let Some(old_handler) = self.handler.take() {
            old_handler.abort();
        }

        let previous_status = self.health.status;
        self.browser = Some(browser);
        self.page = Some(page);
        self.handler = Some(handler);
        self.health.mark_healthy();
        self.snapshot_cache.clear();
        self.session = Some(BrowserSession::new(ws_url, launch_mode, self.health.clone()));
        self.restart_runtime_event_worker_if_running();
        self.touch_activity();
        self.refresh_session_metadata().await?;
        self.sync_session_health();
        self.event_bus.publish(
            BrowserEventKind::Connected,
            BrowserEventLevel::Success,
            format!("Browser connected ({})", launch_mode.as_str()),
            self.session.as_ref().and_then(|session| session.current_url.clone()),
            None,
            None,
        );
        self.emit_health_event_if_changed(previous_status);
        Ok(())
    }

    async fn refresh_session_metadata(&mut self) -> Result<(), CdpError> {
        let (current_url, target_id, session_id) = match self.page.as_ref() {
            Some(page) => (
                self.client.page_url(page).await?,
                Some(page.target_id().as_ref().to_string()),
                Some(page.session_id().as_ref().to_string()),
            ),
            None => (None, None, None),
        };

        if let Some(session) = self.session.as_mut() {
            session.current_url = current_url;
            session.target_id = target_id;
            session.session_id = session_id;
            session.health = self.health.clone();
            session.last_activity_at_ms = self.last_activity_at_ms;
        }

        Ok(())
    }

    fn sync_session_health(&mut self) {
        if let Some(session) = self.session.as_mut() {
            session.health = self.health.clone();
            session.last_activity_at_ms = self.last_activity_at_ms;
        }
    }

    fn touch_activity(&mut self) {
        self.last_activity = Instant::now();
        self.last_activity_at_ms = Utc::now().timestamp_millis();
        if let Some(session) = self.session.as_mut() {
            session.last_activity_at_ms = self.last_activity_at_ms;
        }
    }

    fn idle_timed_out(&self) -> bool {
        self.last_activity.elapsed() >= self.config.idle_timeout
    }

    fn idle_elapsed_ms(&self) -> u64 {
        duration_as_ms(self.last_activity.elapsed())
    }

    fn build_benchmark_sample(
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

    fn record_connect_benchmark(
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

    fn emit_health_event_if_changed(&self, previous_status: CdpHealthStatus) {
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

    fn record_navigation_event(&self, current_url: Option<String>, title: Option<String>) {
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

    async fn disconnect_with_reason(&mut self, reason: &str, idle_cleanup: bool) {
        let launch_mode = self.session.as_ref().map(|session| session.launch_mode);
        let idle_elapsed_ms = self.idle_elapsed_ms();

        if idle_cleanup {
            let launch_mode_label = launch_mode
                .map(|mode| mode.as_str().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let benchmark = self.event_bus.build_benchmark_sample(
                format!("idle_cleanup.{}", launch_mode_label),
                format!("idle cleanup ({})", launch_mode_label),
                BrowserBenchmarkKind::IdleCleanup,
                Some(launch_mode_label.clone()),
                idle_elapsed_ms,
                true,
                Some(reason.to_string()),
                None,
                None,
                None,
            );
            self.event_bus.publish(
                BrowserEventKind::IdleCleanup,
                BrowserEventLevel::Warning,
                "Idle cleanup triggered",
                Some(reason.to_string()),
                None,
                Some(benchmark),
            );
        }

        self.stop_background_workers();

        if matches!(launch_mode, Some(BrowserLaunchMode::Launch)) {
            if let Some(browser) = self.browser.as_mut() {
                let _ = tokio::time::timeout(self.config.timeout, browser.close()).await;
            }
        }

        if let Some(handler) = self.handler.take() {
            handler.abort();
        }

        self.page = None;
        self.browser = None;
        self.session = None;
        self.snapshot_cache.clear();

        let previous_status = self.health.status;
        self.health.mark_disconnected();
        self.emit_health_event_if_changed(previous_status);
        self.event_bus.publish(
            BrowserEventKind::Disconnected,
            BrowserEventLevel::Warning,
            "Browser disconnected",
            Some(reason.to_string()),
            None,
            None,
        );
    }

    fn restart_runtime_event_worker_if_running(&mut self) {
        if let Some(worker) = self.runtime_event_worker.take() {
            worker.abort();
        }

        let Some(manager_handle) = self.manager_handle.as_ref().and_then(Weak::upgrade) else {
            return;
        };
        let Some(shutdown_rx) = self.worker_shutdown.as_ref().map(|shutdown| shutdown.subscribe()) else {
            return;
        };

        self.runtime_event_worker = Some(spawn_runtime_event_worker(manager_handle, shutdown_rx));
    }
}

#[derive(Clone)]
pub struct WorkerSnapshot {
    pub client: ChromiumoxideCdpClient,
    pub page: Page,
}

fn duration_as_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn spawn_health_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let ping_interval = {
            let manager = manager_handle.lock().await;
            manager.config.ping_interval
        };
        let mut ticker = tokio::time::interval(ping_interval);

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                _ = ticker.tick() => {
                    let snapshot = {
                        let manager = manager_handle.lock().await;
                        manager.worker_snapshot()
                    };

                    let Some(snapshot) = snapshot else {
                        continue;
                    };

                    match snapshot.client.page_url(&snapshot.page).await {
                        Ok(current_url) => {
                            let mut manager = manager_handle.lock().await;
                            manager.record_ping_success(current_url);
                        }
                        Err(error) => {
                            let should_reconnect = {
                                let mut manager = manager_handle.lock().await;
                                if manager.reconnect_worker_running() {
                                    manager.mark_reconnecting(error.to_string());
                                    false
                                } else {
                                    manager.record_ping_failure(error.to_string())
                                }
                            };

                            if should_reconnect {
                                maybe_spawn_reconnect_worker(manager_handle.clone()).await;
                            }
                        }
                    }
                }
            }
        }
    })
}

fn spawn_idle_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let idle_check_interval = {
            let manager = manager_handle.lock().await;
            manager.config.idle_check_interval
        };
        let mut ticker = tokio::time::interval(idle_check_interval);

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                _ = ticker.tick() => {
                    let should_cleanup = {
                        let manager = manager_handle.lock().await;
                        manager.has_connection() && manager.idle_timed_out()
                    };

                    if !should_cleanup {
                        continue;
                    }

                    let mut manager = manager_handle.lock().await;
                    if manager.has_connection() && manager.idle_timed_out() {
                        manager.disconnect_with_reason("idle_timeout", true).await;
                    }
                }
            }
        }
    })
}

fn spawn_runtime_event_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let page = {
            let manager = manager_handle.lock().await;
            manager.page_cloned()
        };

        let Some(page) = page else {
            return;
        };

        let mut frame_navigated = match page.event_listener::<EventFrameNavigated>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut navigated_within_document = match page.event_listener::<EventNavigatedWithinDocument>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut frame_detached = match page.event_listener::<EventFrameDetached>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut document_opened = match page.event_listener::<EventDocumentOpened>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };
        let mut document_updated = match page.event_listener::<EventDocumentUpdated>().await {
            Ok(stream) => stream,
            Err(_) => return,
        };

        loop {
            tokio::select! {
                biased;
                _ = shutdown_rx.changed() => {
                    break;
                }
                event = frame_navigated.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_frame_navigated");
                }
                event = navigated_within_document.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_same_document_navigation");
                }
                event = frame_detached.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_frame_detached");
                }
                event = document_updated.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    if !manager.invalidate_page_state_for_runtime_event("cdp_dom_document_updated") {
                        let upgraded_from_document_opened = manager.upgrade_runtime_event_invalidation_reason(
                            "cdp_document_opened",
                            "cdp_dom_document_updated",
                        );
                        if !upgraded_from_document_opened {
                            manager.upgrade_runtime_event_invalidation_reason(
                                "cdp_frame_detached",
                                "cdp_dom_document_updated",
                            );
                        }
                    }
                }
                event = document_opened.next() => {
                    let Some(_) = event else {
                        break;
                    };
                    let mut manager = manager_handle.lock().await;
                    manager.invalidate_page_state_for_runtime_event("cdp_document_opened");
                }
            }
        }
    })
}

async fn maybe_spawn_reconnect_worker(manager_handle: Arc<Mutex<BrowserSessionManager>>) {
    let mut manager = manager_handle.lock().await;
    if manager.reconnect_worker_running() {
        return;
    }

    let Some(shutdown_rx) = manager.worker_shutdown.as_ref().map(|tx| tx.subscribe()) else {
        return;
    };

    manager.reconnect_worker = Some(spawn_reconnect_worker(manager_handle.clone(), shutdown_rx));
}

fn spawn_reconnect_worker(
    manager_handle: Arc<Mutex<BrowserSessionManager>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut attempt = 0_u32;

        loop {
            let (launch_mode, config) = {
                let mut manager = manager_handle.lock().await;

                if manager.health.status == CdpHealthStatus::Healthy {
                    manager.clear_reconnect_worker();
                    return;
                }

                let Some(session) = manager.session_snapshot() else {
                    manager.clear_reconnect_worker();
                    return;
                };

                manager.mark_reconnecting(format!("reconnect attempt {}", attempt + 1));
                (session.launch_mode, manager.config.clone())
            };

            let delay = next_reconnect_delay(attempt, &config);
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    let mut manager = manager_handle.lock().await;
                    manager.clear_reconnect_worker();
                    return;
                }
                _ = tokio::time::sleep(delay) => {}
            }

            let reconnect_result = match discover_browser_ws_url(&config).await {
                Ok(ws_url) => build_runtime_from_ws_url(&config, launch_mode, ws_url).await,
                Err(error) => Err(error),
            };

            match reconnect_result {
                Ok(runtime) => {
                    let mut manager = manager_handle.lock().await;
                    if let Err(error) = manager
                        .replace_runtime(
                            runtime.browser,
                            runtime.page,
                            runtime.handler,
                            runtime.ws_url,
                            runtime.launch_mode,
                        )
                        .await
                    {
                        manager.health.mark_failed(error.to_string());
                        manager.sync_session_health();
                        attempt = attempt.saturating_add(1);
                        continue;
                    }
                    manager.clear_reconnect_worker();
                    return;
                }
                Err(error) => {
                    let mut manager = manager_handle.lock().await;
                    manager.mark_reconnecting(error.to_string());
                }
            }

            attempt = attempt.saturating_add(1);
        }
    })
}

struct ConnectedRuntime {
    browser: Browser,
    page: Page,
    handler: JoinHandle<()>,
    ws_url: String,
    launch_mode: BrowserLaunchMode,
}

async fn build_runtime_from_ws_url(
    config: &CdpConfig,
    launch_mode: BrowserLaunchMode,
    ws_url: String,
) -> Result<ConnectedRuntime, CdpError> {
    let client = ChromiumoxideCdpClient::new(config.clone());
    let (mut browser, handler) = client.connect(&ws_url).await?;
    let page = match launch_mode {
        BrowserLaunchMode::Attach => select_attach_page_with_client(&client, &mut browser).await?,
        BrowserLaunchMode::Launch => select_active_page_with_client(&client, &browser).await?,
    };

    Ok(ConnectedRuntime {
        browser,
        page,
        handler,
        ws_url,
        launch_mode,
    })
}

async fn select_attach_page_with_client(
    client: &ChromiumoxideCdpClient,
    browser: &mut Browser,
) -> Result<Page, CdpError> {
    let targets = match client.fetch_targets(browser).await {
        Ok(targets) => {
            if !targets.is_empty() {
                tokio::time::sleep(Duration::from_millis(EXISTING_TARGET_SETTLE_DELAY_MS)).await;
            }
            targets
        }
        Err(_) => Vec::new(),
    };

    let pages = client.list_pages(browser).await?;
    match select_attach_page_candidate(pages, &targets) {
        Some(page) => Ok(page),
        None => client.new_page(browser, "about:blank").await,
    }
}

async fn select_active_page_with_client(
    client: &ChromiumoxideCdpClient,
    browser: &Browser,
) -> Result<Page, CdpError> {
    let pages = client.list_pages(browser).await?;
    let mut fallback_page: Option<Page> = None;

    for page in pages {
        let page_url = client.page_url(&page).await.ok().flatten();
        if matches!(page_url.as_deref(), Some(url) if !url.trim().is_empty() && url != "about:blank") {
            return Ok(page);
        }

        if fallback_page.is_none() {
            fallback_page = Some(page);
        }
    }

    match fallback_page {
        Some(page) => Ok(page),
        None => client.new_page(browser, "about:blank").await,
    }
}

fn select_attach_page_candidate(mut pages: Vec<Page>, targets: &[TargetInfo]) -> Option<Page> {
    if let Some(target_id) = select_attach_target_id(targets) {
        if let Some(index) = pages.iter().position(|page| page.target_id() == &target_id) {
            return Some(pages.swap_remove(index));
        }
    }

    pages.into_iter().next()
}

fn select_attach_target_id(targets: &[TargetInfo]) -> Option<TargetId> {
    select_attach_target(targets).map(|target| target.target_id.clone())
}

fn select_attach_target(targets: &[TargetInfo]) -> Option<&TargetInfo> {
    targets.iter().min_by_key(|target| attach_target_sort_key(target))
}

fn attach_target_sort_key(target: &TargetInfo) -> (u8, u8, u8, u8, &str, &str) {
    let is_not_page = u8::from(target.r#type != "page");
    let is_blank = u8::from(is_blank_target_url(&target.url));
    let has_opener = u8::from(target.opener_id.is_some());
    let missing_title = u8::from(target.title.trim().is_empty());

    (
        is_not_page,
        is_blank,
        has_opener,
        missing_title,
        target.url.as_str(),
        target.title.as_str(),
    )
}

fn is_blank_target_url(url: &str) -> bool {
    let normalized = url.trim();
    normalized.is_empty() || normalized == "about:blank"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_page_state(navigation_id: &str, backend_node_id: i64) -> PageState {
        PageState {
            url: format!("https://example.com/{}", navigation_id),
            title: format!("Page {}", navigation_id),
            navigation_id: navigation_id.to_string(),
            frame_count: 1,
            warnings: Vec::new(),
            elements: vec![InteractiveElement {
                index: 0,
                backend_node_id,
                frame_id: "root".to_string(),
                role: "button".to_string(),
                name: "Continue".to_string(),
                tag_name: Some("button".to_string()),
                bounds: None,
                is_visible: true,
                is_clickable: true,
                is_editable: false,
                selector_hint: Some("#continue".to_string()),
                text_hint: None,
                href: None,
                input_type: None,
            }],
            screenshot: None,
        }
    }

    fn target_info(
        target_id: &str,
        target_type: &str,
        url: &str,
        title: &str,
        opener_id: Option<&str>,
    ) -> TargetInfo {
        let mut builder = TargetInfo::builder()
            .target_id(TargetId::new(target_id))
            .r#type(target_type)
            .title(title)
            .url(url)
            .attached(false)
            .can_access_opener(false);

        if let Some(opener_id) = opener_id {
            builder = builder.opener_id(TargetId::new(opener_id));
        }

        builder.build().expect("target info fixture should be valid")
    }

    #[test]
    fn test_select_attach_target_prefers_non_blank_top_level_page() {
        let targets = vec![
            target_info("blank", "page", "about:blank", "", None),
            target_info("popup", "page", "https://accounts.example.com", "Sign in", Some("root")),
            target_info("main", "page", "https://github.com/copilot", "Copilot", None),
        ];

        let selected = select_attach_target(&targets).expect("should select a target");

        assert_eq!(selected.target_id.as_ref(), "main");
    }

    #[test]
    fn test_select_attach_target_falls_back_to_about_blank() {
        let targets = vec![target_info("blank", "page", "about:blank", "", None)];

        let selected = select_attach_target(&targets).expect("should select a target");

        assert_eq!(selected.target_id.as_ref(), "blank");
    }

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
        assert_eq!(manager.health.last_error.as_deref(), Some("first ping timeout"));

        assert!(manager.record_ping_failure("second ping timeout"));
        assert_eq!(manager.health.status, CdpHealthStatus::Degraded);
        assert_eq!(manager.health.consecutive_failures, 2);
        assert_eq!(manager.health.last_error.as_deref(), Some("second ping timeout"));

        manager.mark_reconnecting("reconnect started");
        assert_eq!(manager.health.status, CdpHealthStatus::Reconnecting);

        manager.record_ping_success(Some("https://github.com/copilot".to_string()));
        assert_eq!(manager.health.status, CdpHealthStatus::Healthy);
        assert_eq!(manager.health.consecutive_failures, 0);
        assert_eq!(manager.health.last_error, None);

        let session = manager.session.as_ref().expect("session should remain present");
        assert_eq!(session.health.status, CdpHealthStatus::Healthy);
        assert_eq!(session.health.consecutive_failures, 0);
        assert_eq!(session.health.last_error, None);
        assert_eq!(session.current_url.as_deref(), Some("https://github.com/copilot"));

        let state = manager.connection_state();
        assert_eq!(state.health_status, "healthy");
        assert_eq!(state.health_failures, 0);
        assert_eq!(state.current_url.as_deref(), Some("https://github.com/copilot"));
    }

    #[test]
    fn test_action_events_and_benchmarks_are_recorded() {
        let mut manager = BrowserSessionManager::new(CdpConfig::default());
        manager.session = Some(BrowserSession::new(
            "ws://127.0.0.1:9222/devtools/browser/test".to_string(),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));

        manager.record_action_started("click", Some("index=3".to_string()));
        manager.record_action_finished("click", Some("index=3".to_string()), 120, true, None);

        let snapshot = manager.observability_snapshot();
        assert_eq!(snapshot.recent_events.len(), 2);
        assert!(snapshot
            .benchmark_report
            .metrics
            .iter()
            .any(|metric| metric.key == "action.click" && metric.sample_count == 1));
    }

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

    #[test]
    fn test_snapshot_cache_tracks_active_entry_and_invalidates_current_page() {
        let mut config = CdpConfig::default();
        config.snapshot_cache_limit = 2;
        let mut manager = BrowserSessionManager::new(config);
        manager.session = Some(BrowserSession::new(
            "ws://127.0.0.1:9222/devtools/browser/test".to_string(),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));
        manager
            .session
            .as_mut()
            .expect("session should be present")
            .target_id = Some("target-main".to_string());

        manager.set_cached_page_state_for_test(sample_page_state("nav-1", 101));
        manager.set_cached_page_state_for_test(sample_page_state("nav-2", 202));

        assert_eq!(manager.snapshot_cache_entry_count_for_test(), 2);
        assert_eq!(
            manager
                .cached_page_state()
                .as_ref()
                .map(|page_state| page_state.navigation_id.as_str()),
            Some("nav-2")
        );

        manager.invalidate_page_state();

        assert!(manager.cached_page_state().is_none());
        assert_eq!(manager.snapshot_cache_entry_count_for_test(), 2);

        manager.set_cached_page_state_for_test(sample_page_state("nav-3", 303));

        assert_eq!(manager.snapshot_cache_entry_count_for_test(), 2);
        assert_eq!(
            manager
                .cached_page_state()
                .as_ref()
                .map(|page_state| page_state.navigation_id.as_str()),
            Some("nav-3")
        );
    }

    #[test]
    fn test_runtime_event_invalidation_marks_active_snapshot_stale() {
        let mut config = CdpConfig::default();
        config.snapshot_cache_limit = 2;
        let mut manager = BrowserSessionManager::new(config);
        manager.session = Some(BrowserSession::new(
            "ws://127.0.0.1:9222/devtools/browser/test".to_string(),
            BrowserLaunchMode::Attach,
            manager.health.clone(),
        ));
        manager
            .session
            .as_mut()
            .expect("session should be present")
            .target_id = Some("target-main".to_string());

        manager.set_cached_page_state_for_test(sample_page_state("nav-1", 101));

        assert!(manager.invalidate_page_state_for_runtime_event("cdp_frame_navigated"));
        assert!(manager.cached_page_state().is_none());

        let snapshot = manager.observability_snapshot();
        assert_eq!(snapshot.snapshot_cache.invalidation_count, 1);
        assert_eq!(snapshot.snapshot_cache.active_key, None);
        assert_eq!(
            snapshot.snapshot_cache.entries[0].invalidation_reason.as_deref(),
            Some("cdp_frame_navigated")
        );
    }
}
