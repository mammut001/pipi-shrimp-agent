import { create } from 'zustand';
import type { AutoResearchBootstrapResult, BootstrapStep } from './types';
import { loadPersistedBootstrapSession } from './bootstrapSessionPersist';

const TOOL_TO_STEP: Record<string, BootstrapStep> = {
  pdf_read: 'papers',
  paper_extract_meta: 'papers',
  arxiv_search: 'papers',
  read_file: 'papers',
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

function getInitialStoreState(): Pick<BootstrapPlanState, 'currentStep' | 'observedTools' | 'warnings' | 'readyResult'> {
  const persisted = loadPersistedBootstrapSession();
  if (persisted?.readyResult?.status === 'ready') {
    return {
      currentStep: 'ready',
      observedTools: persisted.observedTools || [],
      warnings: persisted.warnings || [],
      readyResult: persisted.readyResult,
    };
  }
  return {
    currentStep: 'goal',
    observedTools: [],
    warnings: [],
    readyResult: null,
  };
}

const initialState = getInitialStoreState();

export const useBootstrapPlanStore = create<BootstrapPlanState>((set) => ({
  currentStep: initialState.currentStep,
  observedTools: initialState.observedTools,
  warnings: initialState.warnings,
  readyResult: initialState.readyResult,
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
    currentStep: readyResult?.status === 'ready' ? 'ready' : 'scaffold',
  }),
  reset: () => set({
    currentStep: 'goal',
    observedTools: [],
    warnings: [],
    readyResult: null,
  }),
}));