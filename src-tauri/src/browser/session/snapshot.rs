use std::time::Instant;

use crate::browser::dom::PageStateCacheMetadata;
use crate::browser::dom::{self as dom, InteractiveElement, PageState};
use crate::browser::observability::{
    sample_process_memory_bytes, BrowserBenchmarkKind, BrowserEventKind, BrowserEventLevel,
};
use crate::browser::cdp::CdpError;

use super::manager::{duration_as_ms, runtime_invalidation_reason_label, BrowserSessionManager};
use super::snapshot_cache::{SnapshotCacheEntry, SnapshotCacheKey};

impl BrowserSessionManager {
    pub fn invalidate_page_state(&mut self) {
        self.snapshot_cache.invalidate_active("manual_invalidation");
    }

    pub(super) fn invalidate_page_state_for_runtime_event(
        &mut self,
        reason: &'static str,
    ) -> bool {
        self.touch_activity();
        let invalidated = self.snapshot_cache.invalidate_active(reason);
        if let Some(entry) = invalidated.as_ref() {
            self.record_snapshot_cache_invalidation_event(
                reason,
                &entry.key.as_string(),
                &entry.page_state.url,
            );
        }
        invalidated.is_some()
    }

    pub(super) fn upgrade_runtime_event_invalidation_reason(
        &mut self,
        from_reason: &'static str,
        to_reason: &'static str,
    ) -> bool {
        self.touch_activity();
        let upgraded = self
            .snapshot_cache
            .upgrade_latest_invalidation_reason(from_reason, to_reason);
        if upgraded {
            if let Some(entry) = self.cached_invalidated_entry() {
                self.record_snapshot_cache_invalidation_event(
                    to_reason,
                    &entry.key.as_string(),
                    &entry.page_state.url,
                );
            }
        }
        upgraded
    }

    pub(super) fn cached_invalidated_entry(&self) -> Option<SnapshotCacheEntry> {
        self.snapshot_cache.latest_invalidated_entry()
    }

    pub(super) fn record_snapshot_cache_invalidation_event(
        &self,
        reason: &'static str,
        cache_key: &str,
        url: &str,
    ) {
        self.event_bus.publish_snapshot_cache_event(
            BrowserEventKind::SnapshotCacheInvalidate,
            BrowserEventLevel::Warning,
            "Snapshot cache invalidated".to_string(),
            Some(format!(
                "{} | {}",
                runtime_invalidation_reason_label(reason),
                url
            )),
            cache_key,
            url,
            Some(reason.to_string()),
        );
    }

    pub(super) fn record_snapshot_cache_hit_event(&self, cache_key: &str, url: &str) {
        self.event_bus.publish_snapshot_cache_event(
            BrowserEventKind::SnapshotCacheHit,
            BrowserEventLevel::Success,
            "Snapshot cache hit".to_string(),
            Some(url.to_string()),
            cache_key,
            url,
            None,
        );
    }

    pub(super) fn record_snapshot_cache_miss_event(
        &self,
        cache_key: Option<&str>,
        url: Option<&str>,
    ) {
        let detail = url.map(str::to_string);
        if let (Some(cache_key), Some(url)) = (cache_key, url) {
            self.event_bus.publish_snapshot_cache_event(
                BrowserEventKind::SnapshotCacheMiss,
                BrowserEventLevel::Info,
                "Snapshot cache miss".to_string(),
                detail,
                cache_key,
                url,
                None,
            );
            return;
        }

        self.event_bus.publish(
            BrowserEventKind::SnapshotCacheMiss,
            BrowserEventLevel::Info,
            "Snapshot cache miss".to_string(),
            detail,
            None,
            None,
        );
    }

    pub(super) fn record_snapshot_cache_store_event(&self, cache_key: &str, url: &str) {
        self.event_bus.publish_snapshot_cache_event(
            BrowserEventKind::SnapshotCacheStore,
            BrowserEventLevel::Success,
            "Snapshot cache stored".to_string(),
            Some(url.to_string()),
            cache_key,
            url,
            None,
        );
    }

