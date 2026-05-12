export type ChatInputSubmissionDecision =
  | { type: 'noop' }
  | { type: 'confirm-browser'; message: string }
  | { type: 'send-regular'; message: string };

/**
 * Maximum character length for chat draft content before it's considered "stale".
 *
 * Heuristic rationale: A user typing continuously for many messages will rarely
 * exceed 30KB of text. Drafts larger than this (without a timestamp indicating
 * recent activity) likely represent abandoned or forgotten input that can be
 * safely cleaned up to prevent unbounded localStorage growth.
 *
 * IMPORTANT: This is a content-based heuristic only. For proper staleness
 * detection, drafts should include timestamp metadata. This approach is a
 * fallback for drafts stored without timestamps.
 */
export const MAX_CHAT_DRAFT_CHARS = 30_000;

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

export function isStaleChatDraftValue(value: string): boolean {
  return value.length > MAX_CHAT_DRAFT_CHARS;
}
