import { invoke } from '@tauri-apps/api/core';

import type { EngineEvent } from '../../core/types';
import { t } from '../../i18n';
import { recordToolForReactiveCompact } from '../../services/compact/reactiveCompact';
import { StreamingToolExecutor, partitionTools, type ToolRequest } from '../../services/StreamingToolExecutor';
import { getCurrentAgentContext } from '../../services/multiagent/agentContext';
import { runAgentBackground, runAgentSync } from '../../services/multiagent/subagent';
import { runPostToolUseHooks, type PostHookContext } from '../../services/tools/postToolUseHooks';
import { runPreToolUseHooks } from '../../services/tools/preToolUseHooks';
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
import { createToolTaskSteps } from '../taskLifecycle';
import { coerceRenderableText } from '@/utils/coerceRenderableText';
import { normalizeQuestionnaireFields } from '@/utils/questionnaireNormalize';
import { registerArtifactsFromToolResults, type ArtifactDetectorModule, type ToolArtifactResult } from './chatArtifacts';
import { normalizeCompileTypstArgs, normalizeResumeWorkspaceToolArgs } from './chatResumeTools';
import { applyWindowsShellProfileToArgsJson } from '@/utils/windowsShellProfile';
import {
  getSessionPipiOutputDir as resolveSessionPipiOutputDirHelper,
  getSessionProjectDir as resolveSessionProjectDir,
} from '@/utils/sessionFolders';

type ToolBatchChunk = Extract<EngineEvent, { type: 'tool_batch_request' }>;

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

const WORKSPACE_TOOL_NAMES = new Set([
  'get_current_workspace',
  'write_file',
  'create_directory',
  'execute_command',
  'compile_typst_file',
  'render_typst_to_pdf',
]);

const CANCELLABLE_TOOL_NAMES = new Set(['execute_command', 'ssh_exec']);

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
  partitionTools: typeof partitionTools;
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
}

