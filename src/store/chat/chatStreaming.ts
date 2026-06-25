import type { EngineEvent, TokenUsage } from '../../core/types';
import { mergeReasoningParts, parseThinkContent } from '../../utils/chatHelpers';

export const STREAMING_TIMEOUT_MS = 300_000;
export const STREAMING_UI_THROTTLE_MS = 100;

export interface StreamingAccumulator {
  content: string;
  reasoning: string;
  tokenUsage?: TokenUsage;
  statusMessages: string[];
}

export interface FlushedStreamingBuffer {
  content: string;
  reasoning?: string;
}

export function createStreamingAccumulator(): StreamingAccumulator {
  return {
    content: '',
    reasoning: '',
    tokenUsage: undefined,
    statusMessages: [],
  };
}

export function handleStreamChunk(
  state: StreamingAccumulator,
  chunk: EngineEvent,
): StreamingAccumulator {
  switch (chunk.type) {
    case 'text_delta':
      return { ...state, content: state.content + chunk.content };
    case 'reasoning_delta':
      return { ...state, reasoning: state.reasoning + chunk.content };
    case 'status_update':
      return { ...state, statusMessages: [...state.statusMessages, chunk.message] };
    case 'turn_complete':
      return { ...state, tokenUsage: chunk.tokenUsage ?? state.tokenUsage };
    default:
      return state;
  }
}

export function flushBuffer(buffer: StreamingAccumulator): FlushedStreamingBuffer {
  const parsed = parseThinkContent(buffer.content);
  return {
    content: parsed.content,
    reasoning: mergeReasoningParts(buffer.reasoning, parsed.reasoning),
  };
}

/**
 * Reset streamed assistant text/reasoning after a tool batch completes.
 * Agent turns may invoke the model multiple times; keeping only the
 * latest round's buffers avoids repeating the same planning block in
 * the live UI and in the persisted reasoning field.
 */
export function clearStreamingRoundBuffers(
  state: StreamingAccumulator,
): StreamingAccumulator {
  return {
    ...state,
    content: '',
    reasoning: '',
  };
}

export function detectStreamEnd(chunk: EngineEvent): boolean {
  return chunk.type === 'turn_complete' || chunk.type === 'error' || chunk.type === 'api_response_complete';
}

export function shouldFlushStreamingUpdate(
  now: number,
  lastUiUpdateTime: number,
  throttleMs = STREAMING_UI_THROTTLE_MS,
): boolean {
  return now - lastUiUpdateTime >= throttleMs;
}

export function resolveStreamingOwnerSessionId(
  streamingSessionId: string | null,
  currentSessionId: string | null,
): string | null {
  return streamingSessionId || currentSessionId;
}

const cancellationRequestedSessions = new Set<string>();

export function requestChatGenerationCancel(sessionId: string | null | undefined): void {
  if (sessionId) {
    cancellationRequestedSessions.add(sessionId);
  }
}

export function clearChatGenerationCancel(sessionId: string | null | undefined): void {
  if (sessionId) {
    cancellationRequestedSessions.delete(sessionId);
  }
}

export function consumeChatGenerationCancel(sessionId: string | null | undefined): boolean {
  if (!sessionId) {
    return false;
  }
  const requested = cancellationRequestedSessions.has(sessionId);
  if (requested) {
    cancellationRequestedSessions.delete(sessionId);
  }
  return requested;
}
