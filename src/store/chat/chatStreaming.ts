export const STREAMING_TIMEOUT_MS = 300_000;
export const STREAMING_UI_THROTTLE_MS = 100;

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
