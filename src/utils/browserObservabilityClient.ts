import { invoke } from '@tauri-apps/api/core';

import type { BrowserObservabilitySnapshotPayload } from '@/types/browserObservability';

export async function getBrowserObservabilitySnapshot(): Promise<BrowserObservabilitySnapshotPayload> {
  return invoke<BrowserObservabilitySnapshotPayload>('get_browser_observability_snapshot');
}

export async function exportBrowserBenchmarkReport(): Promise<string> {
  return invoke<string>('export_browser_benchmark_report');
}