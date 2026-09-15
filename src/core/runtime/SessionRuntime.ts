import type { EngineEvent, ToolExecutionResult } from '@/core/types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import {
  runQueryEngineTurn,
  type RunChatTurnOptions,
} from './queryLoop';
import { ToolResultChannel } from './ToolResultChannel';
import type { RuntimeHost } from './RuntimeHost';
import { defaultTauriRuntimeHost } from './tauriRuntimeHost';
import type {
  RuntimeTraceContext,
  RuntimeTraceEvent,
  RuntimeTraceEventName,
} from './RuntimeTrace';

export type RuntimeTurnId = string;

/**
 * Explicit turn lifecycle states for SessionRuntime.
 *
 * Transitions (happy path):
 *   created → running → waiting_tool → running → … → terminal
 * Cancel path:
 *   (created|running|waiting_tool) → cancelling → terminal
 *
 * Late continuations after `cancelling` or `terminal` must be refused.
 */
export type TurnState =
  | 'created'
  | 'running'
  | 'waiting_tool'
  | 'cancelling'
  | 'terminal';

/**
 * Clear introspection snapshot for SessionHandle / SessionRuntime.
 * Prefer this over reading individual getters when correlating identity + state.
 */
export interface SessionRuntimeSnapshot {
  sessionId: string;
  runtimeId: string;
  turnId: string | null;
  state: TurnState | 'idle';
  disposed: boolean;
}

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
  state: TurnState;
}

