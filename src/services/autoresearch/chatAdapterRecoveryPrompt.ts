import {
  buildConvergenceRetryPrompt,
  buildRecoveryPrompt,
} from './chatAdapterSupport';
import {
  formatError,
  getToolRoundLimit,
  isToolRoundLimitError,
  type AutoResearchFailureKind,
} from './errors';
import type {
  AutoResearchObservedToolResult,
  AutoResearchReflectionDecision,
} from './reflection';

export const TOOL_BUDGET_EXHAUSTION_FAIL_REASON = 'tool budget exhausted before evaluation completed';

export interface SelectRecoveryAttemptPromptOptions {
  systemPrompt: string;
  decision: AutoResearchReflectionDecision;
  failureKind: AutoResearchFailureKind;
  allowedTools: string[];
  hardConstraintLines?: string[];
  error: unknown;
}

export function selectRecoveryAttemptPrompt({
  systemPrompt,
  decision,
  failureKind,
  allowedTools,
  hardConstraintLines,
  error,
}: SelectRecoveryAttemptPromptOptions): string {
  if (decision.action === 'switch_command') {
    return buildRecoveryPrompt(
      systemPrompt,
      decision,
      failureKind,
      allowedTools,
      hardConstraintLines,
    );
  }

  if (isToolRoundLimitError(error)) {
    return buildRecoveryPrompt(
      buildConvergenceRetryPrompt(
        systemPrompt,
        getToolRoundLimit(error),
        allowedTools,
        hardConstraintLines,
      ),
      decision,
      failureKind,
      allowedTools,
      hardConstraintLines,
    );
  }

  return buildRecoveryPrompt(
    systemPrompt,
    decision,
    failureKind,
    allowedTools,
    hardConstraintLines,
  );
}

export interface BuildIterationFailureExplanationParams {
  error: unknown;
  decision: AutoResearchReflectionDecision;
  experimentFailure?: AutoResearchObservedToolResult | null;
}

export interface IterationFailureExplanation {
  failReason: string;
  reasoning: string;
}

export function buildIterationFailureExplanation({
  error,
  decision,
  experimentFailure,
}: BuildIterationFailureExplanationParams): IterationFailureExplanation {
  const isLimit = isToolRoundLimitError(error);

  const failReason = isLimit
    ? TOOL_BUDGET_EXHAUSTION_FAIL_REASON
    : experimentFailure?.stderr?.trim()
      || decision.userMessage
      || decision.summary;

  const reasoning = isLimit
    ? `${decision.summary}${decision.rootCause ? ` Root cause: ${decision.rootCause}` : ''}`.trim()
    : experimentFailure?.stderr?.trim()
      || decision.summary
      || formatError(error);

  return { failReason, reasoning };
}
