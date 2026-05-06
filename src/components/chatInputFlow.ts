export type ChatInputSubmissionDecision =
  | { type: 'noop' }
  | { type: 'confirm-browser'; message: string }
  | { type: 'send-regular'; message: string };

export const MAX_CHAT_DRAFT_CHARS = 30000;

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
