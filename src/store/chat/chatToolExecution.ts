import { invoke } from '@tauri-apps/api/core';

import type { EngineEvent } from '../../core/types';
import { submitSessionToolResults } from '../../core/runtime';
import { t } from '../../i18n';
import { recordToolForReactiveCompact } from '../../services/compact/reactiveCompact';
import { StreamingToolExecutor, type ToolRequest } from '../../services/StreamingToolExecutor';
import { getCurrentAgentContext } from '../../services/multiagent/agentContext';
import { runAgentBackground, runAgentSync } from '../../services/multiagent/subagent';
import { runPostToolUseHooks, type PostHookContext } from '../../services/tools/postToolUseHooks';
import { runPreToolUseHooks } from '../../services/tools/preToolUseHooks';
import { partitionToolsByMetadata, loadToolRuntimeMetadata } from '../../services/tools/toolMetadata';
import { detectBrowserIntent } from '../../services/browser/browserIntent';
import {
  canAutoApproveTool,
  isLegacyChatOnlyTool,
  type ToolPolicyPreviewResult,
  type PermissionMode,
} from '../../services/tools/toolExecutionPolicy';
import { resolvePermissionMode, resolveSessionExecutionModeId } from '../../services/executionMode';
import type { ChatState } from '../../types/chat';
import {
  markSessionToolStatus,
  setSessionToolExecutionId,
  markSessionToolRunning,
  resolveSessionTool,
  seedSessionToolRuntime,
} from './toolRuntimeState';
import { useSettingsStore } from '@/store';
import { useUIStore } from '../uiStore';
import { coerceRenderableText } from '@/utils/coerceRenderableText';
import { normalizeQuestionnaireFields } from '@/utils/questionnaireNormalize';
import { registerArtifactsFromToolResults, type ArtifactDetectorModule, type ToolArtifactResult } from './chatArtifacts';
import { normalizeCompileTypstArgs, normalizeResumeWorkspaceToolArgs } from './chatResumeTools';
import { applyWindowsShellProfileToArgsJson } from '@/utils/windowsShellProfile';
import {
  getSessionPipiOutputDir as resolveSessionPipiOutputDirHelper,
  getSessionProjectDir as resolveSessionProjectDir,
} from '@/utils/sessionFolders';

import { emitSessionToolTrace, emitSessionToolTerminal } from './chatToolTrace';
import { mapTerminalStatusToStepStatus, resolveToolStepStatus } from './chatToolStatus';
export type { ToolTerminalStatus, ToolStepStatus } from './chatToolStatus';
export { mapTerminalStatusToStepStatus, resolveToolStepStatus };

import {
  buildPermissionContext,
  previewBackendToolPolicy,
  resolveWorkspaceToolPreflight,
  resolveSerialToolPermission,
} from './chatToolPermission';
export { resolveWorkspaceToolPreflight };
import { executeAgentTool } from './chatToolAgentExec';
import { executeConcurrentTools } from './chatToolConcurrentExec';

type ToolBatchChunk = Extract<EngineEvent, { type: 'tool_batch_request' }>;

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

/** Greppable unbound denial — keep in sync with chip hint / docs. */
export const NO_PROJECT_FOLDER_MESSAGE =
  'No Project Folder is bound. Use the Project Folder chip above the composer to bind your repo before running workspace tools (list_files, write_file, create_directory, execute_command, compile_typst_file).';

function buildNoProjectFolderToolError(toolName: string): string {
  return JSON.stringify({
    error: true,
    error_kind: 'permission_denied',
    message: NO_PROJECT_FOLDER_MESSAGE,
    tool: toolName,
    cause: NO_PROJECT_FOLDER_MESSAGE,
  });
}

export interface ToolBatchExecutionContext {
  chunk: ToolBatchChunk;
  activeSessionId: string;
  assistantMessageId: string;
  get: () => ChatState;
  set: ChatSetState;
  ensureSessionWorkDir: () => Promise<string | null>;
}

