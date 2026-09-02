import type { EngineEvent, ToolExecutionResult } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import {
  runQueryEngineTurn,
  type RunChatTurnOptions,
} from './queryLoop';
import { ToolResultChannel } from './ToolResultChannel';

export interface SessionTurnRequest {
  initialMessages: any[];
  systemPrompt: string;
  projectRoot?: string;
  allowBrowserTools?: boolean;
  requestConfig?: ResolvedAgentConfig;
  options?: RunChatTurnOptions;
  pipiOutputDir?: string;
}

function newTurnId(sessionId: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:${randomId}`;
}

/**
 * Owns the process-local lifecycle for one logical session.
 *
 * UI chat, headless, workflow and AutoResearch are clients of this runtime;
 * they no longer own a private continuation callback inside EngineEvent.
 */
export class SessionRuntime {
  readonly sessionId: string;

  private readonly toolResults = new ToolResultChannel();
  private readonly activeTurns = new Map<string, AbortController>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async *runTurn(request: SessionTurnRequest): AsyncGenerator<EngineEvent, void, unknown> {
    const turnId = newTurnId(this.sessionId);
    const controller = new AbortController();
    const externalSignal = request.options?.signal;
    const onExternalAbort = () => controller.abort(externalSignal?.reason);

    if (externalSignal?.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }

    this.activeTurns.set(turnId, controller);

    try {
      yield* runQueryEngineTurn(
        this.sessionId,
        request.initialMessages,
        request.systemPrompt,
        request.projectRoot,
        request.allowBrowserTools ?? false,
        request.requestConfig,
        {
          ...request.options,
          signal: controller.signal,
        },
        request.pipiOutputDir,
        this.toolResults,
      );
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.activeTurns.delete(turnId);
    }
  }

  submitToolResults(requestId: string, results: ToolExecutionResult[]): void {
    this.toolResults.submit(requestId, results);
  }

  rejectToolResults(requestId: string, error: unknown): void {
    this.toolResults.reject(requestId, error);
  }

  cancelActiveTurns(reason = 'Session cancelled'): void {
    for (const controller of this.activeTurns.values()) {
      controller.abort(reason);
    }
    this.toolResults.cancelAll(reason);
  }

  dispose(): void {
    this.cancelActiveTurns('Session runtime disposed');
  }
}

/**
 * Cloneable-style client facade for SessionRuntime. Keep callers on this narrow
 * API so runtime ownership can later move behind IPC without changing clients.
 */
export class SessionHandle {
  readonly sessionId: string;

  constructor(private readonly runtime: SessionRuntime) {
    this.sessionId = runtime.sessionId;
  }

  runTurn(request: SessionTurnRequest): AsyncGenerator<EngineEvent, void, unknown> {
    return this.runtime.runTurn(request);
  }

  submitToolResults(requestId: string, results: ToolExecutionResult[]): void {
    this.runtime.submitToolResults(requestId, results);
  }

  rejectToolResults(requestId: string, error: unknown): void {
    this.runtime.rejectToolResults(requestId, error);
  }

  cancel(reason?: string): void {
    this.runtime.cancelActiveTurns(reason);
  }
}

const sessionRuntimes = new Map<string, SessionRuntime>();
const sessionHandles = new Map<string, SessionHandle>();

export function getSessionHandle(sessionId: string): SessionHandle {
  const existing = sessionHandles.get(sessionId);
  if (existing) {
    return existing;
  }

  const runtime = new SessionRuntime(sessionId);
  const handle = new SessionHandle(runtime);
  sessionRuntimes.set(sessionId, runtime);
  sessionHandles.set(sessionId, handle);
  return handle;
}

export function submitSessionToolResults(
  sessionId: string,
  requestId: string,
  results: ToolExecutionResult[],
): boolean {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return false;
  }
  handle.submitToolResults(requestId, results);
  return true;
}

export function rejectSessionToolResults(
  sessionId: string,
  requestId: string,
  error: unknown,
): boolean {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return false;
  }
  handle.rejectToolResults(requestId, error);
  return true;
}

export function releaseSessionRuntime(sessionId: string): void {
  sessionRuntimes.get(sessionId)?.dispose();
  sessionRuntimes.delete(sessionId);
  sessionHandles.delete(sessionId);
}
