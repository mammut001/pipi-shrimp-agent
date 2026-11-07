export class CompletionRejectedError extends Error {
  readonly reasons: string[];
  readonly commandOutputs: string[];
  readonly modelTrail: string[];
  readonly stalled: boolean;

  constructor(
    reasons: string[],
    commandOutputs: string[] = [],
    options: { modelTrail?: string[]; stalled?: boolean } = {},
  ) {
    super(`Completion rejected: ${reasons.join('; ')}`);
    this.name = 'CompletionRejectedError';
    this.reasons = reasons;
    this.commandOutputs = commandOutputs;
    this.modelTrail = options.modelTrail ?? [];
    this.stalled = options.stalled ?? false;
  }

  isCompletionRejectedError(): boolean {
    return true;
  }
}

export function isCompletionRejectedError(error: unknown): boolean {
  if (error instanceof CompletionRejectedError) {
    return true;
  }
  return (
    error instanceof Error &&
    (error.name === 'CompletionRejectedError' ||
      (typeof (error as { isCompletionRejectedError?: unknown }).isCompletionRejectedError === 'function'))
  );
}
