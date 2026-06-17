//! Atomic timing helpers for the browser DOM layer.
//!
//! Most PageState captures run multiple CDP commands in parallel; a single
//! `Instant` would race between threads. We use `AtomicU64` to record the
//! elapsed milliseconds for each named step so the agent loop can publish
//! a structured breakdown in the benchmark report.
//!
//! The recorder is intentionally tiny — no timestamps, no labels, no
//! per-thread aggregation — so it stays cheap to call from hot paths.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Records elapsed milliseconds keyed by a string. Missing keys return 0.
#[derive(Debug, Default)]
pub struct AtomicMs {
    inner: AtomicU64,
}

impl AtomicMs {
    pub fn new() -> Self {
        Self { inner: AtomicU64::new(0) }
    }

    pub fn record(&self, elapsed: Duration) {
        // Saturate at u64::MAX to avoid panics on absurd inputs.
        let ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;
        self.inner.store(ms, Ordering::Relaxed);
    }

    pub fn get(&self) -> u64 {
        self.inner.load(Ordering::Relaxed)
    }

    pub fn reset(&self) {
        self.inner.store(0, Ordering::Relaxed);
    }
}

/// Multi-key timing recorder. Steps are recorded by string name (e.g.
/// "frame_tree_ms", "dom_snapshot_ms", "ax_tree_ms"). Stored values are the
/// last recorded elapsed milliseconds for that key.
#[derive(Debug, Default)]
pub struct TimingsRecorder {
    entries: std::sync::Arc<std::sync::Mutex<Vec<(String, u64)>>>,
}

impl Clone for TimingsRecorder {
    fn clone(&self) -> Self {
        Self {
            entries: std::sync::Arc::clone(&self.entries),
        }
    }
}

impl TimingsRecorder {
    pub fn new() -> Self {
        Self {
            entries: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    /// Record an elapsed Duration under `key`. Existing entries with the same
    /// name are kept (multiple sub-captures are allowed); the snapshot helper
    /// flattens them when exporting.
    pub fn record(&self, key: impl Into<String>, elapsed: Duration) {
        let ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;
        if let Ok(mut guard) = self.entries.lock() {
            guard.push((key.into(), ms));
        }
    }

    /// Convenience helper for `Instant::elapsed()`.
    pub fn record_instant(&self, key: impl Into<String>, started: Instant) {
        self.record(key, started.elapsed());
    }

    /// Snapshot the recorded entries. The returned vector is a clone so the
    /// recorder keeps accepting writes.
    pub fn snapshot(&self) -> Vec<(String, u64)> {
        self.entries
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Clear all recorded entries.
    pub fn reset(&self) {
        if let Ok(mut guard) = self.entries.lock() {
            guard.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_ms_records_elapsed() {
        let store = AtomicMs::new();
        store.record(Duration::from_millis(42));
        assert_eq!(store.get(), 42);
        store.reset();
        assert_eq!(store.get(), 0);
    }

    #[test]
    fn timings_recorder_collects_keys() {
        let recorder = TimingsRecorder::new();
        recorder.record("frame_tree_ms", Duration::from_millis(15));
        recorder.record("dom_snapshot_ms", Duration::from_millis(120));
        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.len(), 2);
        let total: u64 = snapshot.iter().map(|(_, ms)| *ms).sum();
        assert_eq!(total, 135);
    }
}