export interface ToolBatchExecutionDeps {
  uiStore: typeof useUIStore;
  createExecutor: () => Pick<StreamingToolExecutor, 'executeBatch'>;
  partitionToolsByMetadata: typeof partitionToolsByMetadata;
  runPreToolUseHooks: typeof runPreToolUseHooks;
  runPostToolUseHooks: typeof runPostToolUseHooks;
  normalizeResumeWorkspaceToolArgs: typeof normalizeResumeWorkspaceToolArgs;
  normalizeCompileTypstArgs: typeof normalizeCompileTypstArgs;
  registerArtifactsFromToolResults: typeof registerArtifactsFromToolResults;
  loadArtifactDetector: () => Promise<ArtifactDetectorModule>;
  invoke: typeof invoke;
  recordToolForReactiveCompact: typeof recordToolForReactiveCompact;
  t: typeof t;
  getCurrentAgentContext: typeof getCurrentAgentContext;
  runAgentBackground: typeof runAgentBackground;
  runAgentSync: typeof runAgentSync;
  loadSwarmModule: () => Promise<typeof import('../../services/swarm')>;
  loadInboxCoordinator: () => Promise<typeof import('../../services/swarm/inboxCoordinator')>;
  loadSwarmStore: () => Promise<typeof import('../swarmStore')>;
  loadToolRuntimeMetadata: typeof loadToolRuntimeMetadata;
}

const defaultDeps: ToolBatchExecutionDeps = {
  uiStore: useUIStore,
  createExecutor: () => new StreamingToolExecutor(300_000),
  partitionToolsByMetadata,
  loadToolRuntimeMetadata,
  runPreToolUseHooks,
  runPostToolUseHooks,
  normalizeResumeWorkspaceToolArgs,
  normalizeCompileTypstArgs,
  registerArtifactsFromToolResults,
  loadArtifactDetector: () => import('../../services/artifactDetector'),
  invoke,
  recordToolForReactiveCompact,
  t,
  getCurrentAgentContext,
  runAgentBackground,
  runAgentSync,
  loadSwarmModule: () => import('../../services/swarm'),
  loadInboxCoordinator: () => import('../../services/swarm/inboxCoordinator'),
  loadSwarmStore: () => import('../swarmStore'),
};

function buildGetCurrentWorkspaceResult(workDir: string | null): string {
  return workDir
    ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
    : JSON.stringify({ work_dir: null, message: 'No working directory bound to this session.' });
}


function prepareCancellableToolArgs(
  toolName: string,
  toolArgs: string,
  cancellable: boolean,
): { toolArgs: string; executionId: string | null } {
  if (!cancellable) {
    return { toolArgs, executionId: null };
  }

  const parsed = JSON.parse(toolArgs) as Record<string, unknown>;
  const existingExecutionId = typeof parsed.executionId === 'string' && parsed.executionId.trim().length > 0
    ? parsed.executionId
    : null;
  const executionId = existingExecutionId ?? crypto.randomUUID();

  return {
    toolArgs: JSON.stringify({
      ...parsed,
      executionId,
    }),
    executionId,
  };
}

