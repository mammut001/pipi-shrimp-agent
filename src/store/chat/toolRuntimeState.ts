import type { ChatState } from '../../types/chat';
import type { TaskStep } from '../../types/ui';
import { useUIStore } from '../uiStore';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

interface SessionToolRuntimeState {
  steps: Map<string, TaskStep>;
  unresolvedIds: Set<string>;
  results: Map<string, string>;
}

const toolRuntimeBySession = new Map<string, SessionToolRuntimeState>();

function getOrCreateSessionToolRuntime(sessionId: string): SessionToolRuntimeState {
  let runtime = toolRuntimeBySession.get(sessionId);
  if (!runtime) {
    runtime = {
      steps: new Map<string, TaskStep>(),
      unresolvedIds: new Set<string>(),
      results: new Map<string, string>(),
    };
    toolRuntimeBySession.set(sessionId, runtime);
  }
  return runtime;
}

function buildPendingToolResults(runtime: SessionToolRuntimeState): ChatState['pendingToolResults'] {
  return [...runtime.results.entries()].map(([toolCallId, result]) => ({ toolCallId, result }));
}

function buildTaskSteps(runtime: SessionToolRuntimeState): TaskStep[] {
  return [...runtime.steps.values()];
}

function syncCurrentSessionToolRuntime(set: ChatSetState, get: () => ChatState): void {
  const currentSessionId = get().currentSessionId;
  const uiStore = useUIStore.getState();

  if (!currentSessionId) {
    set({ pendingToolCalls: 0, pendingToolResults: [] });
    uiStore.clearTaskProgress();
    return;
  }

  const runtime = toolRuntimeBySession.get(currentSessionId);
  if (!runtime || runtime.steps.size === 0) {
    set({ pendingToolCalls: 0, pendingToolResults: [] });
    uiStore.clearTaskProgress();
    return;
  }

  set({
    pendingToolCalls: runtime.unresolvedIds.size,
    pendingToolResults: buildPendingToolResults(runtime),
  });
  uiStore.setTaskProgress(buildTaskSteps(runtime));
}

function setStepStatus(
  runtime: SessionToolRuntimeState,
  toolCallId: string,
  label: string,
  status: TaskStep['status'],
): void {
  const existing = runtime.steps.get(toolCallId);
  runtime.steps.set(toolCallId, {
    id: toolCallId,
    label: existing?.label ?? label,
    status,
    executionId: existing?.executionId ?? null,
  });
}

function setStepExecutionId(
  runtime: SessionToolRuntimeState,
  toolCallId: string,
  label: string,
  executionId: string | null,
): void {
  const existing = runtime.steps.get(toolCallId);
  runtime.steps.set(toolCallId, {
    id: toolCallId,
    label: existing?.label ?? label,
    status: existing?.status ?? 'pending',
    executionId,
  });
}

function isTerminalStepStatus(status: TaskStep['status']): boolean {
  return status === 'done'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'timed_out'
    || status === 'rejected';
}

export function seedSessionToolRuntime(
  sessionId: string,
  tools: Array<{ id: string; name: string }>,
  set: ChatSetState,
  get: () => ChatState,
): void {
  const runtime = getOrCreateSessionToolRuntime(sessionId);
  for (const tool of tools) {
    setStepStatus(runtime, tool.id, tool.name, runtime.steps.get(tool.id)?.status ?? 'pending');
    runtime.unresolvedIds.add(tool.id);
  }
  syncCurrentSessionToolRuntime(set, get);
}

export function markSessionToolRunning(
  sessionId: string,
  toolCallId: string,
  label: string,
  set: ChatSetState,
  get: () => ChatState,
): void {
  const runtime = getOrCreateSessionToolRuntime(sessionId);
  setStepStatus(runtime, toolCallId, label, 'running');
  runtime.unresolvedIds.add(toolCallId);
  syncCurrentSessionToolRuntime(set, get);
}

export function markSessionToolStatus(
  sessionId: string,
  toolCallId: string,
  label: string,
  status: TaskStep['status'],
  set: ChatSetState,
  get: () => ChatState,
): void {
  const runtime = getOrCreateSessionToolRuntime(sessionId);
  setStepStatus(runtime, toolCallId, label, status);
  if (isTerminalStepStatus(status)) {
    runtime.unresolvedIds.delete(toolCallId);
  } else {
    runtime.unresolvedIds.add(toolCallId);
  }
  syncCurrentSessionToolRuntime(set, get);
}

export function setSessionToolExecutionId(
  sessionId: string,
  toolCallId: string,
  label: string,
  executionId: string | null,
  set: ChatSetState,
  get: () => ChatState,
): void {
  const runtime = getOrCreateSessionToolRuntime(sessionId);
  setStepExecutionId(runtime, toolCallId, label, executionId);
  syncCurrentSessionToolRuntime(set, get);
}

export function resolveSessionTool(
  sessionId: string,
  toolCallId: string,
  label: string,
  status: TaskStep['status'],
  result: string,
  set: ChatSetState,
  get: () => ChatState,
): void {
  const runtime = getOrCreateSessionToolRuntime(sessionId);
  setStepStatus(runtime, toolCallId, label, status);
  if (isTerminalStepStatus(status)) {
    runtime.unresolvedIds.delete(toolCallId);
  } else {
    runtime.unresolvedIds.add(toolCallId);
  }
  runtime.results.set(toolCallId, result);
  syncCurrentSessionToolRuntime(set, get);
}

export function failUnresolvedSessionTools(
  sessionId: string,
  set: ChatSetState,
  get: () => ChatState,
  resultFactory?: (toolCallId: string, label: string) => string,
): void {
  const runtime = toolRuntimeBySession.get(sessionId);
  if (!runtime) {
    syncCurrentSessionToolRuntime(set, get);
    return;
  }

  for (const toolCallId of [...runtime.unresolvedIds]) {
    const step = runtime.steps.get(toolCallId);
    const label = step?.label ?? toolCallId;
    setStepStatus(runtime, toolCallId, label, 'failed');
    if (resultFactory) {
      runtime.results.set(toolCallId, resultFactory(toolCallId, label));
    }
  }
  runtime.unresolvedIds.clear();
  syncCurrentSessionToolRuntime(set, get);
}

export function clearSessionToolRuntime(
  sessionId: string,
  set: ChatSetState,
  get: () => ChatState,
): void {
  toolRuntimeBySession.delete(sessionId);
  syncCurrentSessionToolRuntime(set, get);
}

// AUDIT-FIX [audit-1#2] — Releases runtime state for every session that is NOT
// the currently-selected one. Previously the module-level Map would only lose
// entries on explicit clear()/delete(sessionId) calls; switching sessions via
// selectSession() would clear the store-side counters but leave behind every
// non-current session's tool runtime, leaking memory and (worse) keeping stale
// task steps alive past session boundaries.
export function clearNonCurrentSessionToolRuntime(
  set: ChatSetState,
  get: () => ChatState,
): void {
  const currentSessionId = get().currentSessionId;
  for (const sessionId of [...toolRuntimeBySession.keys()]) {
    if (sessionId !== currentSessionId) {
      toolRuntimeBySession.delete(sessionId);
    }
  }
  syncCurrentSessionToolRuntime(set, get);
}

export function syncSessionToolRuntimeToCurrentSession(
  set: ChatSetState,
  get: () => ChatState,
): void {
  syncCurrentSessionToolRuntime(set, get);
}

export function resetAllSessionToolRuntime(): void {
  toolRuntimeBySession.clear();
}