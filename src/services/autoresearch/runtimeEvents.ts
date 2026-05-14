import { useAutoResearchStore } from '@/store/autoresearchStore';
import type { AutoResearchRunEvent, AutoResearchRunPhase } from './history';

function getActiveRunContext() {
  const state = useAutoResearchStore.getState();
  const iteration = state.currentIteration > 0 ? state.currentIteration : undefined;
  const iterationId = state.id && iteration ? `${state.id}-iter-${iteration}` : undefined;
  return {
    runId: state.id,
    iteration,
    iterationId,
  };
}

export function emitAutoResearchRuntimeEvent(
  input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string },
): void {
  const context = getActiveRunContext();
  if (!context.runId) {
    return;
  }

  useAutoResearchStore.getState().addRunEvent({
    ...input,
    iterationId: input.iterationId ?? context.iterationId,
    metadata: {
      ...(typeof context.iteration === 'number' ? { iteration: context.iteration } : {}),
      ...(input.metadata ?? {}),
    },
  });
}

export function setAutoResearchPhase(
  phase: AutoResearchRunPhase,
  options: {
    iteration?: number;
    level?: AutoResearchRunEvent['level'];
    summary?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  const state = useAutoResearchStore.getState();
  const iteration = options.iteration ?? (state.currentIteration > 0 ? state.currentIteration : undefined);
  if (typeof iteration === 'number') {
    state.patchIterationRecord({ iteration, phase });
  }
  state.setCurrentPhase(phase);

  emitAutoResearchRuntimeEvent({
    level: options.level ?? 'info',
    phase,
    type: 'phase_started',
    summary: options.summary ?? phase,
    message: options.message ?? `${phase} started.`,
    metadata: options.metadata,
    iterationId: state.id && typeof iteration === 'number' ? `${state.id}-iter-${iteration}` : undefined,
  });
}
