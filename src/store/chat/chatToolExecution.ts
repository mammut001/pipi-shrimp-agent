import { invoke } from '@tauri-apps/api/core';

import type { EngineEvent } from '../../core/types';
import { t } from '../../i18n';
import { recordToolForReactiveCompact } from '../../services/compact/reactiveCompact';
import { StreamingToolExecutor, partitionTools, type BatchExecutionResult, type ToolRequest } from '../../services/StreamingToolExecutor';
import { getCurrentAgentContext } from '../../services/multiagent/agentContext';
import { runAgentBackground, runAgentSync } from '../../services/multiagent/subagent';
import { runPostToolUseHooks, type PostHookContext } from '../../services/tools/postToolUseHooks';
import { runPreToolUseHooks } from '../../services/tools/preToolUseHooks';
import type { ChatState } from '../../types/chat';
import { useUIStore } from '../uiStore';
import { createToolTaskSteps } from '../taskLifecycle';
import { registerArtifactsFromToolResults, type ArtifactDetectorModule, type ToolArtifactResult } from './chatArtifacts';
import { normalizeCompileTypstArgs, normalizeResumeWorkspaceToolArgs } from './chatResumeTools';

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

async function executeConcurrentTools(
  concurrent: ToolRequest[],
  normalizedToolArgsById: Map<string, string>,
  activeSessionId: string,
  workDir: string | null,
  deps: ToolBatchExecutionDeps,
): Promise<ToolArtifactResult[]> {
  const uiStore = deps.uiStore.getState();
  for (const req of concurrent) {
    uiStore.updateTaskStep(req.id, 'running');
  }

  try {
    const batchResult = await deps.createExecutor().executeBatch(concurrent, {
      sessionId: activeSessionId,
      workDir: workDir ?? undefined,
    });

    return batchResult.results.map((result) => {
      const req = concurrent.find((candidate) => candidate.id === result.id);
      uiStore.updateTaskStep(result.id, result.is_error ? 'failed' : 'done');
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
    });
  } catch (error) {
    return concurrent.map((req) => {
      deps.uiStore.getState().updateTaskStep(req.id, 'failed');
      return {
        id: req.id,
        content: `Error: batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
        toolName: req.name,
        toolArgs: normalizedToolArgsById.get(req.id) ?? '{}',
      };
    });
  }
}

async function resolveSerialToolPermission(
  tool: ToolRequest,
  effectiveArgs: string,
  activeSessionId: string,
  permissionMode: 'standard' | 'auto-edits' | 'bypass' | 'plan-only',
  workDir: string | null,
  deps: ToolBatchExecutionDeps,
): Promise<boolean> {
  if (permissionMode === 'bypass' || permissionMode === 'auto-edits') {
    return true;
  }

  if (tool.name !== 'agent_tool') {
    return deps.uiStore.getState().waitForPermission({
      id: tool.id,
      name: tool.name,
      arguments: effectiveArgs,
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
  tool: ToolRequest,
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
  permissionMode: 'standard' | 'auto-edits' | 'bypass' | 'plan-only',
  workDir: string | null,
  deps: ToolBatchExecutionDeps,
): Promise<ToolArtifactResult> {
  const uiStore = deps.uiStore.getState();

  uiStore.updateTaskStep(tool.id, 'running');

  if (tool.name === 'AskUserQuestion') {
    let toolResultContent = '';
    try {
      const args = JSON.parse(normalizedToolArgs);
      toolResultContent = await uiStore.showQuestionnaire(activeSessionId, {
        toolCallId: tool.id,
        title: args.title || 'Information Needed',
        description: args.description || '',
        fields: args.fields || [],
      });
    } catch (error) {
      toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    uiStore.updateTaskStep(tool.id, toolResultContent.startsWith('Error:') ? 'failed' : 'done');
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: normalizedToolArgs };
  }

  const hookResult = await deps.runPreToolUseHooks({
    toolName: tool.name,
    toolArgs: normalizedToolArgs,
    workDir: workDir ?? undefined,
    permissionMode,
    sessionId: activeSessionId,
  });

  let effectiveArgs = normalizedToolArgs;
  let toolResultContent = '';

  if (!hookResult.approved) {
    uiStore.addNotification('error', hookResult.error || 'Tool execution blocked', activeSessionId);
    toolResultContent = `Error: ${hookResult.error || 'Tool execution blocked'}`;
    uiStore.updateTaskStep(tool.id, 'failed');
    return { id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: effectiveArgs };
  }

  effectiveArgs = hookResult.modifiedArgs || normalizedToolArgs;
  const session = deps.uiStore.getState();
  void session;
  const approved = await resolveSerialToolPermission(tool, effectiveArgs, activeSessionId, permissionMode, workDir, deps);
  if (!approved) {
    uiStore.updateTaskStep(tool.id, 'failed');
    return {
      id: tool.id,
      content: deps.t('permission.deniedMessage'),
      toolName: tool.name,
      toolArgs: effectiveArgs,
    };
  }

  try {
    if (tool.name === 'get_current_workspace') {
      toolResultContent = workDir
        ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
        : JSON.stringify({ work_dir: null, message: 'No working directory bound to this session.' });
    } else if (tool.name === 'agent_tool') {
      toolResultContent = await executeAgentTool(tool, effectiveArgs, activeSessionId, workDir, deps);
    } else {
      toolResultContent = await deps.invoke<string>('execute_tool', {
        toolName: tool.name,
        arguments: effectiveArgs,
        workDir,
      });
    }
    uiStore.updateTaskStep(tool.id, 'done');
  } catch (error) {
    uiStore.updateTaskStep(tool.id, 'failed');
    toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }

  const postCtx: PostHookContext = {
    toolName: tool.name,
    toolArgs: effectiveArgs,
    result: toolResultContent,
    isError: toolResultContent.startsWith('Error:'),
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
  const { chunk, activeSessionId, assistantMessageId, get, ensureSessionWorkDir } = context;
  const uiStore = deps.uiStore.getState();
  let currentSession = get().sessions.find((session) => session.id === activeSessionId);
  let workDir = currentSession?.workDir ?? null;
  const permissionMode = currentSession?.permissionMode || 'standard';

  if (!workDir) {
    const needsWorkDir = chunk.tools.some((tool) => WORKSPACE_TOOL_NAMES.has(tool.name));
    if (needsWorkDir) {
      workDir = await ensureSessionWorkDir();
      currentSession = get().sessions.find((session) => session.id === activeSessionId);
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

  uiStore.setTaskProgress(createToolTaskSteps(chunk.tools));

  const normalizedToolArgsById = new Map<string, string>();
  for (const tool of chunk.tools) {
    let normalizedArgs = deps.normalizeResumeWorkspaceToolArgs(
      tool.name,
      tool.arguments,
      workDir ?? currentSession?.workDir,
      uiStore.activeSkill,
    );

    if (tool.name === 'compile_typst_file') {
      normalizedArgs = await deps.normalizeCompileTypstArgs(normalizedArgs, workDir ?? currentSession?.workDir);
    }

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
    allResults.push(...(await executeConcurrentTools(concurrent, normalizedToolArgsById, activeSessionId, workDir, deps)));
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
        workDir,
        deps,
      ),
    );
  }

  try {
    await deps.registerArtifactsFromToolResults(
      deps.loadArtifactDetector,
      assistantMessageId,
      allResults,
      workDir,
    );
  } catch {
    // artifact detection is best-effort
  }

  chunk._resolveAll(allResults.map(({ id, content }) => ({ id, content })));
  return allResults;
}
