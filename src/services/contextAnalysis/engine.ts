/**
 * Context Analysis - Core Engine
 *
 * Orchestrates all analyzers and returns a CompressionStrategy.
 * Call this after runChatTurn() completes.
 */

import type { Message } from '../../types/chat';
import { analyzeStructure } from './analyzers/structureAnalyzer';
import { analyzeImportance } from './analyzers/importanceAnalyzer';
import { detectTopicBoundaries } from './analyzers/topicBoundaryDetector';
import { generateCompressionAdvice } from './analyzers/compressionAdvisor';
import type { CompressionStrategy, ContextAnalysisConfig, TopicBoundary } from './types';
import { ConversationStructure } from './types';

// ============================================================================
// Public interfaces
// ============================================================================

export interface ContextAnalysisInput {
  messages: Message[];
  currentSessionId: string;
  config?: Partial<ContextAnalysisConfig>;
}

/** Returned by compressionAdvisor; used internally by the engine */
export interface CompressionAdvice {
  should_compact: boolean;
  compact_type: 'micro' | 'session' | 'legacy' | 'none';
  boundary_candidates: Message[];
  recommendations: string[];
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: ContextAnalysisConfig = {
  enabled: true,
  depth: 'full',
  minMessagesForAnalysis: 5,
  forceAnalysisThreshold: 50,
};

// ============================================================================
// Engine entry point
// ============================================================================

/**
 * Main context analysis function.
 * Run after each API turn to decide whether and how to compact.
 */
export async function analyzeContext(
  input: ContextAnalysisInput,
): Promise<CompressionStrategy> {
  const config: ContextAnalysisConfig = { ...DEFAULT_CONFIG, ...input.config };
  const { messages } = input;

  // Fast path: too few messages
  if (messages.length < config.minMessagesForAnalysis) {
    return createEmptyStrategy();
  }

  // If analysis is disabled, skip (unless we're forced by threshold)
  if (!config.enabled && messages.length < config.forceAnalysisThreshold) {
    return createEmptyStrategy();
  }

  return runFullAnalysis(messages);
}

// ============================================================================
// Internal
// ============================================================================

async function runFullAnalysis(messages: Message[]): Promise<CompressionStrategy> {
  // 1. Structure
  const structure = analyzeStructure(messages);

  // 2. Importance scores
  const importanceScores = analyzeImportance(messages, structure);

  // 3. Topic boundaries
  const topicBoundaries: TopicBoundary[] = detectTopicBoundaries(messages, structure);

  // 4. Compression advice
  const advice = await generateCompressionAdvice(
    messages,
    structure,
    importanceScores,
    topicBoundaries,
  );

  return {
    should_compact: advice.should_compact,
    compact_type: advice.compact_type,
    boundary_candidates: advice.boundary_candidates,
    importance_scores: importanceScores,
    topic_boundaries: topicBoundaries,
    recommendations: advice.recommendations,
    conversation_structure: structure.type,
    confidence: structure.confidence,
  };
}

function createEmptyStrategy(): CompressionStrategy {
  return {
    should_compact: false,
    compact_type: 'none',
    boundary_candidates: [],
    importance_scores: new Map(),
    topic_boundaries: [],
    recommendations: [],
    conversation_structure: ConversationStructure.SINGLE_TURN,
    confidence: 0,
  };
}