    pub(super) fn record_snapshot_cache_evict_event(&self, key: &str, url: &str) {
        self.event_bus.publish_snapshot_cache_event(
            BrowserEventKind::SnapshotCacheEvict,
            BrowserEventLevel::Warning,
            "Snapshot cache evicted".to_string(),
            Some(format!("{} | {}", key, url)),
            key,
            url,
            None,
        );
    }

    pub async fn capture_page_state(&mut self) -> Result<PageState, CdpError> {
        self.capture_page_state_with_mode(true).await
    }

    pub(super) async fn capture_page_state_with_mode(
        &mut self,
        emit_observability: bool,
    ) -> Result<PageState, CdpError> {
        let capture_started_at = Instant::now();
        let memory_before = sample_process_memory_bytes();
        let current_url = self
            .session
            .as_ref()
            .and_then(|session| session.current_url.clone());
        self.snapshot_cache.record_miss();

        if let Some(result) = self.test_page_state_captures.pop_front() {
            self.test_page_state_capture_count += 1;
            let page_state = match result {
                Ok(page_state) => page_state,
                Err(error) => {
                    self.record_snapshot_cache_miss_event(None, current_url.as_deref());
                    return Err(error);
                }
            };
            let memory_after = sample_process_memory_bytes();
            let cache_metadata =
                PageStateCacheMetadata::from_page_state(&page_state, "viewport:test");
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
        let capture = match dom::capture_page_state_capture(page, self.config.timeout).await {
            Ok(capture) => capture,
            Err(error) => {
                self.record_snapshot_cache_miss_event(None, current_url.as_deref());
                return Err(error);
            }
        };
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

    pub(super) fn record_captured_page_state(
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

        let cache_key = self.build_snapshot_cache_key(&page_state, &cache_metadata);
        let cache_key_string = cache_key.as_string();
        self.record_snapshot_cache_miss_event(
            Some(cache_key_string.as_str()),
            Some(page_state.url.as_str()),
        );
        self.store_page_state_in_cache(cache_key, &page_state);
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

    pub(super) fn store_page_state_in_cache(
        &mut self,
        cache_key: SnapshotCacheKey,
        page_state: &PageState,
    ) {
        let store_result = self.snapshot_cache.store(cache_key, page_state.clone());
        let stored_key = store_result.entry.key.as_string();
        self.record_snapshot_cache_store_event(&stored_key, &store_result.entry.page_state.url);
        if let Some(evicted_entry) = store_result.evicted_entry.as_ref() {
            self.record_snapshot_cache_evict_event(
                &evicted_entry.key.as_string(),
                &evicted_entry.page_state.url,
            );
        }
    }

    pub(super) fn build_snapshot_cache_key(
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
}

#[cfg(test)]
mod tests {
    use crate::browser::cdp::CdpConfig;

    use super::*;
    use crate::browser::session::state::{BrowserLaunchMode, BrowserSession};

    fn sample_page_state(navigation_id: &str, backend_node_id: i64) -> PageState {
        PageState {
            url: format!("https://example.com/{}", navigation_id),
            title: format!("Page {}", navigation_id),
            navigation_id: navigation_id.to_string(),
            frame_count: 1,
            viewport: None,
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

        let page_state = sample_page_state("nav-1", 101);
        let expected_key = manager
            .build_snapshot_cache_key(
                &page_state,
                &PageStateCacheMetadata::from_page_state(&page_state, "viewport:test"),
            )
            .as_string();

        manager.set_cached_page_state_for_test(page_state);

        assert!(manager.invalidate_page_state_for_runtime_event("cdp_frame_navigated"));
        assert!(manager.cached_page_state().is_none());

        let snapshot = manager.observability_snapshot();
        assert_eq!(snapshot.snapshot_cache.invalidation_count, 1);
        assert_eq!(snapshot.snapshot_cache.active_key, None);
        assert_eq!(
            snapshot.snapshot_cache.entries[0]
                .invalidation_reason
                .as_deref(),
            Some("cdp_frame_navigated")
        );
        assert!(snapshot.recent_events.iter().any(|event| {
            event.kind == BrowserEventKind::SnapshotCacheInvalidate
                && event.detail.as_deref() == Some("frameNavigated | https://example.com/nav-1")
                && event.cache_key.as_deref() == Some(expected_key.as_str())
                && event.cache_url.as_deref() == Some("https://example.com/nav-1")
                && event.cache_reason.as_deref() == Some("cdp_frame_navigated")
        }));
    }

    #[tokio::test]
    async fn test_snapshot_cache_hit_miss_and_evict_events_are_recorded() {
        let mut config = CdpConfig::default();
        config.snapshot_cache_limit = 1;
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
        manager
            .session
            .as_mut()
            .expect("session should be present")
            .current_url = Some("https://example.com/nav-1".to_string());

        let cached_page_state = sample_page_state("nav-1", 101);
        let expected_hit_key = manager
            .build_snapshot_cache_key(
                &cached_page_state,
                &PageStateCacheMetadata::from_page_state(&cached_page_state, "viewport:test"),
            )
            .as_string();
        let captured_page_state_fixture = sample_page_state("nav-2", 202);
        let expected_store_key = manager
            .build_snapshot_cache_key(
                &captured_page_state_fixture,
                &PageStateCacheMetadata::from_page_state(
                    &captured_page_state_fixture,
                    "viewport:test",
                ),
            )
            .as_string();

        manager.set_cached_page_state_for_test(cached_page_state);
        let hit_page_state = manager.consume_cached_page_state();
        assert_eq!(
            hit_page_state
                .as_ref()
                .map(|page_state| page_state.navigation_id.as_str()),
            Some("nav-1")
        );

        manager.enqueue_page_state_capture_for_test(Ok(captured_page_state_fixture));
        let captured_page_state = manager
            .capture_page_state()
            .await
            .expect("page state capture should succeed");
        assert_eq!(captured_page_state.navigation_id, "nav-2");

        let snapshot = manager.observability_snapshot();
        assert!(snapshot.recent_events.iter().any(|event| {
            event.kind == BrowserEventKind::SnapshotCacheHit
                && event.detail.as_deref() == Some("https://example.com/nav-1")
                && event.cache_key.as_deref() == Some(expected_hit_key.as_str())
                && event.cache_url.as_deref() == Some("https://example.com/nav-1")
        }));
        assert!(snapshot.recent_events.iter().any(|event| {
            event.kind == BrowserEventKind::SnapshotCacheMiss
                && event.detail.as_deref() == Some("https://example.com/nav-2")
                && event.cache_key.as_deref() == Some(expected_store_key.as_str())
                && event.cache_url.as_deref() == Some("https://example.com/nav-2")
        }));
        assert!(snapshot.recent_events.iter().any(|event| {
            event.kind == BrowserEventKind::SnapshotCacheStore
                && event.detail.as_deref() == Some("https://example.com/nav-2")
                && event.cache_key.as_deref() == Some(expected_store_key.as_str())
                && event.cache_url.as_deref() == Some("https://example.com/nav-2")
        }));
        assert!(snapshot.recent_events.iter().any(|event| {
            event.kind == BrowserEventKind::SnapshotCacheEvict
                && event.cache_key.as_deref() == Some(expected_hit_key.as_str())
                && event.cache_url.as_deref() == Some("https://example.com/nav-1")
                && event
                    .detail
                    .as_deref()
                    .map(|detail| detail.ends_with("https://example.com/nav-1"))
                    .unwrap_or(false)
        }));
    }
}
