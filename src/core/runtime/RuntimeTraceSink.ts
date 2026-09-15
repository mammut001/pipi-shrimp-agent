import type { RuntimeTraceEvent, TraceSink } from './RuntimeTrace';

/** Default ring capacity: enough for Manual D dual-chain grepping, bounded memory. */
export const DEFAULT_RUNTIME_TRACE_CAPACITY = 1000;

export interface RuntimeTraceRingBuffer {
  /** Record one event (identity/status only). Compatible with RuntimeHost.trace. */
  readonly record: TraceSink;
  /** Recent events oldest→newest (capped). */
  getEvents(): readonly RuntimeTraceEvent[];
  /** JSON Lines dump for Manual D / race forensics. */
  dumpJsonLines(): string;
  /** Clear the buffer (tests / fresh dump window). */
  clear(): void;
  readonly capacity: number;
  readonly size: number;
}

/**
 * Structured in-memory ring-buffer sink for runtime race forensics.
 * Does not log to console by default — use dumpJsonLines() / getEvents().
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
    getEvents: () => events.slice(),
    dumpJsonLines: () => events.map((e) => JSON.stringify(e)).join('\n'),
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

/** Recent shared-sink events as JSON Lines (one Manual D log surface). */
export function dumpRuntimeTraceJsonLines(): string {
  return sharedRuntimeTraceSink.dumpJsonLines();
}

/** Recent shared-sink events (oldest→newest). */
export function getRuntimeTraceEvents(): readonly RuntimeTraceEvent[] {
  return sharedRuntimeTraceSink.getEvents();
}

/** Clear shared sink (tests). */
export function clearRuntimeTraceSink(): void {
  sharedRuntimeTraceSink.clear();
}

export type RuntimeTraceDumpApi = {
  dumpJsonLines: () => string;
  getEvents: () => readonly RuntimeTraceEvent[];
  clear: () => void;
  size: () => number;
};

/**
 * Install a cheap DevTools helper on `globalThis` / `window` so Manual D can
 * dump without hunting console noise. Safe to call multiple times.
 */
export function installRuntimeTraceDevDump(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): RuntimeTraceDumpApi {
  const api: RuntimeTraceDumpApi = {
    dumpJsonLines: () => dumpRuntimeTraceJsonLines(),
    getEvents: () => getRuntimeTraceEvents(),
    clear: () => clearRuntimeTraceSink(),
    size: () => sharedRuntimeTraceSink.size,
  };
  target.__PIPI_RUNTIME_TRACE__ = api;
  return api;
}
