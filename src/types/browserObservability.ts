export type BrowserDebugSource = 'mock' | 'derived' | 'frontend' | 'backend';

export type BrowserDebugEventLevel = 'info' | 'success' | 'warning' | 'error';

export type BrowserDebugEventKind =
  | 'connected'
  | 'disconnected'
  | 'health_changed'
  | 'idle_cleanup'
  | 'navigation'
  | 'page_state_updated'
  | 'action'
  | 'command'
  | 'snapshot_cache_hit'
  | 'snapshot_cache_miss'
  | 'snapshot_cache_evict'
  | 'snapshot_cache_invalidate'
  | 'agent_log';

export interface BrowserDebugEvent {
  id: string;
  kind: BrowserDebugEventKind;
  title: string;
  detail?: string;
  level: BrowserDebugEventLevel;
  occurredAt: number;
  source: BrowserDebugSource;
}

export interface BrowserCommandTrace {
  id: string;
  method: string;
  summary?: string;
  status: 'pending' | 'success' | 'error';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
  source: BrowserDebugSource;
}

export interface BrowserActionTrace {
  id: string;
  name: string;
  detail?: string;
  status: 'started' | 'completed' | 'failed';
  createdAt: number;
  source: BrowserDebugSource;
}

export interface BrowserPageWarning {
  id: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface BrowserPageElementPreview {
  id: string;
  label: string;
  role: string;
  selector?: string;
  status?: string;
}

export interface BrowserPageStateSnapshot {
  id: string;
  cacheKey: string;
  url: string;
  title: string;
  warnings: BrowserPageWarning[];
  elements: BrowserPageElementPreview[];
  createdAt: number;
  navigationId: string;
  domVersion: string;
  viewportSignature: string;
  source: BrowserDebugSource;
}

export interface BrowserSnapshotCacheEntry {
  key: string;
  url: string;
  snapshotId: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  invalidatedAt?: number;
  invalidationReason?: string;
  source: BrowserDebugSource;
}

export interface BrowserSnapshotCacheState {
  activeKey?: string | null;
  entryLimit?: number;
  entries: BrowserSnapshotCacheEntry[];
  hitCount: number;
  missCount: number;
  evictionCount: number;
  invalidationCount: number;
}

export interface BrowserBackendSnapshotCacheEntry {
  key: string;
  url: string;
  snapshot_id: string;
  created_at_ms: number;
  last_accessed_at_ms: number;
  access_count: number;
  invalidated_at_ms?: number | null;
  invalidation_reason?: string | null;
}

export interface BrowserBackendSnapshotCacheState {
  active_key: string | null;
  entry_limit: number;
  entries: BrowserBackendSnapshotCacheEntry[];
  hit_count: number;
  miss_count: number;
  eviction_count: number;
  invalidation_count: number;
}

export type BrowserBackendEventKind =
  | 'connected'
  | 'disconnected'
  | 'health_changed'
  | 'navigation'
  | 'page_state_updated'
  | 'action_started'
  | 'action_completed'
  | 'action_failed'
  | 'idle_cleanup';

export type BrowserBenchmarkKind = 'connect' | 'page_state' | 'action' | 'idle_cleanup';

export interface BrowserBenchmarkSample {
  id: string;
  key: string;
  label: string;
  kind: BrowserBenchmarkKind;
  launch_mode: string | null;
  duration_ms: number;
  success: boolean;
  recorded_at_ms: number;
  budget_ms?: number | null;
  detail?: string | null;
  error?: string | null;
  memory_before_bytes?: number | null;
  memory_after_bytes?: number | null;
}

export interface BrowserBenchmarkMetricSummary {
  key: string;
  label: string;
  sample_count: number;
  success_count: number;
  failure_count: number;
  average_duration_ms: number | null;
  max_duration_ms: number | null;
  budget_ms: number | null;
  over_budget_count: number;
  attach_samples: number;
  launch_samples: number;
}

export interface BrowserBenchmarkReport {
  generated_at_ms: number;
  total_samples: number;
  metrics: BrowserBenchmarkMetricSummary[];
  recent_samples: BrowserBenchmarkSample[];
}

export interface BrowserBackendEvent {
  id: string;
  sequence: number;
  kind: BrowserBackendEventKind;
  title: string;
  detail?: string | null;
  level: BrowserDebugEventLevel;
  occurred_at_ms: number;
  action_name?: string | null;
  benchmark?: BrowserBenchmarkSample | null;
}

export interface BrowserObservabilitySnapshotPayload {
  recent_events: BrowserBackendEvent[];
  benchmark_report: BrowserBenchmarkReport;
  snapshot_cache: BrowserBackendSnapshotCacheState;
  last_activity_at_ms: number;
  idle_timeout_ms: number;
}

export interface BrowserDebugSessionInfo {
  connected: boolean;
  mode: 'attach' | 'launch' | 'unknown';
  wsStatus: string;
  currentTarget: string;
  lastHealthPingAt: number | null;
  sessionId: string | null;
  targetId: string | null;
  websocketUrl: string | null;
  currentUrl: string | null;
  lastError: string | null;
  source: BrowserDebugSource;
}