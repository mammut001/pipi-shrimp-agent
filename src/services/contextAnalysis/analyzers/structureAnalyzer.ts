/**
 * Context Analysis - Structure Analyzer
 *
 * Detects the overall conversation structure type.
 */

import type { Message } from '../../../types/chat';
import type { DetectedPatterns, StructureAnalysisResult } from '../types';
import { ConversationStructure } from '../types';
import {
  countToolCalls,
  countFileEdits,
  countRepeatFileEdits,
  isTopicShiftKeyword,
} from '../utils';

export function analyzeStructure(messages: Message[]): StructureAnalysisResult {
  const patterns = detectPatterns(messages);

  const scores: Record<string, number> = {
    [ConversationStructure.SINGLE_TURN]: calculateSingleTurnScore(messages),
    [ConversationStructure.COLLABORATIVE]: patterns.toolUsageRatio,
    [ConversationStructure.ITERATIVE]: patterns.iterativeScore,
    [ConversationStructure.MULTI_TOPIC]:
      patterns.topicShiftCount > 0 ? patterns.topicShiftConfidence : 0,
    [ConversationStructure.MIXED]: 0,
  };

  // MIXED if multiple high scores
  const highScores = Object.entries(scores).filter(([k, v]) => k !== ConversationStructure.MIXED && v > 0.5);
  if (highScores.length >= 2) {
    scores[ConversationStructure.MIXED] = Math.max(...highScores.map(([, v]) => v)) * 0.9;
  }

  const type = selectStructureType(scores);
  const confidence = scores[type];

  return {
    type,
    confidence,
    patterns,
    metadata: {
      messageCount: messages.length,
      toolCallCount: patterns.toolCallCount,
      topicShiftCount: patterns.topicShiftCount,
      fileEditCount: patterns.fileEditCount,
    },
  };
}

function detectPatterns(messages: Message[]): DetectedPatterns {
  const toolCallCount = countToolCalls(messages);
  const toolUsageRatio =
    messages.length === 0 ? 0 : Math.min(toolCallCount / messages.length, 1);

  const fileEditCount = countFileEdits(messages);
  const repeatFileEdits = countRepeatFileEdits(messages);
  const iterativeScore = fileEditCount === 0 ? 0 : Math.min(repeatFileEdits / fileEditCount, 1);

  // Topic shift: count user messages starting with shift keywords
  const userMessages = messages.filter((m) => m.role === 'user');
  const shiftMessages = userMessages.filter((m) => isTopicShiftKeyword(m.content));
  const topicShiftCount = shiftMessages.length;
  const topicShiftConfidence =
    topicShiftCount === 0 ? 0 : Math.min(topicShiftCount / Math.max(userMessages.length, 1), 1);

  const artifactCount = messages.filter(
    (m) => m.artifacts && m.artifacts.length > 0,
  ).length;

  return {
    toolCallCount,
    toolUsageRatio,
    iterativeScore,
    topicShiftCount,
    topicShiftConfidence,
    fileEditCount,
    artifactCount,
  };
}

function calculateSingleTurnScore(messages: Message[]): number {
  if (messages.length <= 2) return 1.0;
  if (messages.length <= 4) return 0.5;
  return 0;
}

function selectStructureType(scores: Record<string, number>): ConversationStructure {
  let best = ConversationStructure.SINGLE_TURN;
  let bestScore = -1;
  for (const [k, v] of Object.entries(scores)) {
    if (v > bestScore) {
      bestScore = v;
      best = k as ConversationStructure;
    }
  }
  return best;
}
