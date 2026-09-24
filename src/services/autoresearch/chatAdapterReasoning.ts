import { useAutoResearchStore } from '@/store/autoresearchStore';
import { emitAutoResearchRuntimeEvent } from './runtimeEvents';
import { previewFirstLines } from './chatAdapterSupport';

export interface AutoResearchReasoningBuffer {
  append: (chunk: string) => void;
  flush: (fallbackReasoning?: string) => void;
}

export function createReasoningBuffer(): AutoResearchReasoningBuffer {
  let reasoningBuffer = '';
  let reasoningFlushed = false;

  const flush = (fallbackReasoning?: string): void => {
    if (!reasoningBuffer && fallbackReasoning) {
      reasoningBuffer = fallbackReasoning;
    }

    const reasoningText = reasoningBuffer.trim();
    if (!reasoningText || reasoningFlushed) {
      return;
    }

    useAutoResearchStore.getState().appendLiveOutput(`[thinking]\n${reasoningText}\n`);
    emitAutoResearchRuntimeEvent({
      level: 'debug',
      phase: 'PLAN_HYPOTHESIS',
      type: 'thinking',
      message: reasoningText,
      summary: previewFirstLines(reasoningText, 2) || 'Thinking',
      detail: reasoningText,
    });
    emitAutoResearchRuntimeEvent({
      level: 'info',
      phase: 'PLAN_HYPOTHESIS',
      type: 'agent_plan',
      message: previewFirstLines(reasoningText, 6) || 'Agent plan recorded.',
      summary: previewFirstLines(reasoningText, 2) || 'Agent plan recorded.',
      detail: reasoningText,
    });
    reasoningFlushed = true;
  };

  return {
    append: (chunk: string): void => {
      reasoningBuffer += chunk;
    },
    flush,
  };
}
