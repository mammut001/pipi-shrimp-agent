/**
 * Context Analysis - Public API
 */

// Engine
export { analyzeContext } from './engine';
export type { ContextAnalysisInput, CompressionAdvice } from './engine';

// Types
export type {
  CompressionStrategy,
  ContextAnalysisConfig,
  TopicBoundary,
  MessageImportance,
  StructureAnalysisResult,
  DetectedPatterns,
  CompactType,
  TopicBoundaryType,
} from './types';
export { ConversationStructure } from './types';

// Hook
export { useContextAnalysis } from './hooks/useContextAnalysis';
export { triggerContextAnalysis } from './hooks/contextAnalysisTrigger';
export { useContextAnalysisStore } from './hooks/store';

// Analyzers (for testing / direct use)
export { analyzeStructure } from './analyzers/structureAnalyzer';
export { analyzeImportance } from './analyzers/importanceAnalyzer';
export { detectTopicBoundaries } from './analyzers/topicBoundaryDetector';
export { generateCompressionAdvice } from './analyzers/compressionAdvisor';

// Detectors
export { detectIterativePattern } from './detectors/iterativePatternDetector';
export { detectToolUsagePattern } from './detectors/toolUsagePatternDetector';
export { detectTopicShifts } from './detectors/topicShiftDetector';