async function executeSerialTool(
  tool: ToolRequest,
  normalizedToolArgs: string,
  activeSessionId: string,
  permissionMode: PermissionMode,
  executionModeId: string | undefined,
  workDir: string | null,
  get: () => ChatState,
  set: ChatSetState,
  deps: ToolBatchExecutionDeps,
  toolMetadataMap?: Map<string, { cancellable?: boolean }>,
  batchIdentity: { requestId?: string; turnId?: string } = {},
): Promise<ToolArtifactResult> {
  const uiStore = deps.uiStore.getState();
  const traceExtras = {
    ...(batchIdentity.requestId !== undefined ? { requestId: batchIdentity.requestId } : {}),
    ...(batchIdentity.turnId !== undefined ? { turnId: batchIdentity.turnId } : {}),
  };

  markSessionToolRunning(activeSessionId, tool.id, tool.name, set, get);
  emitSessionToolTrace(activeSessionId, 'tool_requested', { toolCallId: tool.id, ...traceExtras });
  uiStore.updateTaskStep(tool.id, 'validating');
  markSessionToolStatus(activeSessionId, tool.id, tool.name, 'validating', set, get);

  if (tool.name === 'AskUserQuestion') {
    let toolResultContent = '';
    try {
      const args = JSON.parse(normalizedToolArgs);
      toolResultContent = await uiStore.showQuestionnaire(activeSessionId, {
        toolCallId: tool.id,
        title: coerceRenderableText(args.title, 'Information Needed'),
        description: coerceRenderableText(args.description),
        fields: normalizeQuestionnaireFields(args.fields),
      });
    } catch (error) {
      toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const askStatus = toolResultContent.startsWith('Error:') ? 'failed' : 'done';
    uiStore.updateTaskStep(tool.id, askStatus);
    resolveSessionTool(
      activeSessionId,
      tool.id,
      tool.name,
      askStatus,
      toolResultContent,
      set,
      get,
    );
    emitSessionToolTerminal(activeSessionId, tool.id, askStatus, traceExtras);
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: normalizedToolArgs };
  }

  if (tool.name === 'get_current_workspace') {
    const toolResultContent = buildGetCurrentWorkspaceResult(workDir);
    uiStore.updateTaskStep(tool.id, 'done');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'done', toolResultContent, set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'done', traceExtras);
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: normalizedToolArgs };
  }

  const session = get().sessions.find((s) => s.id === activeSessionId);
  const messages = session?.messages || [];
  const lastUserMsg = messages.length > 0 ? [...messages].reverse().find((m) => m.role === 'user') : undefined;
  const allowBrowserTools = lastUserMsg ? detectBrowserIntent(lastUserMsg.content) : false;

  const hookResult = await deps.runPreToolUseHooks({
    toolName: tool.name,
    toolArgs: normalizedToolArgs,
    workDir: workDir ?? undefined,
    permissionMode,
    executionMode: executionModeId,
    sessionId: activeSessionId,
    allowBrowserTools,
  });

  let effectiveArgs = normalizedToolArgs;
  let toolResultContent = '';
  let approvalToken: string | null = null;

  if (!hookResult.approved) {
    uiStore.addNotification('error', hookResult.error || 'Tool execution blocked', activeSessionId);
    toolResultContent = `Error: ${hookResult.error || 'Tool execution blocked'}`;
    uiStore.updateTaskStep(tool.id, 'failed');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'failed', traceExtras);
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: effectiveArgs };
  }

  effectiveArgs = hookResult.modifiedArgs || normalizedToolArgs;
  let pendingExecutionId: string | null = null;
  try {
    const preparedArgs = prepareCancellableToolArgs(
      tool.name,
      effectiveArgs,
      toolMetadataMap?.get(tool.name)?.cancellable === true,
    );
    effectiveArgs = preparedArgs.toolArgs;
    pendingExecutionId = preparedArgs.executionId;
  } catch (error) {
    toolResultContent = `Error: invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`;
    uiStore.updateTaskStep(tool.id, 'failed');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'failed', traceExtras);
    return {
      id: tool.id,
      content: toolResultContent,
      toolName: tool.name,
      toolArgs: effectiveArgs,
    };
  }
  let preview: ToolPolicyPreviewResult;
  try {
    preview = await previewBackendToolPolicy(tool, effectiveArgs, activeSessionId, workDir, deps, executionModeId);
  } catch (error) {
    toolResultContent = `Error: policy preview failed: ${error instanceof Error ? error.message : String(error)}`;
    uiStore.updateTaskStep(tool.id, 'failed');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'failed', traceExtras);
    return {
      id: tool.id,
      content: toolResultContent,
      toolName: tool.name,
      toolArgs: effectiveArgs,
    };
  }

  if (preview.decision === 'rejected') {
    const message = preview.reason || `Tool "${tool.name}" was rejected by backend policy.`;
    uiStore.updateTaskStep(tool.id, 'rejected');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'rejected', `Error: ${message}`, set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'rejected', traceExtras);
    return {
      id: tool.id,
      content: `Error: ${message}`,
      toolName: tool.name,
      toolArgs: effectiveArgs,
    };
  }

  const requiresExplicitApproval = Boolean(hookResult.requiresConfirmation) || preview.decision === 'awaiting_confirmation';
  const autoApprovesWithoutPrompt = canAutoApproveTool(permissionMode, tool.name, { browserIntent: allowBrowserTools });
  if (requiresExplicitApproval && !autoApprovesWithoutPrompt) {
    uiStore.updateTaskStep(tool.id, 'awaiting_confirmation');
    markSessionToolStatus(activeSessionId, tool.id, tool.name, 'awaiting_confirmation', set, get);
  }
  if (requiresExplicitApproval) {
    approvalToken = preview.approvalToken ?? null;
  }

  const approved = await resolveSerialToolPermission(
    tool,
    effectiveArgs,
    activeSessionId,
    permissionMode,
    workDir,
    requiresExplicitApproval,
    deps,
    allowBrowserTools,
    {
      ...buildPermissionContext(tool.name, effectiveArgs, preview.reason, workDir),
      approvalToken,
    },
  );
  if (!approved) {
    uiStore.updateTaskStep(tool.id, 'rejected');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'rejected', deps.t('permission.deniedMessage'), set, get);
    emitSessionToolTerminal(activeSessionId, tool.id, 'rejected', traceExtras);
    return {
      id: tool.id,
      content: `Error: ${deps.t('permission.deniedMessage')}`,
      toolName: tool.name,
      toolArgs: effectiveArgs,
    };
  }

  if (requiresExplicitApproval && !autoApprovesWithoutPrompt) {
    uiStore.updateTaskStep(tool.id, 'approved');
    markSessionToolStatus(activeSessionId, tool.id, tool.name, 'approved', set, get);
  }

  uiStore.updateTaskStep(tool.id, 'running');
  markSessionToolStatus(activeSessionId, tool.id, tool.name, 'running', set, get);
  if (pendingExecutionId) {
    setSessionToolExecutionId(activeSessionId, tool.id, tool.name, pendingExecutionId, set, get);
  }
  emitSessionToolTrace(activeSessionId, 'tool_execution_started', {
    toolCallId: tool.id,
    executionId: pendingExecutionId,
    ...traceExtras,
  });

  let toolDidFail = false;
  let finalStatus: 'done' | 'failed' | 'cancelled' | 'timed_out' | 'rejected' = 'done';
  let nativeTerminalStatus: string | null = null;
  try {
    if (tool.name === 'agent_tool') {
      toolResultContent = await executeAgentTool(tool, effectiveArgs, activeSessionId, workDir, deps);
      toolDidFail = toolResultContent.startsWith('Error:');
    } else if (isLegacyChatOnlyTool(tool.name)) {
      toolResultContent = await deps.invoke<string>('execute_tool', {
        toolName: tool.name,
        arguments: effectiveArgs,
        workDir,
        toolCallId: tool.id,
        sessionId: activeSessionId,
        approvalToken,
        source: 'assistant_tool_call',
        executionMode: executionModeId ?? null,
      });
      toolDidFail = toolResultContent.startsWith('Error:');
    } else {
      const nativeResult = await deps.invoke<{
        content: string;
        is_error: boolean;
        status?: string;
        terminal_status?: string;
      }>('execute_single_tool', {
        toolCallId: tool.id,
        name: tool.name,
        arguments: effectiveArgs,
        workDir,
        sessionId: activeSessionId,
        source: 'assistant_tool_call',
        approvalToken,
        executionMode: executionModeId ?? null,
      });
      toolResultContent = nativeResult.content;
      toolDidFail = Boolean(nativeResult.is_error);
      nativeTerminalStatus = nativeResult.status ?? nativeResult.terminal_status ?? null;
    }
    finalStatus = resolveToolStepStatus(toolResultContent, toolDidFail, nativeTerminalStatus);
    uiStore.updateTaskStep(tool.id, finalStatus);
    resolveSessionTool(activeSessionId, tool.id, tool.name, finalStatus, toolResultContent, set, get);
  } catch (error) {
    uiStore.updateTaskStep(tool.id, 'failed');
    toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    finalStatus = 'failed';
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
  }

  emitSessionToolTerminal(activeSessionId, tool.id, finalStatus, {
    executionId: pendingExecutionId,
    ...traceExtras,
  });

  const postCtx: PostHookContext = {
    toolName: tool.name,
    toolArgs: effectiveArgs,
    result: toolResultContent,
    isError: finalStatus === 'failed' || finalStatus === 'cancelled' || finalStatus === 'timed_out' || toolResultContent.startsWith('Error:'),
    sessionId: activeSessionId,
  };
  void deps.runPostToolUseHooks(postCtx).catch((error: unknown) => {
    console.warn('[PostToolUseHooks] Error:', error);
  });
  deps.recordToolForReactiveCompact(activeSessionId, tool.id, tool.name, toolResultContent);

  return {
    id: tool.id,
    content: toolResultContent,
    toolName: tool.name,
    toolArgs: effectiveArgs,
  };
}