function newTurnId(sessionId: string): RuntimeTurnId {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:${randomId}`;
}

function isLiveTurnState(state: TurnState): boolean {
  return state !== 'terminal' && state !== 'cancelling';
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
 * - Release is ownership-aware (runtimeId / instance identity) to prevent async finally
 *   blocks from releasing newer runtimes that have taken over the same sessionId.
 */
export class SessionRuntime {
  readonly sessionId: string;
  /**
   * Stable identity for this runtime instance. Aliased as `runtimeId` so callers
   * can pass generation-aware release tokens without caring about the field name.
   */
  readonly instanceId: string;

  private readonly toolResults = new ToolResultChannel();
  private readonly host: RuntimeHost;
  private activeTurn: ActiveTurnState | null = null;
  private disposed = false;

  constructor(sessionId: string, host: RuntimeHost = defaultTauriRuntimeHost) {
    this.sessionId = sessionId;
    this.host = host;
    this.instanceId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /** Alias for `instanceId` — generation token for ownership-aware release. */
  get runtimeId(): string {
    return this.instanceId;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get activeTurnId(): RuntimeTurnId | null {
    return this.activeTurn && isLiveTurnState(this.activeTurn.state)
      ? this.activeTurn.turnId
      : null;
  }

  /**
   * Turn lifecycle state only (legacy / narrow callers).
   * Prefer {@link getSnapshot} for identity + state together.
   */
  getState(): TurnState | 'idle' {
    if (this.disposed) {
      return 'terminal';
    }
    return this.activeTurn?.state ?? 'idle';
  }

  /**
   * Clear introspection snapshot: sessionId / runtimeId / turnId / state / disposed.
   */
  getSnapshot(): SessionRuntimeSnapshot {
    return {
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
      turnId: this.activeTurn?.turnId ?? null,
      state: this.getState(),
      disposed: this.disposed,
    };
  }

  /**
   * Current unified trace context (session / runtime / active turn).
   * requestId / toolCallId are filled in when emitting wait/tool events.
   */
  getTraceContext(): RuntimeTraceContext {
    const turnId = this.activeTurn?.turnId;
    return {
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
      ...(turnId !== undefined ? { turnId } : {}),
    };
  }

  getActiveTurnId(): RuntimeTurnId | null {
    return this.activeTurnId;
  }

  /** @internal Test/support access to the process-local tool channel. */
  getToolResultChannel(): ToolResultChannel {
    return this.toolResults;
  }

  private emitTrace(
    type: RuntimeTraceEventName,
    extras?: {
      turnId?: string;
      requestId?: string;
      toolCallId?: string;
      reason?: string;
    },
  ): void {
    const sink = this.host.trace;
    if (!sink) {
      return;
    }
    const turnId = extras?.turnId ?? this.activeTurn?.turnId;
    const event: RuntimeTraceEvent = {
      type,
      at: Date.now(),
      context: {
        sessionId: this.sessionId,
        runtimeId: this.runtimeId,
        ...(turnId !== undefined ? { turnId } : {}),
        ...(extras?.requestId !== undefined ? { requestId: extras.requestId } : {}),
        ...(extras?.toolCallId !== undefined ? { toolCallId: extras.toolCallId } : {}),
      },
      ...(extras?.reason !== undefined ? { reason: extras.reason } : {}),
    };
    try {
      sink(event);
    } catch {
      // Trace must never break the runtime
    }
  }

  isTurnActive(turnId?: string): boolean {
    if (this.disposed || !this.activeTurn) {
      return false;
    }
    if (!isLiveTurnState(this.activeTurn.state)) {
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

  /**
   * Mark the active turn as waiting for tool results. No-op if turnId does not
   * match the live turn (stale continuation).
   */
  markWaitingTool(turnId: string, requestId?: string): void {
    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      return;
    }
    if (!isLiveTurnState(this.activeTurn.state)) {
      return;
    }
    this.activeTurn.state = 'waiting_tool';
    this.emitTrace('turn_waiting_tool', { turnId, requestId });
  }

  /**
   * Resume from waiting_tool → running after tool results are accepted.
   * Refuses transition if the turn is no longer live.
   */
  markRunning(turnId: string): void {
    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      return;
    }
    if (!isLiveTurnState(this.activeTurn.state)) {
      return;
    }
    this.activeTurn.state = 'running';
  }

  startTurn(turnId?: RuntimeTurnId): RuntimeTurnId {
    if (this.disposed) {
      throw new Error(`SessionRuntime ${this.sessionId} is already disposed`);
    }

    // Invariant: only one active turn per session runtime.
    // If a previous turn is still running in this session, cancel it before starting the new turn.
    if (this.activeTurn && isLiveTurnState(this.activeTurn.state)) {
      this.cancel('Superseded by new turn', this.activeTurn.turnId);
    }

    const id = turnId ?? newTurnId(this.sessionId);
    const controller = new AbortController();
    this.activeTurn = {
      turnId: id,
      controller,
      state: 'created',
    };
    this.emitTrace('turn_started', { turnId: id });
    return id;
  }

  async *runTurn(request: SessionTurnRequest): AsyncGenerator<EngineEvent, void, unknown> {
    const turnId = this.startTurn(request.turnId);
    const turnState = this.activeTurn!;
    turnState.state = 'running';
    const controller = turnState.controller;
    const externalSignal = request.options?.signal;
    const onExternalAbort = () => {
      this.cancel(externalSignal?.reason ?? 'External abort', turnId);
    };

    if (externalSignal?.aborted) {
      controller.abort(externalSignal.reason);
      turnState.state = 'terminal';
      this.emitTrace('turn_terminal', {
        turnId,
        reason: String(externalSignal.reason ?? 'External abort'),
      });
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      if (!isLiveTurnState(turnState.state) || controller.signal.aborted) {
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
          isTurnActive: () => this.isTurnActive(turnId),
          onWaitingTool: (info) => this.markWaitingTool(turnId, info?.requestId),
          onToolsResolved: () => this.markRunning(turnId),
        },
        request.pipiOutputDir,
        this.toolResults,
        turnId,
      )) {
        if (!isLiveTurnState(turnState.state) || controller.signal.aborted) {
          return;
        }
        if (!this.isTurnActive(turnId)) {
          return;
        }
        yield {
          ...event,
          sessionId: this.sessionId,
          turnId,
        } as EngineEvent;
      }
    } finally {
      // Always land in terminal; cancel() may already have moved through cancelling.
      const alreadyTerminal = turnState.state === 'terminal';
      turnState.state = 'terminal';
      if (!alreadyTerminal) {
        this.emitTrace('turn_terminal', { turnId });
      }
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (this.activeTurn?.turnId === turnId) {
        this.activeTurn = null;
      }
    }
  }

  submitToolResults(
    requestId: string,
    results: ToolExecutionResult[],
    turnId?: string,
  ): boolean {
    return this.toolResults.submit(requestId, results, turnId);
  }

  rejectToolResults(requestId: string, error: unknown, turnId?: string): boolean {
    return this.toolResults.reject(requestId, error, turnId);
  }

  cancel(reason = 'Session cancelled', turnId?: string): void {
    if (turnId && this.activeTurn && this.activeTurn.turnId !== turnId) {
      // Targeted cancel was meant for an older or different turn; ignore.
      return;
    }

    if (this.activeTurn && isLiveTurnState(this.activeTurn.state)) {
      const cancelledTurnId = this.activeTurn.turnId;
      this.activeTurn.state = 'cancelling';
      this.emitTrace('turn_cancelling', { turnId: cancelledTurnId, reason });
      this.activeTurn.controller.abort(reason);
      // cancelAll tombstones pending waiters so late results discard only.
      this.toolResults.cancelAll(reason);
      this.activeTurn.state = 'terminal';
      this.emitTrace('turn_terminal', { turnId: cancelledTurnId, reason });
    } else if (this.activeTurn) {
      this.toolResults.cancelAll(reason);
    } else {
      this.toolResults.cancelAll(reason);
    }

    try {
      void Promise.resolve(this.host.cancelSubprocess(this.sessionId)).catch(() => {});
    } catch {
      // Safe fallback if host throws synchronously
    }
  }

  cancelActiveTurn(reason = 'Session cancelled'): void {
    this.cancel(reason);
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
  /** @internal Underlying runtime — prefer runTurn/cancel/submitToolResults/state getters. */
  private readonly _runtime: SessionRuntime;

  constructor(runtime: SessionRuntime) {
    this._runtime = runtime;
    this.sessionId = runtime.sessionId;
  }

  get instanceId(): string {
    return this._runtime.instanceId;
  }

  get runtimeId(): string {
    return this._runtime.runtimeId;
  }

  get activeTurnId(): RuntimeTurnId | null {
    return this._runtime.activeTurnId;
  }

  get isDisposed(): boolean {
    return this._runtime.isDisposed;
  }

  getState(): TurnState | 'idle' {
    return this._runtime.getState();
  }

  getSnapshot(): SessionRuntimeSnapshot {
    return this._runtime.getSnapshot();
  }

  getTraceContext(): RuntimeTraceContext {
    return this._runtime.getTraceContext();
  }

  getActiveTurnId(): RuntimeTurnId | null {
    return this._runtime.getActiveTurnId();
  }

  isTurnActive(turnId?: string): boolean {
    return this._runtime.isTurnActive(turnId);
  }

  runTurn(request: SessionTurnRequest): AsyncGenerator<EngineEvent, void, unknown> {
    return this._runtime.runTurn(request);
  }

  submitToolResults(
    requestId: string,
    results: ToolExecutionResult[],
    turnId?: string,
  ): boolean {
    return this._runtime.submitToolResults(requestId, results, turnId);
  }

  rejectToolResults(requestId: string, error: unknown, turnId?: string): boolean {
    return this._runtime.rejectToolResults(requestId, error, turnId);
  }

  cancel(reason?: string, turnId?: string): void {
    this._runtime.cancel(reason, turnId);
  }

  cancelActiveTurn(reason?: string): void {
    this._runtime.cancelActiveTurn(reason);
  }

  dispose(): void {
    releaseSessionRuntime(this.sessionId, this);
  }
}

const sessionRuntimes = new Map<string, SessionRuntime>();
const sessionHandles = new Map<string, SessionHandle>();

export function getSessionHandle(
  sessionId: string,
  host: RuntimeHost = defaultTauriRuntimeHost,
): SessionHandle {
  const existing = sessionHandles.get(sessionId);
  if (existing) {
    return existing;
  }

  const runtime = new SessionRuntime(sessionId, host);
  const handle = new SessionHandle(runtime);
  sessionRuntimes.set(sessionId, runtime);
  sessionHandles.set(sessionId, handle);
  return handle;
}

export function submitSessionToolResults(
  sessionId: string,
  requestId: string,
  results: ToolExecutionResult[],
  turnId?: string,
): boolean {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return false;
  }
  return handle.submitToolResults(requestId, results, turnId);
}

export function rejectSessionToolResults(
  sessionId: string,
  requestId: string,
  error: unknown,
  turnId?: string,
): boolean {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return false;
  }
  return handle.rejectToolResults(requestId, error, turnId);
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

/**
 * Ownership-aware release.
 *
 * The owner token (SessionHandle, SessionRuntime, or runtimeId/instanceId) is
 * required so async finally blocks cannot dispose a newer generation that has
 * taken over the same sessionId. Mismatched tokens are a no-op.
 *
 * For test teardown that intentionally clears whatever is registered, use
 * {@link releaseSessionRuntimeForTests}.
 */
export function releaseSessionRuntime(
  sessionId: string,
  handleOrRuntimeOrId: SessionHandle | SessionRuntime | string,
): void {
  const current = sessionRuntimes.get(sessionId);
  if (!current) {
    return;
  }
  let targetRuntimeId: string;
  if (typeof handleOrRuntimeOrId === 'string') {
    targetRuntimeId = handleOrRuntimeOrId;
  } else if (handleOrRuntimeOrId instanceof SessionHandle) {
    targetRuntimeId = handleOrRuntimeOrId.runtimeId;
  } else {
    targetRuntimeId = handleOrRuntimeOrId.runtimeId;
  }
  if (current.runtimeId !== targetRuntimeId) {
    // Identity mismatch: a newer runtime has taken ownership of this sessionId.
    return;
  }
  current.dispose();
  sessionRuntimes.delete(sessionId);
  sessionHandles.delete(sessionId);
}

/**
 * Test-only: release whatever runtime is registered for sessionId without an
 * ownership token. Production callers must use {@link releaseSessionRuntime}.
 */
export function releaseSessionRuntimeForTests(sessionId: string): void {
  const current = sessionRuntimes.get(sessionId);
  if (!current) {
    return;
  }
  current.dispose();
  sessionRuntimes.delete(sessionId);
  sessionHandles.delete(sessionId);
}

/**
 * Test-only access to the sealed SessionRuntime behind a handle.
 * Prefer SessionHandle.runTurn / cancel / submitToolResults in production.
 */
export function getSessionRuntimeForTests(sessionId: string): SessionRuntime | undefined {
  return sessionRuntimes.get(sessionId);
}
