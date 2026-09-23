/**
 * Presentational helpers for BrowserDebugPanel.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import type { CSSProperties, ReactNode } from 'react';
import type { BrowserElementBounds, BrowserPageViewport } from '@/types/browserPageState';

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never';
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs < 1_000) {
    return 'Just now';
  }
  if (diffMs < 60_000) {
    return `${Math.floor(diffMs / 1_000)}s ago`;
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m ago`;
  }
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(durationMs?: number): string {
  if (durationMs == null) {
    return 'pending';
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

export function formatTimeout(timeoutMs?: number | null): string {
  if (timeoutMs == null) {
    return 'n/a';
  }
  if (timeoutMs < 1_000) {
    return `${timeoutMs}ms`;
  }
  return `${Math.round(timeoutMs / 1_000)}s`;
}

export function viewportHighlightStyle(
  bounds: BrowserElementBounds | null | undefined,
  viewport: BrowserPageViewport | null | undefined,
): CSSProperties | null {
  if (!bounds || !viewport || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const left = ((bounds.x - viewport.page_x) / viewport.width) * 100;
  const top = ((bounds.y - viewport.page_y) / viewport.height) * 100;
  const width = (bounds.width / viewport.width) * 100;
  const height = (bounds.height / viewport.height) * 100;

  const clippedLeft = Math.max(0, Math.min(100, left));
  const clippedTop = Math.max(0, Math.min(100, top));
  const clippedWidth = Math.max(0, Math.min(100 - clippedLeft, width));
  const clippedHeight = Math.max(0, Math.min(100 - clippedTop, height));

  if (clippedWidth <= 0 || clippedHeight <= 0) {
    return null;
  }

  return {
    left: `${clippedLeft}%`,
    top: `${clippedTop}%`,
    width: `${clippedWidth}%`,
    height: `${clippedHeight}%`,
  };
}

export function DebugCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80">
      <div className="border-b border-slate-800 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 break-all text-[11px] font-medium text-slate-100">{value}</p>
    </div>
  );
}
