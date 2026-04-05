/**
 * Context Analysis - Importance Analyzer
 *
 * Assigns an importance score 0.0–1.0 to each message.
 */

import type { Message } from '../../../types/chat';
import type { StructureAnalysisResult } from '../types';
import {
  getMessagePosition,
  isTaskStartKeyword,
  isReasoningText,
  isSummaryText,
  hasCodeArtifact,
} from '../utils';

/**
 * Returns a Map<messageId, importanceScore> for all messages.
 */
export function analyzeImportance(
  messages: Message[],
  _structure: StructureAnalysisResult,
): Map<string, number> {
  const scores = new Map<string, number>();
  const total = messages.length;

  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    const position = getMessagePosition(i, total);

    let score = 0;

    // User intent
    if (msg.role === 'user' && isTaskStartKeyword(msg.content)) {
      score += 0.3;
    }

    // Final assistant answer (last assistant message in the conversation)
    const isLastAssistant =
      msg.role === 'assistant' &&
      messages.slice(i + 1).every((m) => m.role !== 'assistant');
    if (isLastAssistant) {
      score += 0.4;
    }

    // Code/artifact
    if (hasCodeArtifact(msg)) {
      score += 0.3;
    }

    // Important-looking tool call (many tools = heavy tool usage)
    if ((msg.tool_calls?.length ?? 0) > 0) {
      // Only the first assistant message with tool calls gets a bump
      const priorToolMsg = messages.slice(0, i).some((m) => (m.tool_calls?.length ?? 0) > 0);
      if (!priorToolMsg) {
        score += 0.2;
      }
    }

    // Reasoning
    if (msg.reasoning || isReasoningText(msg.content)) {
      score += 0.1;
    }

    // Summary
    if (isSummaryText(msg.content)) {
      score += 0.2;
    }

    // All-user messages get a baseline boost (they drive the conversation)
    if (msg.role === 'user') {
      score += 0.1;
    }

    // Position adjustment
    if (position === 'early') {
      score -= 0.1;
    } else if (position === 'late') {
      score += 0.2;
    }

    scores.set(msg.id, Math.max(0, Math.min(1, score)));
  }

  return scores;
}
