use std::collections::{BTreeMap, VecDeque};

use chrono::Utc;
use serde::Serialize;

use crate::browser::dom::PageState;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SnapshotCacheKey {
    pub target_id: String,
    pub navigation_id: String,
    pub viewport_signature: String,
    pub dom_version: String,
}

impl SnapshotCacheKey {
    pub fn new(
        target_id: impl Into<String>,
        navigation_id: impl Into<String>,
        viewport_signature: impl Into<String>,
        dom_version: impl Into<String>,
    ) -> Self {
        Self {
            target_id: target_id.into(),
            navigation_id: navigation_id.into(),
            viewport_signature: viewport_signature.into(),
            dom_version: dom_version.into(),
        }
    }

    pub fn as_string(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.target_id, self.navigation_id, self.viewport_signature, self.dom_version
        )
    }
}

#[derive(Debug, Clone)]
pub struct SnapshotCacheEntry {
    pub key: SnapshotCacheKey,
    pub page_state: PageState,
    pub captured_at_ms: i64,
    pub last_accessed_at_ms: i64,
    pub access_count: u64,
    pub invalidated_at_ms: Option<i64>,
    pub invalidation_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SnapshotCacheStoreResult {
    pub entry: SnapshotCacheEntry,
    pub evicted_entry: Option<SnapshotCacheEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SnapshotCacheEntrySnapshot {
    pub key: String,
    pub url: String,
    pub snapshot_id: String,
    pub created_at_ms: i64,
    pub last_accessed_at_ms: i64,
    pub access_count: u64,
    pub invalidated_at_ms: Option<i64>,
    pub invalidation_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SnapshotCacheSnapshot {
    pub active_key: Option<String>,
    pub entry_limit: usize,
    pub entries: Vec<SnapshotCacheEntrySnapshot>,
    pub hit_count: u64,
    pub miss_count: u64,
    pub eviction_count: u64,
    pub invalidation_count: u64,
}

#[derive(Debug, Clone)]
pub struct SnapshotCache {
    entry_limit: usize,
    active_key: Option<String>,
    order: VecDeque<String>,
    entries: BTreeMap<String, SnapshotCacheEntry>,
    hit_count: u64,
    miss_count: u64,
    eviction_count: u64,
    invalidation_count: u64,
}

impl SnapshotCache {
    pub fn new(entry_limit: usize) -> Self {
        Self {
            entry_limit: entry_limit.max(1),
            active_key: None,
            order: VecDeque::new(),
            entries: BTreeMap::new(),
            hit_count: 0,
            miss_count: 0,
            eviction_count: 0,
            invalidation_count: 0,
        }
    }

    pub fn active_page_state(&mut self) -> Option<PageState> {
        let active_key = self.active_key.clone()?;
        let entry = self.entries.get_mut(&active_key)?;
        if entry.invalidated_at_ms.is_some() {
            self.active_key = None;
            return None;
        }

        let accessed_at_ms = Utc::now().timestamp_millis();
        entry.last_accessed_at_ms = accessed_at_ms;
        entry.access_count = entry.access_count.saturating_add(1);
        self.hit_count = self.hit_count.saturating_add(1);
        Some(entry.page_state.clone())
    }

    pub fn peek_active_page_state(&self) -> Option<PageState> {
        self.active_entry().map(|entry| entry.page_state.clone())
    }

    pub fn active_key(&self) -> Option<&str> {
        self.active_key.as_deref()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn has_active_entry(&self) -> bool {
        self.active_entry().is_some()
    }

    pub fn latest_invalidated_entry(&self) -> Option<SnapshotCacheEntry> {
        self.order
            .iter()
            .rev()
            .filter_map(|key| self.entries.get(key))
            .find(|entry| entry.invalidated_at_ms.is_some())
            .cloned()
    }

    pub fn record_miss(&mut self) {
        self.miss_count = self.miss_count.saturating_add(1);
    }

    pub fn snapshot(&self) -> SnapshotCacheSnapshot {
        let entries = self
            .order
            .iter()
            .rev()
            .filter_map(|key| self.entries.get(key))
            .map(|entry| SnapshotCacheEntrySnapshot {
                key: entry.key.as_string(),
                url: entry.page_state.url.clone(),
                snapshot_id: format!("page-state:{}", entry.key.as_string()),
                created_at_ms: entry.captured_at_ms,
                last_accessed_at_ms: entry.last_accessed_at_ms,
                access_count: entry.access_count,
                invalidated_at_ms: entry.invalidated_at_ms,
                invalidation_reason: entry.invalidation_reason.clone(),
            })
            .collect();

        SnapshotCacheSnapshot {
            active_key: self.active_key.clone(),
            entry_limit: self.entry_limit,
            entries,
            hit_count: self.hit_count,
            miss_count: self.miss_count,
            eviction_count: self.eviction_count,
            invalidation_count: self.invalidation_count,
        }
    }

    pub fn store(&mut self, key: SnapshotCacheKey, page_state: PageState) -> SnapshotCacheStoreResult {
        let key_string = key.as_string();
        self.remove_order_key(&key_string);
        let captured_at_ms = Utc::now().timestamp_millis();

        let entry = SnapshotCacheEntry {
            key,
            page_state,
            captured_at_ms,
            last_accessed_at_ms: captured_at_ms,
            access_count: 0,
            invalidated_at_ms: None,
            invalidation_reason: None,
        };
        self.entries.insert(key_string.clone(), entry.clone());
        self.order.push_back(key_string.clone());
        self.active_key = Some(key_string);
        let evicted_entry = self.evict_over_limit();
        SnapshotCacheStoreResult { entry, evicted_entry }
    }

    pub fn invalidate_active(&mut self, reason: impl Into<String>) -> Option<SnapshotCacheEntry> {
        let active_key = self.active_key.take()?;
        let invalidated_at_ms = Utc::now().timestamp_millis();
        let entry = self.entries.get_mut(&active_key)?;
        entry.invalidated_at_ms = Some(invalidated_at_ms);
        entry.invalidation_reason = Some(reason.into());
        self.invalidation_count = self.invalidation_count.saturating_add(1);
        Some(entry.clone())
    }

    pub fn upgrade_latest_invalidation_reason(&mut self, from_reason: &str, to_reason: &str) -> bool {
        let Some(latest_key) = self.order.back() else {
            return false;
        };
        let Some(entry) = self.entries.get_mut(latest_key) else {
            return false;
        };

        if entry.invalidated_at_ms.is_none() || entry.invalidation_reason.as_deref() != Some(from_reason) {
            return false;
        }

        entry.invalidated_at_ms = Some(Utc::now().timestamp_millis());
        entry.invalidation_reason = Some(to_reason.to_string());
        true
    }

    pub fn clear(&mut self) {
        self.active_key = None;
        self.order.clear();
        self.entries.clear();
        self.hit_count = 0;
        self.miss_count = 0;
        self.eviction_count = 0;
        self.invalidation_count = 0;
    }

    fn active_entry(&self) -> Option<&SnapshotCacheEntry> {
        let active_key = self.active_key.as_deref()?;
        self.entries
            .get(active_key)
            .filter(|entry| entry.invalidated_at_ms.is_none())
    }

    fn remove_order_key(&mut self, key: &str) {
        self.order.retain(|existing| existing != key);
    }

    fn evict_over_limit(&mut self) -> Option<SnapshotCacheEntry> {
        let mut last_evicted_entry = None;
        while self.entries.len() > self.entry_limit {
            let Some(oldest_key) = self.order.pop_front() else {
                break;
            };
            if let Some(entry) = self.entries.remove(&oldest_key) {
                self.eviction_count = self.eviction_count.saturating_add(1);
                last_evicted_entry = Some(entry);
            }
            if self.active_key.as_deref() == Some(oldest_key.as_str()) {
                self.active_key = None;
            }
        }
        last_evicted_entry
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::dom::{InteractiveElement, PageState};

    #[test]
    fn snapshot_cache_evicts_oldest_entries_when_limit_is_exceeded() {
        let mut cache = SnapshotCache::new(2);

        cache.store(make_key("target-1", "nav-1", "viewport-1", "dom-1"), make_page_state("nav-1", 11));
        cache.store(make_key("target-1", "nav-2", "viewport-1", "dom-2"), make_page_state("nav-2", 22));
        cache.store(make_key("target-1", "nav-3", "viewport-1", "dom-3"), make_page_state("nav-3", 33));

        assert_eq!(cache.len(), 2);
        assert_eq!(cache.active_key(), Some("target-1:nav-3:viewport-1:dom-3"));
        assert_eq!(cache.eviction_count, 1);
        assert_eq!(cache.active_page_state().as_ref().map(|page_state| page_state.navigation_id.as_str()), Some("nav-3"));
        assert_eq!(cache.hit_count, 1);
    }

    #[test]
    fn snapshot_cache_invalidate_active_only_clears_the_current_entry() {
        let mut cache = SnapshotCache::new(3);

        cache.store(make_key("target-1", "nav-1", "viewport-1", "dom-1"), make_page_state("nav-1", 11));
        cache.store(make_key("target-1", "nav-2", "viewport-1", "dom-2"), make_page_state("nav-2", 22));

        let invalidated = cache.invalidate_active("navigation").expect("active entry should be removed");

        assert_eq!(invalidated.page_state.navigation_id, "nav-2");
        assert_eq!(cache.len(), 2);
        assert!(cache.active_page_state().is_none());
        assert_eq!(cache.invalidation_count, 1);
        assert_eq!(
            cache.snapshot().entries[0].invalidation_reason.as_deref(),
            Some("navigation")
        );
    }

    #[test]
    fn snapshot_cache_snapshot_reports_active_key_and_miss_count() {
        let mut cache = SnapshotCache::new(3);
        cache.record_miss();
        cache.store(make_key("target-1", "nav-1", "viewport-1", "dom-1"), make_page_state("nav-1", 11));

        let snapshot = cache.snapshot();

        assert_eq!(snapshot.active_key.as_deref(), Some("target-1:nav-1:viewport-1:dom-1"));
        assert_eq!(snapshot.entry_limit, 3);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.miss_count, 1);
    }

    fn make_key(target_id: &str, navigation_id: &str, viewport_signature: &str, dom_version: &str) -> SnapshotCacheKey {
        SnapshotCacheKey::new(target_id, navigation_id, viewport_signature, dom_version)
    }

    fn make_page_state(navigation_id: &str, backend_node_id: i64) -> PageState {
        PageState {
            url: format!("https://example.com/{}", navigation_id),
            title: navigation_id.to_string(),
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
}
