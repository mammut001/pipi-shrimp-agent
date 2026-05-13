import { create } from 'zustand';
import type { AutoResearchBootstrapResult, BootstrapStep } from './types';

const TOOL_TO_STEP: Record<string, BootstrapStep> = {
  pdf_read: 'papers',
  paper_extract_meta: 'papers',
  arxiv_search: 'papers',
  baseline_extract: 'baselines',
  scaffold_generate: 'scaffold',
  git_init_workdir: 'scaffold',
  bootstrap_finalize: 'ready',
};

interface BootstrapPlanState {
  currentStep: BootstrapStep;
  observedTools: string[];
  warnings: string[];
  readyResult: AutoResearchBootstrapResult | null;
  noteTool: (toolName: string) => void;
  markMetricsStep: () => void;
  setWarnings: (warnings: string[]) => void;
  setReadyResult: (result: AutoResearchBootstrapResult | null) => void;
  reset: () => void;
}

export const useBootstrapPlanStore = create<BootstrapPlanState>((set) => ({
  currentStep: 'goal',
  observedTools: [],
  warnings: [],
  readyResult: null,
  noteTool: (toolName) => set((state) => {
    const nextStep = TOOL_TO_STEP[toolName] ?? state.currentStep;
    return {
      currentStep: nextStep,
      observedTools: state.observedTools.includes(toolName)
        ? state.observedTools
        : [...state.observedTools, toolName],
    };
  }),
  markMetricsStep: () => set((state) => ({
    currentStep: state.currentStep === 'goal' || state.currentStep === 'papers'
      ? state.currentStep
      : state.currentStep === 'scaffold' || state.currentStep === 'ready'
        ? state.currentStep
        : 'metrics',
  })),
  setWarnings: (warnings) => set({ warnings }),
  setReadyResult: (readyResult) => set({
    readyResult,
    currentStep: readyResult?.status === 'ready' ? 'ready' : 'metrics',
  }),
  reset: () => set({
    currentStep: 'goal',
    observedTools: [],
    warnings: [],
    readyResult: null,
  }),
}));