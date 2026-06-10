export type ChatInputSubmissionDecision =
  | { type: 'noop' }
  | { type: 'confirm-browser'; message: string }
  | { type: 'send-regular'; message: string };

// AUDIT-FIX [audit-1#6] — Two limits, both enforced. The size cap protects
// localStorage from runaway copy-paste; the staleness window protects users
// from accidentally losing freshly-typed long prompts. A draft is "stale"
// only if BOTH conditions hold: it's very large AND it hasn't been touched
// in the configured window. Drafts written before this code shipped have no
// timestamp, so we still apply the size cap as a fallback for them.
export const MAX_CHAT_DRAFT_CHARS = 30_000;
export const MAX_CHAT_DRAFT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DecideChatInputSubmissionArgs {
  input: string;
  hasAttachments?: boolean;
  isStreaming: boolean;
  isSubmitting: boolean;
  isBrowserIntent: (message: string) => boolean;
}

export function decideChatInputSubmission({
  input,
  hasAttachments = false,
  isStreaming,
  isSubmitting,
  isBrowserIntent,
}: DecideChatInputSubmissionArgs): ChatInputSubmissionDecision {
  const message = input.trim();

  if ((!message && !hasAttachments) || isStreaming || isSubmitting) {
    return { type: 'noop' };
  }

  if (message && !hasAttachments && isBrowserIntent(message)) {
    return { type: 'confirm-browser', message };
  }

  return { type: 'send-regular', message };
}

export function shouldDismissBrowserIntentConfirm(candidate: string | null, input: string): boolean {
  if (!candidate) {
    return false;
  }

  return input.trim() !== candidate;
}

export async function resolveChatTargetSessionId(
  currentSessionId: string | null | undefined,
  startSession: () => Promise<string | null>
): Promise<string | null> {
  if (currentSessionId) {
    return currentSessionId;
  }

  return startSession();
}

export function shouldClearDraftAfterBrowserWorkflow(handled: boolean): boolean {
  return handled;
}

/**
 * AUDIT-FIX [audit-1#6] — Determines whether a draft is safe to garbage
 * collect. We now consider time (when available) in addition to size. A
 * freshly-touched large prompt is left alone; only an old + huge draft is
 * pruned.
 *
 * @param value Draft content.
 * @param lastTouchedAt Optional epoch-ms timestamp of the last write.
 */
export function isStaleChatDraftValue(value: string, lastTouchedAt?: number | null): boolean {
  if (value.length <= MAX_CHAT_DRAFT_CHARS) {
    return false;
  }

  if (typeof lastTouchedAt === 'number' && lastTouchedAt > 0) {
    return Date.now() - lastTouchedAt >= MAX_CHAT_DRAFT_STALE_MS;
  }

  // No timestamp available (draft written by an older build): fall back to
  // the previous size-only rule so we still bound localStorage growth.
  return true;
}
