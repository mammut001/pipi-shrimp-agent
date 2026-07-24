import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ToolCallParams } from './types';
import type { ProviderExecutionCapabilities } from '@/services/llm/capabilities';
import { toError } from '@/utils/errorFormat';

export type APIChunkEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call'; tool: ToolCallParams }
  | { type: 'api_response_complete'; response: any };

interface InvokeParams {
  [key: string]: unknown;
  messages: any[];
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  noTools?: boolean;
  allowBrowserTools?: boolean;
  allowedTools?: string[];
  sessionId: string;
  provider?: string;
  /** Optional explicit API format override: "anthropic" | "openai" */
  apiFormat?: string;
  providerCapabilities?: ProviderExecutionCapabilities;
  responseFormat?: { type: 'json_object' };
}

/** Default INACTIVITY timeout for a streaming API call (120s).
 *
 * This is an *inactivity* timeout, not a total-duration timeout: the timer
 * resets every time a token/reasoning/tool event arrives from the Rust side.
 * A total-duration timeout is wrong for streaming because the invoke promise
 * only resolves once the entire stream finishes, so a long (but healthy)
 * response — e.g. a reasoning model thinking for 90s before emitting the
 * final answer — would be killed mid-stream. The backend HTTP client already
 * enforces a 300s per-request timeout; here we only need to detect a *stalled*
 * stream (no events at all for 120s). */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

interface InactivityTimeoutHandle<T> {
  promise: Promise<T>;
  resetTimer: () => void;
  clear: () => void;
}

/**
 * Wraps a Promise with an inactivity timeout. The timer resets whenever
 * `resetTimer()` is called (the caller should call it on every streamed
 * event). If no reset happens within `idleMs`, the returned promise rejects
 * with a descriptive Error so the existing `.catch()` handler in
 * invokeRustAPIStream can handle it gracefully.
 */
function withInactivityTimeout<T>(
  promise: Promise<T>,
  idleMs: number,
  message: string,
): InactivityTimeoutHandle<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectFn: ((err: Error) => void) | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectFn = reject;
    timer = setTimeout(() => reject(new Error(message)), idleMs);
  });

  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => rejectFn?.(new Error(message)), idleMs);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const raced = Promise.race([promise, timeoutPromise]);
  return { promise: raced, resetTimer, clear };
}

/**
 * Converts Tauri event-based IPC streaming into a neat AsyncGenerator.
 * This adapter makes it possible to consume API chunks in a straight `for await` loop,
 * without having to register global listeners that scatter state everywhere.
 */
export async function* invokeRustAPIStream(
  params: InvokeParams
): AsyncGenerator<APIChunkEvent, void, unknown> {
  const sessionId = params.sessionId;
  const queue: APIChunkEvent[] = [];
  let isDone = false;
  let error: Error | null = null;
  let resolveNext: (() => void) | null = null;

  // Inactivity timer handle — reset on every streamed event so a long but
  // healthy stream is not killed, while a truly stalled stream still errors.
  let streamTimeout: InactivityTimeoutHandle<unknown> | null = null;

  // A helper to push events into the async generator's queue
  function pushEvent(event: APIChunkEvent) {
    queue.push(event);
    streamTimeout?.resetTimer();
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  }

  // Bind Tauri event listeners specific to THIS stream invocation
  const unlistenToken = await listen<{ session_id: string; content: string }>('claude-token', (e) => {
    if (e.payload.session_id === sessionId) {
      pushEvent({ type: 'text_delta', content: e.payload.content });
    }
  });

  const unlistenReasoning = await listen<{ session_id: string; content: string }>('claude-reasoning', (e) => {
    if (e.payload.session_id === sessionId) {
      pushEvent({ type: 'reasoning_delta', content: e.payload.content });
    }
  });

  const unlistenToolUse = await listen<{ session_id: string; tool_call_id: string; name: string; arguments: string }>('claude-tool-use', (e) => {
    if (e.payload.session_id === sessionId) {
      pushEvent({
        type: 'tool_call',
        tool: { id: e.payload.tool_call_id, name: e.payload.name, arguments: e.payload.arguments }
      });
    }
  });

  try {
    // Fire off the background Rust operation without `await`ing it yet.
    // That way, we can start draining the events it fires via `yield`.
    // The inactivity timeout resets on every streamed event, so it only
    // rejects if the stream truly stalls (no tokens for STREAM_IDLE_TIMEOUT_MS).
    streamTimeout = withInactivityTimeout(
      invoke('send_claude_sdk_chat_streaming', params),
      STREAM_IDLE_TIMEOUT_MS,
      `Streaming call stalled — no events for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`,
    );
    const requestPromise = streamTimeout.promise
      .then((finalResponse: any) => {
        isDone = true;
        streamTimeout?.clear();
        if (resolveNext) resolveNext();
        return finalResponse;
      })
      .catch((err) => {
        error = toError(err, 'Streaming request failed');
        isDone = true;
        streamTimeout?.clear();
        if (resolveNext) resolveNext();
      });

    // Continuously yield from queue until Rust signifies it is "done"
    while (!isDone || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        // Wait for next event or completion
        await new Promise<void>((r) => { resolveNext = r; });
      }
    }

    if (error) {
      throw error;
    }
    
    // Yield the final result to capture token usage, artifacts, etc.
    const finalResponse = await requestPromise;
    yield { type: 'api_response_complete', response: finalResponse } as any;
  } finally {
    // Critical: Clean up listeners regardless of success/fail/abort so they don't leak
    streamTimeout?.clear();
    unlistenToken();
    unlistenReasoning();
    unlistenToolUse();
  }
}