const defaultDeps: ToolBatchExecutionDeps = {
  uiStore: useUIStore,
  createExecutor: () => new StreamingToolExecutor(),
  partitionTools,
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

function buildPermissionContext(
  toolName: string,
  toolArgs: string,
  reason?: string,
  workDir?: string | null,
) {
  let commandPreview: string | null = null;

  try {
    const parsed = JSON.parse(toolArgs) as Record<string, unknown>;
    if (typeof parsed.command === 'string') {
      commandPreview = parsed.command;
    }
  } catch {
    commandPreview = null;
  }

  const normalizedReason = reason ? coerceRenderableText(reason) : null;

  return {
    description: normalizedReason || `Approve execution for ${toolName}?`,
    source: 'assistant_tool_call',
    workingDirectory: workDir,
    commandPreview,
    riskReason: normalizedReason,
  };
}

function buildGetCurrentWorkspaceResult(workDir: string | null): string {
  return workDir
    ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
    : JSON.stringify({ work_dir: null, message: 'No working directory bound to this session.' });
}

function resolveToolStepStatus(
  content: string,
  fallbackFailed: boolean,
): 'done' | 'failed' | 'cancelled' | 'timed_out' | 'rejected' {
  try {
    const parsed = JSON.parse(content) as { status?: string; error_kind?: string };
    if (parsed.status === 'cancelled') {
      return 'cancelled';
    }
    if (parsed.status === 'timed_out') {
      return 'timed_out';
    }
    if (parsed.error_kind === 'permission_denied') {
      return 'rejected';
    }
  } catch {
    // Keep legacy fallback for plain-text tool results.
  }

  return fallbackFailed ? 'failed' : 'done';
}

async function previewBackendToolPolicy(
  tool: ToolRequest,
  effectiveArgs: string,
  activeSessionId: string,
  workDir: string | null,
  deps: ToolBatchExecutionDeps,
  executionModeId?: string,
): Promise<ToolPolicyPreviewResult> {
  return deps.invoke<ToolPolicyPreviewResult>('preview_tool_policy', {
    toolCall: {
      id: tool.id,
      name: tool.name,
      arguments: effectiveArgs,
      workDir,
      source: 'assistant_tool_call',
      approvalToken: null,
      executionMode: executionModeId ?? null,
    },
    sessionId: activeSessionId,
  });
}

function prepareCancellableToolArgs(
  toolName: string,
  toolArgs: string,
): { toolArgs: string; executionId: string | null } {
  if (!CANCELLABLE_TOOL_NAMES.has(toolName)) {
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

async function executeConcurrentTools(
  concurrent: ToolRequest[],
  normalizedToolArgsById: Map<string, string>,
  activeSessionId: string,
  permissionMode: PermissionMode,
  executionModeId: string | undefined,
  workDir: string | null,
  get: () => ChatState,
  set: ChatSetState,
  deps: ToolBatchExecutionDeps,
): Promise<ToolArtifactResult[]> {
  const uiStore = deps.uiStore.getState();
  const executableConcurrent: ToolRequest[] = [];
  const blockedResults: ToolArtifactResult[] = [];
  const sessionForIntent = get().sessions.find((s) => s.id === activeSessionId);
  const messagesForIntent = sessionForIntent?.messages || [];
  const lastUserMsgForIntent = messagesForIntent.length > 0
    ? [...messagesForIntent].reverse().find((m) => m.role === 'user')
    : undefined;
  const allowBrowserTools = lastUserMsgForIntent
    ? detectBrowserIntent(lastUserMsgForIntent.content)
    : false;

  for (const req of concurrent) {
    markSessionToolRunning(activeSessionId, req.id, req.name, set, get);
    uiStore.updateTaskStep(req.id, 'validating');
    markSessionToolStatus(activeSessionId, req.id, req.name, 'validating', set, get);

    const hookResult = await deps.runPreToolUseHooks({
      toolName: req.name,
      toolArgs: normalizedToolArgsById.get(req.id) ?? JSON.stringify(req.arguments),
      workDir: workDir ?? undefined,
      permissionMode,
      executionMode: executionModeId,
      sessionId: activeSessionId,
      allowBrowserTools,
    });

    if (!hookResult.approved) {
      const message = hookResult.error || 'Tool execution blocked';

      uiStore.addNotification('error', message, activeSessionId);
      uiStore.updateTaskStep(req.id, 'failed');
      resolveSessionTool(
        activeSessionId,
        req.id,
        req.name,
        'failed',
        `Error: ${message}`,
        set,
        get,
      );
      blockedResults.push({
        id: req.id,
        content: `Error: ${message}`,
        toolName: req.name,
        toolArgs: normalizedToolArgsById.get(req.id) ?? '{}',
      });
      continue;
    }

    const effectiveArgs = hookResult.modifiedArgs ?? normalizedToolArgsById.get(req.id) ?? JSON.stringify(req.arguments);
    normalizedToolArgsById.set(req.id, effectiveArgs);
    try {
      executableConcurrent.push({
        id: req.id,
        name: req.name,
        arguments: JSON.parse(effectiveArgs) as Record<string, unknown>,
      });
    } catch {
      uiStore.addNotification('error', `Invalid tool arguments for ${req.name}`, activeSessionId);
      uiStore.updateTaskStep(req.id, 'failed');
      resolveSessionTool(
        activeSessionId,
        req.id,
        req.name,
        'failed',
        'Error: invalid tool arguments',
        set,
        get,
      );
      blockedResults.push({
        id: req.id,
        content: 'Error: invalid tool arguments',
        toolName: req.name,
        toolArgs: effectiveArgs,
      });
    }
  }

  if (executableConcurrent.length === 0) {
    return blockedResults;
  }

  try {
    const batchResult = await deps.createExecutor().executeBatch(executableConcurrent, {
      sessionId: activeSessionId,
      workDir: workDir ?? undefined,
      source: 'assistant_tool_call',
      permissionMode,
      executionMode: executionModeId,
      browserIntent: allowBrowserTools,
      requestPermission: async (request) => {
        // Bypass: auto-approve normal project-scoped tools without
        // showing the permission modal. Hard safety blocks still
        // happen upstream via preToolUseHooks, and the backend
        // `rejected` decision already short-circuits before this
        // callback fires. SSH / browser / MCP tools still fall
        // through to the modal because canAutoApproveTool returns
        // false for them.
        if (permissionMode === 'bypass' && canAutoApproveTool(permissionMode, request.name, { browserIntent: allowBrowserTools })) {
          return true;
        }
        uiStore.updateTaskStep(request.id, 'awaiting_confirmation');
        markSessionToolStatus(activeSessionId, request.id, request.name, 'awaiting_confirmation', set, get);
        const approved = await uiStore.waitForPermission({
          id: request.id,
          name: request.name,
          arguments: request.arguments,
          ...buildPermissionContext(request.name, request.arguments, request.reason, request.workDir),
          approvalToken: request.approvalToken ?? null,
        });
        if (approved) {
          uiStore.updateTaskStep(request.id, 'approved');
          markSessionToolStatus(activeSessionId, request.id, request.name, 'approved', set, get);
        } else {
          uiStore.updateTaskStep(request.id, 'rejected');
          markSessionToolStatus(activeSessionId, request.id, request.name, 'rejected', set, get);
        }
        return approved;
      },
    });

    return [
      ...blockedResults,
      ...batchResult.results.map((result) => {
        const req = executableConcurrent.find((candidate) => candidate.id === result.id);
        if (req) {
          const finalStatus = resolveToolStepStatus(result.content, result.is_error);
          resolveSessionTool(
            activeSessionId,
            result.id,
            req.name,
            finalStatus,
            result.content,
            set,
            get,
          );
          uiStore.updateTaskStep(result.id, finalStatus);
        }
        if (req) {
          const postCtx: PostHookContext = {
            toolName: req.name,
            toolArgs: normalizedToolArgsById.get(result.id) ?? '{}',
            result: result.content,
            isError: result.is_error,
            sessionId: activeSessionId,
          };
          void deps.runPostToolUseHooks(postCtx).catch((error: unknown) => {
            console.warn('[PostToolUseHooks]', error);
          });
          deps.recordToolForReactiveCompact(activeSessionId, result.id, req.name, result.content);
        }

        return {
          id: result.id,
          content: result.content,
          toolName: req?.name,
          toolArgs: normalizedToolArgsById.get(result.id) ?? '{}',
        };
      }),
    ];
  } catch (error) {
    return [
      ...blockedResults,
      ...executableConcurrent.map((req) => {
        resolveSessionTool(
          activeSessionId,
          req.id,
          req.name,
          'failed',
          `Error: batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
          set,
          get,
        );
        deps.uiStore.getState().updateTaskStep(req.id, 'failed');
        return {
          id: req.id,
          content: `Error: batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
          toolName: req.name,
          toolArgs: normalizedToolArgsById.get(req.id) ?? '{}',
        };
      }),
    ];
  }
}

async function resolveSerialToolPermission(
  tool: ToolRequest,
  effectiveArgs: string,
  activeSessionId: string,
  permissionMode: PermissionMode,
  workDir: string | null,
  requiresConfirmation: boolean,
  deps: ToolBatchExecutionDeps,
  browserIntent = false,
  permissionContext?: {
    description?: string;
    source?: string;
    workingDirectory?: string | null;
    commandPreview?: string | null;
    riskReason?: string | null;
    approvalToken?: string | null;
  },
): Promise<boolean> {
  // Bypass auto-approves normal project-scoped tools even when the
  // backend preview asks for confirmation (e.g. `curl` in a benign
  // command). The hard safety hooks (dangerous-command,
  // path-validation) have already run before we get here, so we know
  // the request isn't a critical destructive command or an
  // out-of-project write. We only fall through to the UI prompt for
  // SSH / browser / MCP tools which `canAutoApproveTool` still
  // rejects, and for tools that the policy preview explicitly
  // rejected (caller already handled `rejected` separately).
  if (permissionMode === 'bypass') {
    if (canAutoApproveTool(permissionMode, tool.name, { browserIntent })) {
      return true;
    }
    // SSH / browser / MCP fall through to the user-facing modal —
    // they keep their existing confirmation gate even in Bypass.
  }

  if (!requiresConfirmation && canAutoApproveTool(permissionMode, tool.name, { browserIntent })) {
    return true;
  }

  if (tool.name !== 'agent_tool') {
    return deps.uiStore.getState().waitForPermission({
      id: tool.id,
      name: tool.name,
      arguments: effectiveArgs,
      description: permissionContext?.description,
      source: permissionContext?.source,
      workingDirectory: permissionContext?.workingDirectory,
      commandPreview: permissionContext?.commandPreview,
      riskReason: permissionContext?.riskReason,
      approvalToken: permissionContext?.approvalToken,
    });
  }

  let parsedAgentArgs: Record<string, unknown> | null = null;
  try {
    parsedAgentArgs = JSON.parse(effectiveArgs) as Record<string, unknown>;
  } catch {
    parsedAgentArgs = null;
  }

  const isSwarmTeammateRequest = Boolean(parsedAgentArgs?.team_name && parsedAgentArgs?.name);
  if (!isSwarmTeammateRequest || !parsedAgentArgs) {
    return deps.uiStore.getState().waitForPermission({
      id: tool.id,
      name: tool.name,
      arguments: effectiveArgs,
      description: permissionContext?.description,
      source: permissionContext?.source,
      workingDirectory: permissionContext?.workingDirectory,
      commandPreview: permissionContext?.commandPreview,
      riskReason: permissionContext?.riskReason,
      approvalToken: permissionContext?.approvalToken,
    });
  }

  const swarm = await deps.loadSwarmModule();
  const parentCtx = deps.getCurrentAgentContext() || {
    agentId: 'main',
    sessionId: activeSessionId,
    workDir: workDir || undefined,
    toolPool: [],
    metadata: {},
  };
  const swarmProjectRoot = parentCtx.workDir || workDir || undefined;
  const { useSwarmStore } = await deps.loadSwarmStore();
  useSwarmStore.getState().init();
  let activeRun = swarm.getActiveRunForChatSession(activeSessionId);
  if (!activeRun) {
    activeRun = swarm.startRun(activeSessionId);
  }
  let runtimeTeam = swarm.getTeamByName(String(parsedAgentArgs.team_name));
  if (!runtimeTeam) {
    runtimeTeam = (
      await swarm.createTeam({
        name: String(parsedAgentArgs.team_name),
        sessionId: activeSessionId,
        description: String(parsedAgentArgs.description || `Team ${String(parsedAgentArgs.team_name)}`),
        leaderName: 'leader',
        projectRoot: swarmProjectRoot,
      })
    ).team;
  }
  const { agent: runtimeAgent } = await swarm.spawnAgent({
    teamId: runtimeTeam.id,
    name: String(parsedAgentArgs.name),
    role: 'member',
    sessionId: activeSessionId,
    parentAgentId: parentCtx.agentId,
    model: typeof parsedAgentArgs.model === 'string' ? parsedAgentArgs.model : undefined,
    projectRoot: swarmProjectRoot,
  });

  const approved = await swarm.enqueuePermissionInUI({
    teamId: runtimeTeam.id,
    agentId: runtimeAgent.id,
    agentName: String(parsedAgentArgs.name),
    toolName: tool.name,
    toolArgs: effectiveArgs,
  });

  if (!approved) {
    swarm.failAgent(runtimeAgent.id, deps.t('permission.deniedMessage'));
    swarm.reconcileRunForChatSession(activeSessionId);
  }

  return approved;
}

async function executeAgentTool(
  _tool: ToolRequest,
  effectiveArgs: string,
  activeSessionId: string,
  workDir: string | null,
  deps: ToolBatchExecutionDeps,
): Promise<string> {
  let args: Record<string, any>;
  try {
    args = JSON.parse(effectiveArgs);
  } catch (error) {
    deps.uiStore.getState().addNotification('error', 'Invalid agent tool arguments', activeSessionId);
    return `Error: Failed to parse agent_tool arguments: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (args.team_name && args.name) {
    const swarm = await deps.loadSwarmModule();
    const { onAgentStarted, onTeamCreated } = await deps.loadInboxCoordinator();
    const parentCtx = deps.getCurrentAgentContext() || {
      agentId: 'main',
      sessionId: activeSessionId,
      workDir: workDir || undefined,
      toolPool: [],
      metadata: {},
    };
    const swarmProjectRoot = parentCtx.workDir || workDir || undefined;
    const { useSwarmStore } = await deps.loadSwarmStore();
    useSwarmStore.getState().init();
    let activeRun = swarm.getActiveRunForChatSession(activeSessionId);
    if (!activeRun) {
      activeRun = swarm.startRun(activeSessionId);
    }

    let runtimeTeam = swarm.getTeamByName(args.team_name);
    let teamId: string;
    let leaderId: string;
    if (!runtimeTeam) {
      const created = await swarm.createTeam({
        name: args.team_name,
        sessionId: activeSessionId,
        description: args.description || `Team ${args.team_name}`,
        leaderName: 'leader',
        projectRoot: swarmProjectRoot,
      });
      teamId = created.team.id;
      leaderId = created.leader.id;
      onTeamCreated(teamId, leaderId);
    } else {
      teamId = runtimeTeam.id;
      leaderId = runtimeTeam.leaderId;
    }

    const { agent: runtimeAgent } = await swarm.spawnAgent({
      teamId,
      name: args.name,
      role: 'member',
      sessionId: activeSessionId,
      parentAgentId: parentCtx.agentId,
      model: args.model,
      projectRoot: swarmProjectRoot,
    });
    const runtimeTask = swarm.createTask({
      teamId,
      type: 'general',
      description: args.prompt,
      assignedAgentId: runtimeAgent.id,
    });
    swarm.startAgent(runtimeAgent.id, runtimeTask.id);
    swarm.startTask(runtimeTask.id);
    onAgentStarted(runtimeAgent.id);
    swarm.recordUserPrompt(runtimeAgent.id, args.prompt, runtimeTask.id);
    const bgAgentId = await deps.runAgentBackground({
      name: args.name,
      prompt: args.prompt,
      description: args.description || `Teammate ${args.name}`,
      sessionId: activeSessionId,
      parentContext: {
        ...parentCtx,
        agentId: runtimeAgent.id,
        teamName: args.team_name,
        name: args.name,
      },
      runInBackground: true,
      model: args.model,
    });
    runtimeAgent._bgAgentId = bgAgentId;
    return `Teammate ${args.name} spawned in team ${args.team_name} (runtime ID: ${runtimeAgent.id}). Task assigned: ${runtimeTask.id}`;
  }

  if (args.run_in_background) {
    const agentId = await deps.runAgentBackground({
      name: args.name || 'background-agent',
      prompt: args.prompt,
      description: args.description || 'Background agent task',
      sessionId: activeSessionId,
      parentContext: deps.getCurrentAgentContext() || {
        agentId: 'main',
        sessionId: activeSessionId,
        workDir: workDir || undefined,
        toolPool: [],
        metadata: {},
      },
      runInBackground: true,
      model: args.model,
    });
    return `Background agent started with ID: ${agentId}. Results will be delivered via task notification.`;
  }

  const result = await deps.runAgentSync({
    name: args.name || 'subagent',
    prompt: args.prompt,
    description: args.description || 'Subagent task',
    sessionId: activeSessionId,
    parentContext: deps.getCurrentAgentContext() || {
      agentId: 'main',
      sessionId: activeSessionId,
      workDir: workDir || undefined,
      toolPool: [],
      metadata: {},
    },
    model: args.model,
  });

  return result.success ? result.content : `Error: ${result.error}`;
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
): Promise<ToolArtifactResult> {
  const uiStore = deps.uiStore.getState();

  markSessionToolRunning(activeSessionId, tool.id, tool.name, set, get);
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
    uiStore.updateTaskStep(tool.id, toolResultContent.startsWith('Error:') ? 'failed' : 'done');
    resolveSessionTool(
      activeSessionId,
      tool.id,
      tool.name,
      toolResultContent.startsWith('Error:') ? 'failed' : 'done',
      toolResultContent,
      set,
      get,
    );
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: normalizedToolArgs };
  }

  if (tool.name === 'get_current_workspace') {
    const toolResultContent = buildGetCurrentWorkspaceResult(workDir);
    uiStore.updateTaskStep(tool.id, 'done');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'done', toolResultContent, set, get);
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
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: effectiveArgs };
  }

  effectiveArgs = hookResult.modifiedArgs || normalizedToolArgs;
  let pendingExecutionId: string | null = null;
  try {
    const preparedArgs = prepareCancellableToolArgs(tool.name, effectiveArgs);
    effectiveArgs = preparedArgs.toolArgs;
    pendingExecutionId = preparedArgs.executionId;
  } catch (error) {
    toolResultContent = `Error: invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`;
    uiStore.updateTaskStep(tool.id, 'failed');
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
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

  let toolDidFail = false;
  let finalStatus: 'done' | 'failed' | 'cancelled' | 'timed_out' | 'rejected' = 'done';
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
    }
    finalStatus = resolveToolStepStatus(toolResultContent, toolDidFail);
    uiStore.updateTaskStep(tool.id, finalStatus);
    resolveSessionTool(activeSessionId, tool.id, tool.name, finalStatus, toolResultContent, set, get);
  } catch (error) {
    uiStore.updateTaskStep(tool.id, 'failed');
    toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    finalStatus = 'failed';
    resolveSessionTool(activeSessionId, tool.id, tool.name, 'failed', toolResultContent, set, get);
  }

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
  // Two-folder model: the tool cwd is the **Project Folder** — the
  // folder tools (bash, read/write/list/...) run against. We resolve
  // it via `getSessionProjectDir(session)` which prefers the new
  // `projectDir` column and falls back to the legacy `workDir`
  // mirror. Raw `session.workDir` reads are wrong in the two-folder
  // world — `workDir` is only a backwards-compat mirror of
  // `projectDir`, never the canonical source.
  //
  // We do NOT fall back to the PiPi Output Folder when the Project
  // Folder is missing: tools that mutate project state have no
  // meaning in the app-owned output root, and silently using the PiPi
  // Output Folder as the tool cwd would let the model "edit"
  // `.pipi-shrimp/...` files it considers source code.
  //
  // The legacy `ensureSessionWorkDir()` helper used to paper over
  // this by returning whichever single folder the session had bound;
  // in the two-folder world that helper now provisions the **PiPi
  // Output Folder**. We use it only as a backstop: if it returns a
  // path that equals the session's `pipiOutputDir` we discard the
  // result and surface a hard error so the model can prompt the user
  // to bind a Project Folder. Otherwise the helper is treated as a
  // no-op.
  let workDir = resolveSessionProjectDir(currentSession) ?? null;
  const executionModeId = resolveSessionExecutionModeId(currentSession);
  const permissionMode = resolvePermissionMode(executionModeId);
  // Mirror the 5-mode execution mode id into the hook context so the
  // preToolUseHooks.executionModeGuardCheck can enforce mode-specific
  // policy. Falls back to legacy PermissionMode behavior when the
  // session was created before the 5-mode system shipped.
  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;

  if (!workDir) {
    const needsWorkDir = chunk.tools.some((tool) => WORKSPACE_TOOL_NAMES.has(tool.name));
    if (needsWorkDir) {
      const fallback = await ensureSessionWorkDir();
      currentSession = get().sessions.find((session) => session.id === activeSessionId);
      const sessionPipiOutputDir = resolveSessionPipiOutputDirHelper(currentSession);
      // Reject the fallback if it landed on the PiPi Output Folder —
      // tools that mutate project state have no business running
      // inside the app-owned output root.
      if (fallback && sessionPipiOutputDir && fallback === sessionPipiOutputDir) {
        const errorMessage = 'No Project Folder is bound to this session. Set a Project Folder (the user\'s repo) before running workspace tools like write_file, create_directory, execute_command, or compile_typst_file.';
        for (const tool of chunk.tools) {
          if (!WORKSPACE_TOOL_NAMES.has(tool.name)) continue;
          markSessionToolRunning(activeSessionId, tool.id, tool.name, set, get);
          uiStore.updateTaskStep(tool.id, 'failed');
          markSessionToolStatus(activeSessionId, tool.id, tool.name, 'failed', set, get);
          resolveSessionTool(
            activeSessionId,
            tool.id,
            tool.name,
            'failed',
            // AUDIT: keep the message English; localized copy lives in
            // the chat input toast that fires on bind, not in tool
            // results (the model needs a deterministic string to react
            // to).
            errorMessage,
            set,
            get,
          );
        }
        // Surface the error to the model via the batch result so it
        // can prompt the user to bind a Project Folder before retrying.
        const blockedResults = chunk.tools
          .filter((tool) => WORKSPACE_TOOL_NAMES.has(tool.name))
          .map((tool) => ({
            id: tool.id,
            content: errorMessage,
            toolName: tool.name,
            toolArgs: tool.arguments,
          }));
        chunk._resolveAll(blockedResults.map(({ id, content }) => ({ id, content })));
        return blockedResults;
      }
      workDir = fallback ?? workDir;
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

  seedSessionToolRuntime(activeSessionId, chunk.tools, set, get);
  uiStore.setTaskProgress(createToolTaskSteps(chunk.tools));

  // Always resolve the normalization cwd through the canonical helper
  // so a session that only has `workDir` (legacy mirror) still picks
  // up the right folder. We never use the raw `currentSession.workDir`
  // directly here — that was the bug.
  const projectFolderForNormalization = workDir ?? resolveSessionProjectDir(currentSession);
  const normalizedToolArgsById = new Map<string, string>();
  for (const tool of chunk.tools) {
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

  const toolRequests: ToolRequest[] = chunk.tools.map((tool) => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(normalizedToolArgsById.get(tool.id) ?? tool.arguments) as Record<string, unknown>;
    } catch {
      parsedArgs = {};
    }
    return { id: tool.id, name: tool.name, arguments: parsedArgs };
  });

  const { concurrent, serial } = deps.partitionTools(toolRequests);
  const serialIds = new Set(serial.map((tool) => tool.id));
  const allResults: ToolArtifactResult[] = [];

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
    )));
  }

  for (const tool of chunk.tools) {
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

  chunk._resolveAll(allResults.map(({ id, content }) => ({ id, content })));
  return allResults;
}
