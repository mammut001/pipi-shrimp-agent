import type { ExecutionModeId } from './registry';
import { detectAskModeToolNeed } from './askModeToolNeed';

export function isGenericSafetyPolicyError(message: string): boolean {
  return /every tool call in the last round was rejected by the safety policy/i.test(message);
}

export function isAskModeToolFailureText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes('ask mode')
    || normalized.includes('问答模式')
    || normalized.includes('tool execution is disabled in ask mode');
}

export function shouldOfferExecutionModeUpgrade(
  errorMessage: string,
  executionModeId: ExecutionModeId | string,
  userContent: string,
): boolean {
  if (executionModeId !== 'ask' && executionModeId !== 'plan') {
    return false;
  }
  if (executionModeId === 'ask' && detectAskModeToolNeed(userContent).needed) {
    return true;
  }
  if (!isGenericSafetyPolicyError(errorMessage) && !isAskModeToolFailureText(errorMessage)) {
    return false;
  }
  return detectAskModeToolNeed(userContent).needed;
}
