import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ToolCallParams } from './types';

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
  browserConnected: boolean;
  sessionId: string;
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

  // A helper to push events into the async generator's queue
  function pushEvent(event: APIChunkEvent) {
    queue.push(event);
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

  const unlistenToolUs = await listen<{ session_id: string; tool_call_id: string; name: string; arguments: string }>('claude-tool-use', (e) => {
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
    const requestPromise = invoke('send_claude_sdk_chat_streaming', params)
      .then((finalResponse: any) => {
        isDone = true;
        if (resolveNext) resolveNext();
        return finalResponse;
      })
      .catch((err) => {
        error = err instanceof Error ? err : new Error(String(err));
        isDone = true;
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
    unlistenToken();
    unlistenReasoning();
    unlistenToolUs();
  }
}
