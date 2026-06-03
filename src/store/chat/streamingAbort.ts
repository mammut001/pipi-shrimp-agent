/**
 * Streaming-turn AbortController registry.
 *
 * AUDIT-2026-06-02 (B4 / B5): each in-flight chat turn registers an
 * AbortController here keyed by sessionId. Both stopGeneration (in
 * chatActions) and selectSession (in createChatStore) consult this
 * registry so the engine's AbortSignal fires immediately, instead of
 * relying on a cooperative cancel flag checked only at chunk boundaries.
 *
 * Lives in its own module to avoid a circular import between chatActions
 * and createChatStore.
 */

const activeStreamingAbortControllers = new Map<string, AbortController>();

export function markStreamingAbortController(sessionId: string, controller: AbortController): void {
  // Defensively abort any leftover controller for this session before
  // installing the new one — otherwise a fast back-to-back sendMessage
  // for the same session could leave the previous controller orphaned.
  const existing = activeStreamingAbortControllers.get(sessionId);
  if (existing && !existing.signal.aborted) {
    existing.abort(new Error('Superseded by a new turn'));
  }
  activeStreamingAbortControllers.set(sessionId, controller);
}

export function clearStreamingAbortController(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  activeStreamingAbortControllers.delete(sessionId);
}

export function abortActiveStreaming(sessionId: string | null | undefined, reason: string): void {
  if (!sessionId) return;
  const controller = activeStreamingAbortControllers.get(sessionId);
  if (controller && !controller.signal.aborted) {
    controller.abort(new Error(reason));
  }
}
