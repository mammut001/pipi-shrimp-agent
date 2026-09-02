import type { ToolExecutionResult } from '@/core/types';

interface PendingToolResultRequest {
  expectedIds: string[];
  resolve: (results: ToolExecutionResult[]) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
}

type BufferedToolResponse =
  | { kind: 'results'; results: ToolExecutionResult[] }
  | { kind: 'error'; error: Error };

export interface WaitForToolResultsOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

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

/**
 * Process-local command/result channel owned by one SessionRuntime.
 *
 * Engine events only expose a serializable requestId. Consumers submit tool
 * results through SessionHandle; this channel wakes the suspended query loop.
 * Early submissions are buffered because an async-generator consumer can
 * execute a tool before the generator resumes past the `yield` and installs
 * its waiter.
 */
export class ToolResultChannel {
  private readonly pending = new Map<string, PendingToolResultRequest>();
  private readonly buffered = new Map<string, BufferedToolResponse>();

  waitFor(
    requestId: string,
    expectedIds: string[],
    options: WaitForToolResultsOptions = {},
  ): Promise<ToolExecutionResult[]> {
    const buffered = this.buffered.get(requestId);
    if (buffered) {
      this.buffered.delete(requestId);
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
        resolve,
        reject,
      };

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
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
          if (entry.timeoutId !== undefined) {
            clearTimeout(entry.timeoutId);
          }
          reject(new DOMException('Chat turn aborted', 'AbortError'));
        };
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
        entry.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
      }

      this.pending.set(requestId, entry);
    });
  }

  submit(requestId: string, results: ToolExecutionResult[]): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      this.buffered.set(requestId, {
        kind: 'results',
        results: results.map((result) => ({ ...result })),
      });
      return;
    }

    this.pending.delete(requestId);
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    pending.abortCleanup?.();
    pending.resolve(normalizeResults(pending.expectedIds, results));
  }

  reject(requestId: string, error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const pending = this.pending.get(requestId);
    if (!pending) {
      this.buffered.set(requestId, { kind: 'error', error: normalized });
      return;
    }

    this.pending.delete(requestId);
    if (pending.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    pending.abortCleanup?.();
    pending.reject(normalized);
  }

  cancelAll(reason = 'Session runtime disposed'): void {
    const error = new Error(reason);
    for (const [requestId, pending] of this.pending) {
      if (pending.timeoutId !== undefined) {
        clearTimeout(pending.timeoutId);
      }
      pending.abortCleanup?.();
      pending.reject(error);
      this.pending.delete(requestId);
    }
    this.buffered.clear();
  }
}