export async function handleToolBatchRequest(
  context: ToolBatchExecutionContext,
  deps: ToolBatchExecutionDeps = defaultDeps,
): Promise<ToolArtifactResult[]> {
  const { chunk, activeSessionId, assistantMessageId, get, set, ensureSessionWorkDir } = context;
  const uiStore = deps.uiStore.getState();
  let currentSession = get().sessions.find((session) => session.id === activeSessionId);
  let workDir = resolveSessionProjectDir(currentSession) ?? null;
  const executionModeId = resolveSessionExecutionModeId(currentSession);
  const permissionMode = resolvePermissionMode(executionModeId);
  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
  const blockedWorkspaceToolIds = new Set<string>();
  const preBlockedResults: ToolArtifactResult[] = [];

  let toolMetadataMap: Map<string, { requiresWorkspace?: boolean; cancellable?: boolean }> | undefined;
  try {
    toolMetadataMap = await deps.loadToolRuntimeMetadata();
  } catch (error) {
    // Fail closed: Rust metadata unavailable — block workspace-critical batch
    // with an explicit error rather than consulting a TS fallback catalog.
    const message = `Tool runtime metadata unavailable: ${error instanceof Error ? error.message : String(error)}`;
    const metaFailExtras = {
      requestId: chunk.requestId,
      ...(chunk.turnId !== undefined ? { turnId: chunk.turnId } : {}),
    };
    for (const tool of chunk.tools) {
      const errorContent = JSON.stringify({
        error: true,
        error_kind: 'metadata_unavailable',
        message,
        tool: tool.name,
        cause: message,
      });
      markSessionToolRunning(activeSessionId, tool.id, tool.name, set, get);
      emitSessionToolTrace(activeSessionId, 'tool_requested', {
        toolCallId: tool.id,
        ...metaFailExtras,
      });
      uiStore.updateTaskStep(tool.id, 'failed');
      markSessionToolStatus(activeSessionId, tool.id, tool.name, 'failed', set, get);
      resolveSessionTool(
        activeSessionId,
        tool.id,
        tool.name,
        'failed',
        errorContent,
        set,
        get,
      );
      emitSessionToolTrace(activeSessionId, 'tool_completed', {
        toolCallId: tool.id,
        reason: 'metadata_unavailable',
        ...metaFailExtras,
      });
      preBlockedResults.push({
        id: tool.id,
        content: errorContent,
        toolName: tool.name,
        toolArgs: tool.arguments,
      });
    }
    const mergedResults = [...preBlockedResults];
    if (typeof (chunk as any)?._resolveAll === 'function') {
      (chunk as any)._resolveAll(mergedResults.map(({ id, content }) => ({ id, content })));
    }
    submitSessionToolResults(
      activeSessionId,
      chunk.requestId,
      mergedResults.map(({ id, content }) => ({ id, content })),
      chunk.turnId,
    );
    return mergedResults;
  }

  {
    const needsWorkDir = chunk.tools.some((tool) => toolMetadataMap.get(tool.name)?.requiresWorkspace);
    let ensureResult: string | null = null;
    if (!workDir && needsWorkDir) {
      ensureResult = await ensureSessionWorkDir();
      currentSession = get().sessions.find((session) => session.id === activeSessionId);
      workDir = resolveSessionProjectDir(currentSession) ?? null;
    }

    const sessionPipiOutputDir = resolveSessionPipiOutputDirHelper(currentSession);
    const preflight = resolveWorkspaceToolPreflight({
      projectDir: workDir,
      pipiOutputDir: sessionPipiOutputDir,
      ensureResult,
      toolNames: chunk.tools.map((tool) => tool.name),
      toolMetadataMap,
    });
    workDir = preflight.workDir;

    if (preflight.blockWorkspaceTools) {
      for (const tool of chunk.tools) {
        if (!toolMetadataMap.get(tool.name)?.requiresWorkspace) continue;
        const errorContent = buildNoProjectFolderToolError(tool.name);
        blockedWorkspaceToolIds.add(tool.id);
        markSessionToolRunning(activeSessionId, tool.id, tool.name, set, get);
        uiStore.updateTaskStep(tool.id, 'failed');
        markSessionToolStatus(activeSessionId, tool.id, tool.name, 'failed', set, get);
        resolveSessionTool(
          activeSessionId,
          tool.id,
          tool.name,
          'failed',
          errorContent,
          set,
          get,
        );
        preBlockedResults.push({
          id: tool.id,
          content: errorContent,
          toolName: tool.name,
          toolArgs: tool.arguments,
        });
      }
    }
  }

  for (const tool of chunk.tools) {
    if (tool.name === 'Skill' || tool.name === 'skill' || tool.name === 'execute_skill') {
      try {
        const args = JSON.parse(tool.arguments);
        if (args.skill) {
          uiStore.setActiveSkill(args.skill);
        }
      } catch {
        // ignore malformed skill args and keep executing
      }
    }
  }

  const executableTools = chunk.tools.filter((tool) => !blockedWorkspaceToolIds.has(tool.id));
  seedSessionToolRuntime(activeSessionId, executableTools, set, get);

  const projectFolderForNormalization = workDir ?? resolveSessionProjectDir(currentSession);
  const normalizedToolArgsById = new Map<string, string>();
  for (const tool of executableTools) {
    let normalizedArgs = deps.normalizeResumeWorkspaceToolArgs(
      tool.name,
      tool.arguments,
      projectFolderForNormalization,
      uiStore.activeSkill,
    );

    if (tool.name === 'compile_typst_file') {
      normalizedArgs = await deps.normalizeCompileTypstArgs(normalizedArgs, projectFolderForNormalization);
    }

    normalizedArgs = applyWindowsShellProfileToArgsJson(tool.name, normalizedArgs, windowsShellProfile);
    normalizedToolArgsById.set(tool.id, normalizedArgs);
  }

  const toolRequests: ToolRequest[] = executableTools.map((tool) => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(normalizedToolArgsById.get(tool.id) ?? tool.arguments) as Record<string, unknown>;
    } catch {
      parsedArgs = {};
    }
    return { id: tool.id, name: tool.name, arguments: parsedArgs };
  });

  const { concurrent, serial } = await deps.partitionToolsByMetadata(toolRequests);
  const serialIds = new Set(serial.map((tool) => tool.id));
  const allResults: ToolArtifactResult[] = [];

  const batchIdentity = {
    requestId: chunk.requestId,
    ...(chunk.turnId !== undefined ? { turnId: chunk.turnId } : {}),
  };

  if (concurrent.length > 0) {
    allResults.push(...(await executeConcurrentTools(
      concurrent,
      normalizedToolArgsById,
      activeSessionId,
      permissionMode,
      executionModeId,
      workDir,
      get,
      set,
      deps,
      batchIdentity,
    )));
  }

  for (const tool of executableTools) {
    if (!serialIds.has(tool.id)) {
      continue;
    }
    allResults.push(
      await executeSerialTool(
        { id: tool.id, name: tool.name, arguments: {} },
        normalizedToolArgsById.get(tool.id) ?? tool.arguments,
        activeSessionId,
        permissionMode,
        executionModeId,
        workDir,
        get,
        set,
        deps,
        toolMetadataMap,
        batchIdentity,
      ),
    );
  }

  try {
    const sessionForArtifacts = get().sessions.find((session) => session.id === activeSessionId);
    const pipiOutputDir = resolveSessionPipiOutputDirHelper(sessionForArtifacts);
    await deps.registerArtifactsFromToolResults(
      deps.loadArtifactDetector,
      assistantMessageId,
      allResults,
      workDir,
      pipiOutputDir,
    );
  } catch {
    // artifact detection is best-effort
  }

  const mergedResults = [...preBlockedResults, ...allResults];
  if (typeof (chunk as any)?._resolveAll === 'function') {
    (chunk as any)._resolveAll(mergedResults.map(({ id, content }) => ({ id, content })));
  }
  const accepted = submitSessionToolResults(
    activeSessionId,
    chunk.requestId,
    mergedResults.map(({ id, content }) => ({ id, content })),
    chunk.turnId,
  );
  if (!accepted) {
    // tool_result_discarded is recorded by submitSessionToolResults (shared sink)
    // when the runtime is already gone; tombstone discards use the channel sink.
    console.warn('[ChatToolExecution] Session runtime was released before tool results were submitted', {
      activeSessionId,
      requestId: chunk.requestId,
    });
  }
  return mergedResults;
}
