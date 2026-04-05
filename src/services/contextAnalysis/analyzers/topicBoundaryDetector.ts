/**
 * Context Analysis - Topic Boundary Detector
 *
 * Detects topic/task boundaries within the conversation.
 */

import type { Message } from '../../../types/chat';
import type { TopicBoundary, StructureAnalysisResult } from '../types';
import { isTopicShiftKeyword, isTaskCompleteKeyword, isTaskStartKeyword } from '../utils';

const TIME_GAP_MS = 30 * 60 * 1000; // 30 minutes

export function detectTopicBoundaries(
  messages: Message[],
  _structure: StructureAnalysisResult,
): TopicBoundary[] {
  const boundaries: TopicBoundary[] = [];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    const boundary = detectBoundaryBetween(prev, curr);
    if (boundary) {
      boundaries.push(boundary);
    }
  }

  return boundaries;
}

function detectBoundaryBetween(
  prev: Message,
  curr: Message,
): TopicBoundary | null {
  // 1. Keyword-based topic shift on user message
  if (curr.role === 'user') {
    if (isTopicShiftKeyword(curr.content) && !isTaskStartKeyword(curr.content)) {
      return { messageId: curr.id, type: 'topic_shift', confidence: 0.75 };
    }

    // Task completion in previous assistant + new user task
    if (prev.role === 'assistant' && isTaskCompleteKeyword(prev.content) && isTaskStartKeyword(curr.content)) {
      return { messageId: curr.id, type: 'task_start', confidence: 0.85 };
    }

    // Pure new task start after assistant response
    if (prev.role === 'assistant' && isTaskStartKeyword(curr.content)) {
      return { messageId: curr.id, type: 'task_start', confidence: 0.65 };
    }
  }

  // 2. Time gap
  const gap = curr.timestamp - prev.timestamp;
  if (gap > TIME_GAP_MS) {
    return { messageId: curr.id, type: 'topic_shift', confidence: 0.7 };
  }

  // 3. Clarification: user immediately follows up after their own message
  if (curr.role === 'user' && prev.role === 'user') {
    return { messageId: curr.id, type: 'clarification', confidence: 0.6 };
  }

  return null;
}
