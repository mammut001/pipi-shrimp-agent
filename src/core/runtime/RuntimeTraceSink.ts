import type { RuntimeTraceEvent, TraceSink } from './RuntimeTrace';

/** Default ring capacity: enough for Manual D dual-chain grepping, bounded memory. */
export const DEFAULT_RUNTIME_TRACE_CAPACITY = 1000;

/** Options for getEvents / dumpJsonLines (recent N + optional session filter). */
export interface RuntimeTraceDumpOptions {
  /** Keep only events whose context.sessionId matches. */
  sessionId?: string;
  /** Keep only the most recent N events (after session filter). */
  limit?: number;
}

export interface RuntimeTraceRingBuffer {
  /** Record one event (identity/status only). Compatible with RuntimeHost.trace. */
  readonly record: TraceSink;
  /** Recent events oldest→newest (capped); optional session/limit filter. */
  getEvents(options?: RuntimeTraceDumpOptions): readonly RuntimeTraceEvent[];
  /** JSON Lines dump for Manual D / race forensics; optional session/limit filter. */
  dumpJsonLines(options?: RuntimeTraceDumpOptions): string;
  /** Clear the buffer (tests / fresh dump window). */
  clear(): void;
  readonly capacity: number;
  readonly size: number;
}

function selectEvents(
  events: readonly RuntimeTraceEvent[],
  options?: RuntimeTraceDumpOptions,
): RuntimeTraceEvent[] {
  let selected = events.slice() as RuntimeTraceEvent[];
  if (options?.sessionId !== undefined) {
    const sid = options.sessionId;
    selected = selected.filter((e) => e.context.sessionId === sid);
  }
  if (options?.limit !== undefined && options.limit >= 0) {
    const n = Math.floor(options.limit);
    if (selected.length > n) {
      selected = selected.slice(selected.length - n);
    }
  }
  return selected;
}

/**
 * Structured in-memory ring-buffer sink for runtime race forensics.
 * Does not log to console by default — use dumpJsonLines() / getEvents().
 * Events are identity + status only (no tool argument payloads / secrets).
 */
export function createRuntimeTraceRingBuffer(
  capacity: number = DEFAULT_RUNTIME_TRACE_CAPACITY,
): RuntimeTraceRingBuffer {
  const cap = Math.max(1, Math.floor(capacity));
  const events: RuntimeTraceEvent[] = [];

  const record: TraceSink = (event: RuntimeTraceEvent): void => {
    events.push(event);
    if (events.length > cap) {
      events.splice(0, events.length - cap);
    }
  };

  return {
    record,
    getEvents: (options) => selectEvents(events, options),
    dumpJsonLines: (options) =>
      selectEvents(events, options).map((e) => JSON.stringify(e)).join('\n'),
    clear: () => {
      events.length = 0;
    },
    get capacity() {
      return cap;
    },
    get size() {
      return events.length;
    },
  };
}

/** Process-wide default sink used by tauriRuntimeHost and dump helpers. */
export const sharedRuntimeTraceSink: RuntimeTraceRingBuffer = createRuntimeTraceRingBuffer();

/** Record into the shared sink (chat-layer / diagnostics helpers). */
export function recordRuntimeTraceEvent(event: RuntimeTraceEvent): void {
  sharedRuntimeTraceSink.record(event);
}

/**
 * Recent shared-sink events as JSON Lines (one Manual D log surface).
 * Optionally filter by sessionId and/or keep only the most recent `limit` events.
 */
export function dumpRuntimeTraceJsonLines(options?: RuntimeTraceDumpOptions): string {
  return sharedRuntimeTraceSink.dumpJsonLines(options);
}

/** Recent shared-sink events (oldest→newest); optional sessionId / limit. */
export function getRuntimeTraceEvents(
  options?: RuntimeTraceDumpOptions,
): readonly RuntimeTraceEvent[] {
  return sharedRuntimeTraceSink.getEvents(options);
}

/** Clear shared sink (tests). */
export function clearRuntimeTraceSink(): void {
  sharedRuntimeTraceSink.clear();
}

export type RuntimeTraceDumpApi = {
  dumpJsonLines: (options?: RuntimeTraceDumpOptions) => string;
  getEvents: (options?: RuntimeTraceDumpOptions) => readonly RuntimeTraceEvent[];
  clear: () => void;
  size: () => number;
};

/**
 * Install a cheap DevTools helper on `globalThis` / `window` so Manual D can
 * dump without hunting console noise. Safe to call multiple times.
 *
 * @example
 * __PIPI_RUNTIME_TRACE__.dumpJsonLines()
 * __PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 's1', limit: 50 })
 */
export function installRuntimeTraceDevDump(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): RuntimeTraceDumpApi {
  const api: RuntimeTraceDumpApi = {
    dumpJsonLines: (options) => dumpRuntimeTraceJsonLines(options),
    getEvents: (options) => getRuntimeTraceEvents(options),
    clear: () => clearRuntimeTraceSink(),
    size: () => sharedRuntimeTraceSink.size,
  };
  target.__PIPI_RUNTIME_TRACE__ = api;
  return api;
}
