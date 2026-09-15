import type { ToolExecutionResult } from '@/core/types';
export type { ToolExecutionResult };

interface PendingToolResultRequest {
  expectedIds: string[];
  turnId?: string;
  resolve: (results: ToolExecutionResult[]) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
}

type BufferedToolResponse =
  | { kind: 'results'; results: ToolExecutionResult[]; turnId?: string }
  | { kind: 'error'; error: Error; turnId?: string };

export interface WaitForToolResultsOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Bind this waiter to a turn; submit must present the same turnId. */
  turnId?: string;
}

/** Optional observer for late/mismatched discards (identity + reason only). */
export type ToolResultDiscardSink = (info: {
  requestId: string;
  reason: string;
  turnId?: string;
}) => void;

const MAX_TOMBSTONES = 1000;

function normalizeResults(
  expectedIds: string[],
  results: ToolExecutionResult[],
): ToolExecutionResult[] {
  const byId = new Map(results.map((result) => [result.id, result.content]));
  return expectedIds.map((id) => ({
    id,
    content: byId.get(id) ?? 'Error: no result returned for tool',
  }));
}

function turnIdsCompatible(expected?: string, actual?: string): boolean {
  // Both unbound: compatible (legacy / tests).
  if (expected === undefined && actual === undefined) {
    return true;
  }
  // One unbound, one bound: reject (fail closed on identity).
  if (expected === undefined || actual === undefined) {
    return expected === actual;
  }
  return expected === actual;
}

/**
 * Process-local command/result channel owned by one SessionRuntime.
 *
 * Engine events only expose a serializable requestId. Consumers submit tool
 * results through SessionHandle; this channel wakes the suspended query loop.
 * Early submissions are buffered because an async-generator consumer can
 * execute a tool before the generator resumes past the `yield` and installs
 * its waiter.
 *
 * Invariants:
 * - Exactly-once delivery per requestId.
 * - Waiters are bound to turnId in addition to requestId.
 * - submit validates requestId + turnId; mismatches discard only.
 * - Late results cannot settle cancelled/timed-out waiters.
 * - Late results after terminal/cancel discard only (no continuation).
 * - Late results cannot settle later requests.
 * - Bounded tombstone history preserves clean memory behavior.
 * - Cancellation emits AbortError so no false error is shown to users.
 */
export class ToolResultChannel {
  private readonly pending = new Map<string, PendingToolResultRequest>();
  private readonly buffered = new Map<string, BufferedToolResponse>();
  private readonly tombstones = new Set<string>();
  private readonly tombstoneOrder: string[] = [];
  private discardSink: ToolResultDiscardSink | null = null;

  /** Wire an optional discard observer (SessionRuntime trace). */
  setDiscardSink(sink: ToolResultDiscardSink | null): void {
    this.discardSink = sink;
  }

  /** Pending waiter requestIds (for cancel-path tool_cancelled emits). */
  listPendingRequestIds(): string[] {
    return [...this.pending.keys()];
  }

  private notifyDiscard(requestId: string, reason: string, turnId?: string): void {
    try {
      this.discardSink?.({
        requestId,
        reason,
        ...(turnId !== undefined ? { turnId } : {}),
      });
    } catch {
      // Discard observability must never break the channel
    }
  }

  private markTombstone(requestId: string): void {
    if (this.tombstones.has(requestId)) {
      return;
    }
    this.tombstones.add(requestId);
    this.tombstoneOrder.push(requestId);
    if (this.tombstoneOrder.length > MAX_TOMBSTONES) {
      const oldest = this.tombstoneOrder.shift();
      if (oldest) {
        this.tombstones.delete(oldest);
      }
    }
  }

  isTombstoned(requestId: string): boolean {
    return this.tombstones.has(requestId);
  }

  hasPending(requestId?: string): boolean {
    return requestId ? this.pending.has(requestId) : this.pending.size > 0;
  }

