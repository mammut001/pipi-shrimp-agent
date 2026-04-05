/**
 * Context Analysis - Topic Shift Detector
 *
 * Lightweight detector that counts probable topic shifts in a message list.
 */

import type { Message } from '../../../types/chat';
import { isTopicShiftKeyword } from '../utils';

export interface TopicShiftResult {
  /** Number of probable topic shifts */
  count: number;
  /** Overall confidence that multi-topic structure exists (0–1) */
  confidence: number;
}

export function detectTopicShifts(messages: Message[]): TopicShiftResult {
  const userMessages = messages.filter((m) => m.role === 'user');
  const shifts = userMessages.filter((m) => isTopicShiftKeyword(m.content));

  const count = shifts.length;
  const confidence =
    count === 0
      ? 0
      : Math.min(count / Math.max(userMessages.length, 1), 1);

  return { count, confidence };
}
