/**
 * Context Analysis - Zustand Store
 */

import { create } from 'zustand';
import type { CompressionStrategy, ContextAnalysisConfig } from '../types';

interface ContextAnalysisState {
  // Config
  config: ContextAnalysisConfig;
  setConfig: (config: Partial<ContextAnalysisConfig>) => void;

  // Analysis state
  isAnalyzing: boolean;
  lastStrategy: CompressionStrategy | null;
  /** Rolling history of last 10 strategies */
  analysisHistory: CompressionStrategy[];

  // Actions
  setAnalyzing: (analyzing: boolean) => void;
  setLastStrategy: (strategy: CompressionStrategy) => void;
}

export const useContextAnalysisStore = create<ContextAnalysisState>((set) => ({
  config: {
    enabled: true,
    depth: 'full',
    minMessagesForAnalysis: 5,
    forceAnalysisThreshold: 50,
  },

  isAnalyzing: false,
  lastStrategy: null,
  analysisHistory: [],

  setConfig: (config) =>
    set((state) => ({ config: { ...state.config, ...config } })),

  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),

  setLastStrategy: (strategy) =>
    set((state) => ({
      lastStrategy: strategy,
      analysisHistory: [...state.analysisHistory.slice(-9), strategy],
    })),
}));
