import { invoke } from '@tauri-apps/api/core';
import type { EngineEvent, ToolExecutionResult } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import {
  runQueryEngineTurn,
  type RunChatTurnOptions,
} from './queryLoop';
import { ToolResultChannel } from './ToolResultChannel';

export type RuntimeTurnId = string;

export interface SessionTurnRequest {
  turnId?: RuntimeTurnId;
  initialMessages: any[];
  systemPrompt: string;
  projectRoot?: string;
  allowBrowserTools?: boolean;
  requestConfig?: ResolvedAgentConfig;
  options?: RunChatTurnOptions;
  pipiOutputDir?: string;
}

interface ActiveTurnState {
  readonly turnId: RuntimeTurnId;
  readonly controller: AbortController;
  isTerminal: boolean;
}

function newTurnId(sessionId: string): RuntimeTurnId {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:${randomId}`;
}

/**
 * Owns the process-local lifecycle for one logical session.
 *
 * UI chat, headless, workflow and AutoResearch are clients of this runtime;
 * they no longer own a private continuation callback inside EngineEvent.
 *
 * Invariants:
 * - Exactly one active turn per SessionRuntime at any given time.
 * - Starting a turn cancels any prior active turn.
 * - Explicit per-turn identity ensures stale continuations cannot mutate subsequent turns.
 * - Cancellation is authoritative across provider stream, tool channel, and runtime state.
 * - Release is ownership-aware to prevent async finally blocks from releasing newer runtimes.
 */
export class SessionRuntime {
  readonly sessionId: string;
  readonly instanceId: string;

  private readonly toolResults = new ToolResultChannel();
  private activeTurn: ActiveTurnState | null = null;
  private disposed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.instanceId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get activeTurnId(): RuntimeTurnId | null {
    return this.activeTurn && !this.activeTurn.isTerminal
      ? this.activeTurn.turnId
      : null;
  }

  isTurnActive(turnId?: string): boolean {
    if (this.disposed || !this.activeTurn || this.activeTurn.isTerminal) {
      return false;
    }
    if (this.activeTurn.controller.signal.aborted) {
      return false;
    }
    if (turnId !== undefined && this.activeTurn.turnId !== turnId) {
      return false;
    }
    return true;
  }

  startTurn(turnId?: RuntimeTurnId): RuntimeTurnId {
    if (this.disposed) {
      throw new Error(`SessionRuntime ${this.sessionId} is already disposed`);
    }

    // Invariant: only one active turn per session runtime.
    // If a previous turn is still running in this session, cancel it before starting the new turn.
    if (this.activeTurn && !this.activeTurn.isTerminal) {
      this.cancel('Superseded by new turn', this.activeTurn.turnId);
    }

    const id = turnId ?? newTurnId(this.sessionId);
    const controller = new AbortController();
    this.activeTurn = {
      turnId: id,
      controller,
      isTerminal: false,
    };
    return id;
  }

  async *runTurn(request: SessionTurnRequest): AsyncGenerator<EngineEvent, void, unknown> {
    const turnId = this.startTurn(request.turnId);
    const turnState = this.activeTurn!;
    const controller = turnState.controller;
    const externalSignal = request.options?.signal;
    const onExternalAbort = () => {
      this.cancel(externalSignal?.reason ?? 'External abort', turnId);
    };

    if (externalSignal?.aborted) {
      controller.abort(externalSignal.reason);
      turnState.isTerminal = true;
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      if (turnState.isTerminal || controller.signal.aborted) {
        return;
      }

      for await (const event of runQueryEngineTurn(
        this.sessionId,
        request.initialMessages,
        request.systemPrompt,
        request.projectRoot,
        request.allowBrowserTools ?? false,
        request.requestConfig,
        {
          ...request.options,
          signal: controller.signal,
          turnId,
        },
        request.pipiOutputDir,
        this.toolResults,
        turnId,
      )) {
        if (turnState.isTerminal || controller.signal.aborted) {
          return;
        }
        yield {
          ...event,
          sessionId: this.sessionId,
          turnId,
        } as EngineEvent;
      }
    } finally {
      turnState.isTerminal = true;
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (this.activeTurn?.turnId === turnId) {
        this.activeTurn = null;
      }
    }
  }

  submitToolResults(requestId: string, results: ToolExecutionResult[]): void {
    this.toolResults.submit(requestId, results);
  }

  rejectToolResults(requestId: string, error: unknown): void {
    this.toolResults.reject(requestId, error);
  }

  cancel(reason = 'Session cancelled', turnId?: string): void {
    if (turnId && this.activeTurn && this.activeTurn.turnId !== turnId) {
      // Targeted cancel was meant for an older or different turn; ignore.
      return;
    }

    if (this.activeTurn) {
      this.activeTurn.isTerminal = true;
      this.activeTurn.controller.abort(reason);
    }

    this.toolResults.cancelAll(reason);

    try {
      void invoke('stop_subprocess', { sessionId: this.sessionId }).catch(() => {});
    } catch {
      // Safe fallback if invoke is not bound in tests
    }
  }

  cancelActiveTurns(reason = 'Session cancelled'): void {
    this.cancel(reason);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel('Session runtime disposed');
  }
}

/**
 * Cloneable-style client facade for SessionRuntime. Keep callers on this narrow
 * API so runtime ownership can later move behind IPC without changing clients.
 */
export class SessionHandle {
  readonly sessionId: string;
  readonly runtime: SessionRuntime;

  constructor(runtime: SessionRuntime) {
    this.runtime = runtime;
    this.sessionId = runtime.sessionId;
  }

  get instanceId(): string {
    return this.runtime.instanceId;
  }

  get activeTurnId(): RuntimeTurnId | null {
    return this.runtime.activeTurnId;
  }

  get isDisposed(): boolean {
    return this.runtime.isDisposed;
  }

  isTurnActive(turnId?: string): boolean {
    return this.runtime.isTurnActive(turnId);
  }

  startTurn(turnId?: RuntimeTurnId): RuntimeTurnId {
    return this.runtime.startTurn(turnId);
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

  cancel(reason?: string, turnId?: string): void {
    this.runtime.cancel(reason, turnId);
  }

  dispose(): void {
    releaseSessionRuntime(this.sessionId, this);
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

export function cancelSessionRuntime(
  sessionId: string,
  reason?: string,
  turnId?: string,
): boolean {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return false;
  }
  handle.cancel(reason, turnId);
  return true;
}

export function releaseSessionRuntime(
  sessionId: string,
  handleOrRuntime?: SessionHandle | SessionRuntime,
): void {
  const current = sessionRuntimes.get(sessionId);
  if (!current) {
    return;
  }
  if (handleOrRuntime) {
    const targetRuntime = handleOrRuntime instanceof SessionHandle
      ? handleOrRuntime.runtime
      : handleOrRuntime;
    if (current !== targetRuntime) {
      // Identity mismatch: a newer runtime has taken ownership of this sessionId.
      return;
    }
  }
  current.dispose();
  sessionRuntimes.delete(sessionId);
  sessionHandles.delete(sessionId);
}
