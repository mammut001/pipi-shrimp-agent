/**
 * Context Analysis - Tool Usage Pattern Detector
 *
 * Detects tool-heavy / collaborative conversation patterns.
 */

import type { Message } from '../../../types/chat';
import { countToolCalls } from '../utils';

export interface ToolUsagePatternResult {
  /** Total tool calls across all messages */
  toolCallCount: number;
  /** Ratio of tool calls to messages (capped at 1.0) */
  toolUsageRatio: number;
  /** Whether tool usage is considered heavy (ratio > 0.5) */
  isHeavy: boolean;
}

export function detectToolUsagePattern(messages: Message[]): ToolUsagePatternResult {
  const toolCallCount = countToolCalls(messages);
  const toolUsageRatio =
    messages.length === 0 ? 0 : Math.min(toolCallCount / messages.length, 1);
  const isHeavy = toolUsageRatio > 0.5;

  return { toolCallCount, toolUsageRatio, isHeavy };
}
