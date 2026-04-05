/**
 * Context Analysis - Type Definitions
 */

import type { Message } from '../../types/chat';

// ============= Enums =============

export enum ConversationStructure {
  SINGLE_TURN = 'single_turn',
  COLLABORATIVE = 'collaborative',
  ITERATIVE = 'iterative',
  MULTI_TOPIC = 'multi_topic',
  MIXED = 'mixed',
}

export type CompactType = 'micro' | 'session' | 'legacy' | 'none';

export type TopicBoundaryType = 'task_start' | 'task_end' | 'topic_shift' | 'clarification';

// ============= Core Interfaces =============

export interface CompressionStrategy {
  should_compact: boolean;
  compact_type: CompactType;
  boundary_candidates: Message[];
  importance_scores: Map<string, number>;
  topic_boundaries: TopicBoundary[];
  recommendations: string[];
  conversation_structure: ConversationStructure;
  confidence: number;
}

export interface DetectedPatterns {
  toolCallCount: number;
  toolUsageRatio: number;
  iterativeScore: number;
  topicShiftCount: number;
  topicShiftConfidence: number;
  fileEditCount: number;
  artifactCount: number;
}

export interface StructureAnalysisResult {
  type: ConversationStructure;
  confidence: number;
  patterns: DetectedPatterns;
  metadata: {
    messageCount: number;
    toolCallCount: number;
    topicShiftCount: number;
    fileEditCount: number;
  };
}

export interface TopicBoundary {
  messageId: string;
  type: TopicBoundaryType;
  confidence: number;
  previousTopic?: string;
  newTopic?: string;
}

export interface MessageImportance {
  messageId: string;
  score: number;
  factors: {
    isUserIntent: boolean;
    isFinalAnswer: boolean;
    hasArtifact: boolean;
    isToolHeavy: boolean;
    isReasoning: boolean;
    isSummary: boolean;
    position: 'early' | 'mid' | 'late';
  };
}

export interface ContextAnalysisConfig {
  /** Whether intelligent analysis is enabled */
  enabled: boolean;
  /** Analysis depth */
  depth: 'quick' | 'full';
  /** Minimum message count before analysis runs */
  minMessagesForAnalysis: number;
  /** Message count at which analysis is always forced */
  forceAnalysisThreshold: number;
}