  waitFor(
    requestId: string,
    expectedIds: string[] = [],
    options: WaitForToolResultsOptions = {},
  ): Promise<ToolExecutionResult[]> {
    if (this.tombstones.has(requestId)) {
      return Promise.reject(new Error(`Tool request ${requestId} already settled or cancelled`));
    }

    const buffered = this.buffered.get(requestId);
    if (buffered) {
      if (!turnIdsCompatible(options.turnId, buffered.turnId)) {
        // Buffered result belongs to a different turn — discard and refuse.
        this.buffered.delete(requestId);
        this.markTombstone(requestId);
        return Promise.reject(
          new Error(`Tool request ${requestId} turnId mismatch (buffered result discarded)`),
        );
      }
      this.buffered.delete(requestId);
      this.markTombstone(requestId);
      if (buffered.kind === 'error') {
        return Promise.reject(buffered.error);
      }
      return Promise.resolve(normalizeResults(expectedIds, buffered.results));
    }

    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`Duplicate tool result waiter: ${requestId}`));
    }

    const timeoutMs = options.timeoutMs ?? 300_000;

    return new Promise<ToolExecutionResult[]>((resolve, reject) => {
      const entry: PendingToolResultRequest = {
        expectedIds: [...expectedIds],
        turnId: options.turnId,
        resolve,
        reject,
      };

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
          this.markTombstone(requestId);
          entry.abortCleanup?.();
          reject(new Error(`Tool batch timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
        if (
          typeof entry.timeoutId === 'object'
          && entry.timeoutId !== null
          && 'unref' in entry.timeoutId
        ) {
          (entry.timeoutId as unknown as { unref: () => void }).unref();
        }
      }

      if (options.signal) {
        const onAbort = () => {
          this.pending.delete(requestId);
          this.markTombstone(requestId);
          if (entry.timeoutId !== undefined) {
            clearTimeout(entry.timeoutId);
          }
          reject(new DOMException('Chat turn aborted', 'AbortError'));
        };
        if (options.signal.aborted) {
          this.markTombstone(requestId);
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
        entry.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
      }

      this.pending.set(requestId, entry);
    });
  }

  /**
   * Submit results for a pending (or soon-to-wait) request.
   * Returns false when the result was discarded (tombstoned, turnId mismatch).
   */
  submit(requestId: string, results: ToolExecutionResult[], turnId?: string): boolean {
    if (this.tombstones.has(requestId)) {
      // Late result after cancellation, timeout, or prior settlement: safely drop.
      this.notifyDiscard(requestId, 'tombstoned_late_result', turnId);
      return false;
    }

    const pending = this.pending.get(requestId);
    if (!pending) {
      if (!this.buffered.has(requestId)) {
        this.buffered.set(requestId, {
          kind: 'results',
          results: results.map((result) => ({ ...result })),
          turnId,
        });
      }
      return true;
    }

    if (!turnIdsCompatible(pending.turnId, turnId)) {
      // Wrong turn — discard only; do not settle the waiter.
      this.notifyDiscard(
        requestId,
        'turn_id_mismatch',
        turnId ?? pending.turnId,
      );
      return false;
    }

    this.pending.delete(requestId);
    this.markTombstone(requestId);
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    pending.abortCleanup?.();
    pending.resolve(normalizeResults(pending.expectedIds, results));
    return true;
  }

  reject(requestId: string, error: unknown, turnId?: string): boolean {
    if (this.tombstones.has(requestId)) {
      // Late result after cancellation, timeout, or prior settlement: safely drop.
      this.notifyDiscard(requestId, 'tombstoned_late_result', turnId);
      return false;
    }

    const normalized = error instanceof Error ? error : new Error(String(error));
    const pending = this.pending.get(requestId);
    if (!pending) {
      if (!this.buffered.has(requestId)) {
        this.buffered.set(requestId, { kind: 'error', error: normalized, turnId });
      }
      return true;
    }

    if (!turnIdsCompatible(pending.turnId, turnId)) {
      this.notifyDiscard(
        requestId,
        'turn_id_mismatch',
        turnId ?? pending.turnId,
      );
      return false;
    }

    this.pending.delete(requestId);
    this.markTombstone(requestId);
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    pending.abortCleanup?.();
    pending.reject(normalized);
    return true;
  }

  cancelAll(reason = 'Session runtime cancelled'): void {
    const error = new DOMException(reason, 'AbortError');
    for (const [requestId, pending] of this.pending) {
      if (pending.timeoutId !== undefined) {
        clearTimeout(pending.timeoutId);
      }
      pending.abortCleanup?.();
      this.markTombstone(requestId);
      pending.reject(error);
    }
    this.pending.clear();

    for (const requestId of this.buffered.keys()) {
      this.markTombstone(requestId);
    }
    this.buffered.clear();
  }
}
