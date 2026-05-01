export type ChatInputSubmissionDecision =
  | { type: 'noop' }
  | { type: 'confirm-browser'; message: string }
  | { type: 'send-regular'; message: string };

interface DecideChatInputSubmissionArgs {
  input: string;
  isStreaming: boolean;
  isSubmitting: boolean;
  isBrowserIntent: (message: string) => boolean;
}

export function decideChatInputSubmission({
  input,
  isStreaming,
  isSubmitting,
  isBrowserIntent,
}: DecideChatInputSubmissionArgs): ChatInputSubmissionDecision {
  const message = input.trim();

  if (!message || isStreaming || isSubmitting) {
    return { type: 'noop' };
  }

  if (isBrowserIntent(message)) {
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
  startSession: () => Promise<string>
): Promise<string> {
  if (currentSessionId) {
    return currentSessionId;
  }

  return startSession();
}

export function shouldClearDraftAfterBrowserWorkflow(handled: boolean): boolean {
  return handled;
}