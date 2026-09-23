import { type WorkflowAgent } from '@/types/workflow';
import {
  type StreamChunkCallback,
} from './agentRunner';
import {
  WorkflowTranscriptManager,
} from './transcript';
import { type WorkflowEngineDeps } from './engineDeps';

/** Host surface needed to invoke an agent with abort/stream wiring. */
export interface AgentExecutionHost {
  currentRunId: string;
  workingDirectory: string;
  abortController: AbortController | null;
  deps: WorkflowEngineDeps;
  transcripts: WorkflowTranscriptManager;
  onStreamChunk?: StreamChunkCallback;
  shouldAcceptRunMutation(runId: string): boolean;
}

export async function executeAgent(
  host: AgentExecutionHost,
  agent: WorkflowAgent,
  prompt: string,
  options?: {
    systemPromptOverride?: string;
    disableStreaming?: boolean;
    signal?: AbortSignal;
    noTools?: boolean;
    allowedTools?: string[];
  },
): Promise<string> {
  const runId = host.currentRunId;

  let effectiveSignal = host.abortController?.signal;
  if (options?.signal) {
    if (!effectiveSignal) {
      effectiveSignal = options.signal;
    } else if (typeof AbortSignal.any === 'function') {
      effectiveSignal = AbortSignal.any([effectiveSignal, options.signal]);
    } else {
      const composite = new AbortController();
      const onAbort = () => composite.abort();
      if (effectiveSignal.aborted || options.signal.aborted) {
        composite.abort();
      } else {
        effectiveSignal.addEventListener('abort', onAbort, { once: true });
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      effectiveSignal = composite.signal;
    }
  }

  return host.deps.runAgent(
    agent,
    prompt,
    {
      runId,
      workDir: host.workingDirectory,
      signal: effectiveSignal,
      noTools: options?.noTools,
      allowedTools: options?.allowedTools,
      onStreamChunk: options?.disableStreaming ? undefined : ((agentId, chunk, fullContent) => {
        if (!host.shouldAcceptRunMutation(runId)) return;
        host.onStreamChunk?.(agentId, chunk, fullContent);
      }),
      transcript: host.transcripts,
    },
    { systemPromptOverride: options?.systemPromptOverride },
  );
}
