/**
 * Shared chat utilities - extracted to avoid duplication across components
 */

import type { Session, Message } from '@/types/chat';

/**
 * Calculate total token usage for a session
 */
export function getSessionTokenUsage(session: Session | null): { input: number; output: number; total: number } {
  if (!session) return { input: 0, output: 0, total: 0 };

  let input = 0;
  let output = 0;

  for (const message of session.messages) {
    if (message.token_usage) {
      input += message.token_usage.input_tokens;
      output += message.token_usage.output_tokens;
    }
  }

  return { input, output, total: input + output };
}

/**
 * Format token count for display (compact format)
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Merge multiple reasoning parts, deduplicating and preserving order
 */
export function mergeReasoningParts(...parts: Array<string | undefined | null>): string | undefined {
  const merged: string[] = [];

  for (const part of parts) {
    const normalized = part?.trim();
    if (!normalized) continue;
    if (!merged.includes(normalized)) {
      merged.push(normalized);
    }
  }

  return merged.length > 0 ? merged.join('\n\n') : undefined;
}

/**
 * Check if a message should be rendered (filter out internal tool-result messages)
 */
export function isRenderableMessage(message: Message, index: number, allMessages: Message[]): boolean {
  const isLastMessage = index === allMessages.length - 1;
  if (isLastMessage) return true;

  return !(
    message.role === 'assistant' &&
    message.content === '' &&
    message.tool_calls &&
    message.tool_calls.length > 0
  );
}

/**
 * Filter and process messages for display, merging reasoning from assistant groups
 */
export function processMessagesForDisplay(messages: Message[]): Message[] {
  // Filter out internal tool-result messages
  const filtered = messages.filter(
    (m) => !(m.role === 'user' && m.content.startsWith('__TOOL_RESULT__:'))
  );

  const reasoningByIndex = new Map<number, string>();
  let assistantGroupIndices: number[] = [];
  let assistantReasoningParts: Array<string | undefined> = [];

  const finalizeAssistantGroup = () => {
    if (assistantGroupIndices.length === 0) return;

    const combinedReasoning = mergeReasoningParts(...assistantReasoningParts);
    if (combinedReasoning) {
      const visibleIndex =
        [...assistantGroupIndices]
          .reverse()
          .find((idx) => isRenderableMessage(filtered[idx], idx, filtered)) ??
        assistantGroupIndices[assistantGroupIndices.length - 1];

      reasoningByIndex.set(visibleIndex, combinedReasoning);
    }

    assistantGroupIndices = [];
    assistantReasoningParts = [];
  };

  filtered.forEach((message, index) => {
    if (message.role === 'assistant') {
      assistantGroupIndices.push(index);
      if (message.reasoning) {
        assistantReasoningParts.push(message.reasoning);
      }
      return;
    }

    finalizeAssistantGroup();
  });

  finalizeAssistantGroup();

  return filtered
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => isRenderableMessage(message, index, filtered))
    .map(({ message, index }) =>
      message.role === 'assistant'
        ? { ...message, reasoning: reasoningByIndex.get(index) }
        : message
    );
}
