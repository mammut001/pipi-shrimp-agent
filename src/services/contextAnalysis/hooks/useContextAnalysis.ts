/**
 * Context Analysis - React Hook
 */

import { useCallback } from 'react';
import type { Message } from '../../../types/chat';
import { useContextAnalysisStore } from './store';

export function useContextAnalysis() {
  const store = useContextAnalysisStore();

  const analyze = useCallback(
    async (sessionId: string, messages: Message[], workDir?: string) => {
      const { triggerContextAnalysis } = await import('./contextAnalysisTrigger');
      return triggerContextAnalysis(sessionId, messages, workDir);
    },
    [],
  );

  return {
    // State
    isAnalyzing: store.isAnalyzing,
    lastStrategy: store.lastStrategy,
    analysisHistory: store.analysisHistory,
    config: store.config,

    // Actions
    analyze,
    setConfig: store.setConfig,

    // Computed
    shouldSuggestCompact: store.lastStrategy?.should_compact ?? false,
    suggestedCompactType: store.lastStrategy?.compact_type ?? 'none',
    conversationStructure:
      store.lastStrategy?.conversation_structure ?? 'single_turn',
    topicBoundaries: store.lastStrategy?.topic_boundaries ?? [],
  };
}
