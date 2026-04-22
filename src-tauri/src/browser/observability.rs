use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;
use tokio::sync::broadcast;

use crate::browser::session::snapshot_cache::SnapshotCacheSnapshot;

const DEFAULT_EVENT_HISTORY_LIMIT: usize = 120;
const DEFAULT_BENCHMARK_SAMPLE_LIMIT: usize = 120;
const PAGE_STATE_BUDGET_MS: u64 = 500;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserEventKind {
    Connected,
    Disconnected,
    HealthChanged,
    Navigation,
    PageStateUpdated,
    SnapshotCacheStore,
    SnapshotCacheHit,
    SnapshotCacheMiss,
    SnapshotCacheEvict,
    SnapshotCacheInvalidate,
    ActionStarted,
    ActionCompleted,
    ActionFailed,
    IdleCleanup,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserEventLevel {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserBenchmarkKind {
    Connect,
    PageState,
    Action,
    IdleCleanup,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserBenchmarkSample {
    pub id: String,
    pub key: String,
    pub label: String,
    pub kind: BrowserBenchmarkKind,
    pub launch_mode: Option<String>,
    pub duration_ms: u64,
    pub success: bool,
    pub recorded_at_ms: i64,
    pub budget_ms: Option<u64>,
    pub detail: Option<String>,
    pub error: Option<String>,
    pub memory_before_bytes: Option<u64>,
    pub memory_after_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserEvent {
    pub id: String,
    pub sequence: u64,
    pub kind: BrowserEventKind,
    pub title: String,
    pub detail: Option<String>,
    pub cache_key: Option<String>,
    pub cache_url: Option<String>,
    pub cache_reason: Option<String>,
    pub level: BrowserEventLevel,
    pub occurred_at_ms: i64,
    pub action_name: Option<String>,
    pub benchmark: Option<BrowserBenchmarkSample>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserBenchmarkMetricSummary {
    pub key: String,
    pub label: String,
    pub sample_count: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub average_duration_ms: Option<u64>,
    pub max_duration_ms: Option<u64>,
    pub budget_ms: Option<u64>,
    pub over_budget_count: usize,
    pub attach_samples: usize,
    pub launch_samples: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserBenchmarkReport {
    pub generated_at_ms: i64,
    pub total_samples: usize,
    pub metrics: Vec<BrowserBenchmarkMetricSummary>,
    pub recent_samples: Vec<BrowserBenchmarkSample>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserObservabilitySnapshot {
    pub recent_events: Vec<BrowserEvent>,
    pub benchmark_report: BrowserBenchmarkReport,
    pub snapshot_cache: SnapshotCacheSnapshot,
    pub last_activity_at_ms: i64,
    pub idle_timeout_ms: u64,
}

#[derive(Clone)]
pub struct BrowserEventBus {
    tx: broadcast::Sender<BrowserEvent>,
    inner: Arc<BrowserEventBusInner>,
}

struct BrowserEventBusInner {
    next_sequence: AtomicU64,
    event_history_limit: usize,
    benchmark_sample_limit: usize,
    events: Mutex<VecDeque<BrowserEvent>>,
    benchmarks: Mutex<VecDeque<BrowserBenchmarkSample>>,
}

impl BrowserEventBus {
    pub fn new(event_history_limit: usize, benchmark_sample_limit: usize) -> Self {
        let history_limit = event_history_limit.max(DEFAULT_EVENT_HISTORY_LIMIT / 2);
        let sample_limit = benchmark_sample_limit.max(DEFAULT_BENCHMARK_SAMPLE_LIMIT / 2);
        let (tx, _) = broadcast::channel(history_limit.max(32));
        Self {
            tx,
            inner: Arc::new(BrowserEventBusInner {
                next_sequence: AtomicU64::new(1),
                event_history_limit: history_limit,
                benchmark_sample_limit: sample_limit,
                events: Mutex::new(VecDeque::with_capacity(history_limit)),
                benchmarks: Mutex::new(VecDeque::with_capacity(sample_limit)),
            }),
        }
    }

    pub fn publish(
        &self,
        kind: BrowserEventKind,
        level: BrowserEventLevel,
        title: impl Into<String>,
        detail: Option<String>,
        action_name: Option<String>,
        benchmark: Option<BrowserBenchmarkSample>,
    ) -> BrowserEvent {
        self.publish_with_metadata(kind, level, title, detail, None, None, None, action_name, benchmark)
    }

    pub fn publish_snapshot_cache_event(
        &self,
        kind: BrowserEventKind,
        level: BrowserEventLevel,
        title: impl Into<String>,
        detail: Option<String>,
        cache_key: impl Into<String>,
        cache_url: impl Into<String>,
        cache_reason: Option<String>,
    ) -> BrowserEvent {
        self.publish_with_metadata(
            kind,
            level,
            title,
            detail,
            Some(cache_key.into()),
            Some(cache_url.into()),
            cache_reason,
            None,
            None,
        )
    }

    fn publish_with_metadata(
        &self,
        kind: BrowserEventKind,
        level: BrowserEventLevel,
        title: impl Into<String>,
        detail: Option<String>,
        cache_key: Option<String>,
        cache_url: Option<String>,
        cache_reason: Option<String>,
        action_name: Option<String>,
        benchmark: Option<BrowserBenchmarkSample>,
    ) -> BrowserEvent {
        let sequence = self.inner.next_sequence.fetch_add(1, Ordering::Relaxed);
        let event = BrowserEvent {
            id: format!("browser-event-{}", sequence),
            sequence,
            kind,
            title: title.into(),
            detail,
            cache_key,
            cache_url,
            cache_reason,
            level,
            occurred_at_ms: Utc::now().timestamp_millis(),
            action_name,
            benchmark,
        };

        self.record_event(event.clone());
        let _ = self.tx.send(event.clone());
        event
    }

    pub fn build_benchmark_sample(
        &self,
        key: impl Into<String>,
        label: impl Into<String>,
        kind: BrowserBenchmarkKind,
        launch_mode: Option<String>,
        duration_ms: u64,
        success: bool,
        detail: Option<String>,
        error: Option<String>,
        memory_before_bytes: Option<u64>,
        memory_after_bytes: Option<u64>,
    ) -> BrowserBenchmarkSample {
        let sequence = self.inner.next_sequence.fetch_add(1, Ordering::Relaxed);
        BrowserBenchmarkSample {
            id: format!("browser-benchmark-{}", sequence),
            key: key.into(),
            label: label.into(),
            kind,
            launch_mode,
            duration_ms,
            success,
            recorded_at_ms: Utc::now().timestamp_millis(),
            budget_ms: benchmark_budget(kind),
            detail,
            error,
            memory_before_bytes,
            memory_after_bytes,
        }
    }

    pub fn snapshot(
        &self,
        snapshot_cache: SnapshotCacheSnapshot,
        last_activity_at_ms: i64,
        idle_timeout_ms: u64,
    ) -> BrowserObservabilitySnapshot {
        BrowserObservabilitySnapshot {
            recent_events: self
                .inner
                .events
                .lock()
                .expect("browser event history mutex poisoned")
                .iter()
                .cloned()
                .collect(),
            benchmark_report: self.benchmark_report(),
            snapshot_cache,
            last_activity_at_ms,
            idle_timeout_ms,
        }
    }

    pub fn benchmark_report(&self) -> BrowserBenchmarkReport {
        let samples: Vec<BrowserBenchmarkSample> = self
            .inner
            .benchmarks
            .lock()
            .expect("browser benchmark mutex poisoned")
            .iter()
            .cloned()
            .collect();

        let mut grouped: BTreeMap<String, Vec<&BrowserBenchmarkSample>> = BTreeMap::new();
        for sample in &samples {
            grouped.entry(sample.key.clone()).or_default().push(sample);
        }

        let metrics = grouped
            .into_iter()
            .map(|(key, entries)| {
                let sample_count = entries.len();
                let success_count = entries.iter().filter(|sample| sample.success).count();
                let failure_count = sample_count.saturating_sub(success_count);
                let total_duration_ms: u64 = entries.iter().map(|sample| sample.duration_ms).sum();
                let average_duration_ms = if sample_count > 0 {
                    Some(total_duration_ms / sample_count as u64)
                } else {
                    None
                };
                let max_duration_ms = entries.iter().map(|sample| sample.duration_ms).max();
                let budget_ms = entries.first().and_then(|sample| sample.budget_ms);
                let over_budget_count = budget_ms
                    .map(|budget| entries.iter().filter(|sample| sample.duration_ms > budget).count())
                    .unwrap_or(0);
                let attach_samples = entries
                    .iter()
                    .filter(|sample| sample.launch_mode.as_deref() == Some("attach"))
                    .count();
                let launch_samples = entries
                    .iter()
                    .filter(|sample| sample.launch_mode.as_deref() == Some("launch"))
                    .count();

                BrowserBenchmarkMetricSummary {
                    key,
                    label: entries
                        .first()
                        .map(|sample| sample.label.clone())
                        .unwrap_or_else(|| "benchmark".to_string()),
                    sample_count,
                    success_count,
                    failure_count,
                    average_duration_ms,
                    max_duration_ms,
                    budget_ms,
                    over_budget_count,
                    attach_samples,
                    launch_samples,
                }
            })
            .collect();

        BrowserBenchmarkReport {
            generated_at_ms: Utc::now().timestamp_millis(),
            total_samples: samples.len(),
            metrics,
            recent_samples: samples,
        }
    }

    pub fn record_benchmark_sample(&self, sample: BrowserBenchmarkSample) {
        let mut samples = self
            .inner
            .benchmarks
            .lock()
            .expect("browser benchmark mutex poisoned");
        samples.push_front(sample);
        while samples.len() > self.inner.benchmark_sample_limit {
            samples.pop_back();
        }
    }

    pub fn export_markdown(&self) -> String {
        let report = self.benchmark_report();
        let mut lines = vec![
            "# Browser Benchmark Report".to_string(),
            String::new(),
            format!("Generated at: {}", report.generated_at_ms),
            format!("Total samples: {}", report.total_samples),
            String::new(),
            "## Metric Summary".to_string(),
            String::new(),
            "| Metric | Samples | Avg (ms) | Max (ms) | Success | Failure | Budget (ms) | Over Budget | Attach | Launch |".to_string(),
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |".to_string(),
        ];

        for metric in &report.metrics {
            lines.push(format!(
                "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
                metric.label,
                metric.sample_count,
                metric.average_duration_ms
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                metric.max_duration_ms
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                metric.success_count,
                metric.failure_count,
                metric
                    .budget_ms
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                metric.over_budget_count,
                metric.attach_samples,
                metric.launch_samples,
            ));
        }

        lines.push(String::new());
        lines.push("## Recent Samples".to_string());
        lines.push(String::new());
        lines.push("| Metric | Kind | Duration (ms) | Launch Mode | Success | Detail | Error | Memory Before | Memory After |".to_string());
        lines.push("| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: |".to_string());

        for sample in &report.recent_samples {
            lines.push(format!(
                "| {} | {:?} | {} | {} | {} | {} | {} | {} | {} |",
                sample.label,
                sample.kind,
                sample.duration_ms,
                sample.launch_mode.as_deref().unwrap_or("n/a"),
                if sample.success { "yes" } else { "no" },
                markdown_cell(sample.detail.as_deref()),
                markdown_cell(sample.error.as_deref()),
                sample
                    .memory_before_bytes
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                sample
                    .memory_after_bytes
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
            ));
        }

        lines.join("\n")
    }

    fn record_event(&self, event: BrowserEvent) {
        {
            let mut events = self
                .inner
                .events
                .lock()
                .expect("browser event history mutex poisoned");
            events.push_front(event.clone());
            while events.len() > self.inner.event_history_limit {
                events.pop_back();
            }
        }

        if let Some(sample) = event.benchmark.clone() {
            let mut samples = self
                .inner
                .benchmarks
                .lock()
                .expect("browser benchmark mutex poisoned");
            samples.push_front(sample);
            while samples.len() > self.inner.benchmark_sample_limit {
                samples.pop_back();
            }
        }
    }
}

fn benchmark_budget(kind: BrowserBenchmarkKind) -> Option<u64> {
    match kind {
        BrowserBenchmarkKind::PageState => Some(PAGE_STATE_BUDGET_MS),
        _ => None,
    }
}

fn markdown_cell(value: Option<&str>) -> String {
    value
        .map(|value| value.replace('|', r#"\|"#).replace('\n', " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "n/a".to_string())
}

#[cfg(unix)]
pub fn sample_process_memory_bytes() -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    let rc = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }

    let usage = unsafe { usage.assume_init() };

    #[cfg(target_os = "macos")]
    {
        Some(usage.ru_maxrss as u64)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Some((usage.ru_maxrss as u64).saturating_mul(1024))
    }
}

#[cfg(not(unix))]
pub fn sample_process_memory_bytes() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn benchmark_report_groups_and_exports_samples() {
        let bus = BrowserEventBus::new(16, 16);
        let page_state_sample = bus.build_benchmark_sample(
            "page_state",
            "get_page_state",
            BrowserBenchmarkKind::PageState,
            Some("attach".to_string()),
            420,
            true,
            Some("https://example.com".to_string()),
            None,
            Some(100),
            Some(150),
        );
        bus.publish(
            BrowserEventKind::PageStateUpdated,
            BrowserEventLevel::Success,
            "PageState updated",
            Some("https://example.com".to_string()),
            None,
            Some(page_state_sample),
        );

        let action_sample = bus.build_benchmark_sample(
            "action.click",
            "action: click",
            BrowserBenchmarkKind::Action,
            Some("attach".to_string()),
            180,
            true,
            Some("index=3".to_string()),
            None,
            None,
            None,
        );
        bus.publish(
            BrowserEventKind::ActionCompleted,
            BrowserEventLevel::Success,
            "click completed",
            Some("index=3".to_string()),
            Some("click".to_string()),
            Some(action_sample),
        );

        let snapshot = bus.snapshot(
            SnapshotCacheSnapshot {
                active_key: Some("target-1:nav-1:viewport-1:dom-1".to_string()),
                entry_limit: 8,
                entries: Vec::new(),
                hit_count: 1,
                miss_count: 1,
                eviction_count: 0,
                invalidation_count: 0,
            },
            Utc::now().timestamp_millis(),
            300_000,
        );
        assert_eq!(snapshot.recent_events.len(), 2);
        assert_eq!(snapshot.benchmark_report.total_samples, 2);
        assert_eq!(snapshot.snapshot_cache.hit_count, 1);
        assert!(snapshot
            .benchmark_report
            .metrics
            .iter()
            .any(|metric| metric.key == "page_state" && metric.budget_ms == Some(500)));

        let markdown = bus.export_markdown();
        assert!(markdown.contains("Browser Benchmark Report"));
        assert!(markdown.contains("get_page_state"));
        assert!(markdown.contains("action: click"));
    }
}