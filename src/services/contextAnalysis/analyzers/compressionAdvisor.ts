/**
 * Context Analysis - Compression Advisor
 *
 * Generates a compression recommendation based on all analysis results.
 */

import type { Message } from '../../../types/chat';
import type { CompressionAdvice } from '../engine';
import type { StructureAnalysisResult, TopicBoundary } from '../types';
import { ConversationStructure } from '../types';
import { estimateMessagesTokens } from '../../tokens/tokenEstimator';
import { getCompactConfig } from '../../compact/config';

export async function generateCompressionAdvice(
  messages: Message[],
  structure: StructureAnalysisResult,
  importanceScores: Map<string, number>,
  topicBoundaries: TopicBoundary[],
): Promise<CompressionAdvice> {
  const config = getCompactConfig();
  const totalTokens = await estimateMessagesTokens(messages);

  const validBoundaries = topicBoundaries.filter((b) => b.confidence > 0.7);
  const lowImportanceCount = [...importanceScores.values()].filter((s) => s < 0.3).length;

  // Layer 3: Legacy compact
  if (totalTokens > config.legacy_auto_threshold_tokens) {
    return {
      should_compact: true,
      compact_type: 'legacy',
      boundary_candidates: getBoundaryCandidates(validBoundaries, messages),
      recommendations: ['Legacy compact needed — token limit exceeded'],
    };
  }

  // Layer 2: Session memory compact
  if (totalTokens > config.sm_auto_threshold_tokens) {
    if (validBoundaries.length > 0) {
      return {
        should_compact: true,
        compact_type: 'session',
        boundary_candidates: getBoundaryCandidates(validBoundaries, messages),
        recommendations: ['Session memory compact at topic boundary'],
      };
    }
    return {
      should_compact: true,
      compact_type: 'legacy',
      boundary_candidates: [],
      recommendations: ['No clear boundary — legacy compact recommended'],
    };
  }

  // Layer 1: Microcompact — iterative pattern with many low-importance messages
  if (
    structure.type === ConversationStructure.ITERATIVE &&
    lowImportanceCount > 10
  ) {
    return {
      should_compact: true,
      compact_type: 'micro',
      boundary_candidates: [],
      recommendations: ['Iterative pattern — microcompact tool results'],
    };
  }

  return {
    should_compact: false,
    compact_type: 'none',
    boundary_candidates: [],
    recommendations: [],
  };
}

function getBoundaryCandidates(
  boundaries: TopicBoundary[],
  messages: Message[],
): Message[] {
  const idSet = new Set(boundaries.map((b) => b.messageId));
  return messages.filter((m) => idSet.has(m.id));
}
