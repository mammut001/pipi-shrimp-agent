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

/**
 * Global stream chrome (`isStreaming` / `streamingContent` / `streamingReasoning` /
 * `streamingSessionId`) is selected-session UI. Background turns may finish while
 * another session is selected — only the owning selected session may mutate chrome.
 */
export function ownsSelectedStreamChrome(
  owningSessionId: string | null | undefined,
  currentSessionId: string | null | undefined,
): boolean {
  return Boolean(owningSessionId && currentSessionId && owningSessionId === currentSessionId);
}

/**
 * Per-session module stream text buffers.
 * Selected-session chrome (`streamingContent`) is already owner-gated; this map
 * keeps the high-frequency append buffer from being shared across concurrent
 * sessions (background A must not corrupt B when both stream / on switch).
 */
const streamingBuffersBySession = new Map<string, string>();

export function getStreamingBuffer(sessionId: string | null | undefined): string {
  if (!sessionId) {
    return '';
  }
  return streamingBuffersBySession.get(sessionId) ?? '';
}

export function setStreamingBuffer(sessionId: string | null | undefined, content: string): void {
  if (!sessionId) {
    return;
  }
  streamingBuffersBySession.set(sessionId, content);
}

export function clearStreamingBuffer(sessionId: string | null | undefined): void {
  if (!sessionId) {
    return;
  }
  streamingBuffersBySession.delete(sessionId);
}

/** Append delta onto the session buffer; seeds from fallbackChrome when empty. */
export function appendStreamingBuffer(
  sessionId: string,
  delta: string,
  fallbackChrome = '',
): string {
  const next = (streamingBuffersBySession.get(sessionId) ?? fallbackChrome) + delta;
  streamingBuffersBySession.set(sessionId, next);
  return next;
}

export function resetStreamingBuffersForTests(): void {
  streamingBuffersBySession.clear();
}

const cancellationRequestedSessions = new Set<string>();
const chatTurnAbortControllers = new Map<string, AbortController>();

export function createChatTurnAbortController(sessionId: string): AbortController {
  chatTurnAbortControllers.get(sessionId)?.abort();
  const controller = new AbortController();
  chatTurnAbortControllers.set(sessionId, controller);
  return controller;
}

export function abortChatTurn(sessionId: string | null | undefined): void {
  if (!sessionId) {
    return;
  }
  chatTurnAbortControllers.get(sessionId)?.abort();
  chatTurnAbortControllers.delete(sessionId);
}

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

/**
 * Per-session turn epoch for Stop vs same-session new-turn races.
 * `stopGeneration` snapshots the epoch before awaiting native cancel; a new
 * `sendMessage` bumps it so stale cancel completion skips session mutations.
 */
const chatSessionTurnEpochBySession = new Map<string, number>();

export function bumpChatSessionTurnEpoch(sessionId: string | null | undefined): number {
  if (!sessionId) {
    return 0;
  }
  const next = (chatSessionTurnEpochBySession.get(sessionId) ?? 0) + 1;
  chatSessionTurnEpochBySession.set(sessionId, next);
  return next;
}

export function getChatSessionTurnEpoch(sessionId: string | null | undefined): number {
  if (!sessionId) {
    return 0;
  }
  return chatSessionTurnEpochBySession.get(sessionId) ?? 0;
}

export function resetChatSessionTurnEpochForTests(): void {
  chatSessionTurnEpochBySession.clear();
}

export {
  appendTruncatedReplyNotice,
  isTruncatedProviderResponse,
  PROVIDER_STREAM_TRUNCATED_NOTICE,
  type ProviderStreamCompletionMeta,
} from '../../core/providerStreamFinalize';

