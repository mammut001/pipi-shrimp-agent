import type { ToolRequest } from '../../services/StreamingToolExecutor';
import { canAutoApproveTool, type ToolPolicyPreviewResult, type PermissionMode } from '../../services/tools/toolExecutionPolicy';
import { coerceRenderableText } from '@/utils/coerceRenderableText';
import type { ToolBatchExecutionDeps } from './chatToolExecution';
import { resolveParentAgentContext } from './chatToolAgentExec';

export function buildPermissionContext(
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

export async function previewBackendToolPolicy(
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

/**
 * Decide whether workspace tools may run for this batch.
 * Pure helper — used by handleToolBatchRequest and unit-tested directly.
 *
 * - Prefer the session Project Folder (`projectDir` / legacy workDir).
 * - Never treat the PiPi Output Folder as a project workspace.
 * - When unbound, block tools that require workspace according to Rust metadata
 *   so the model gets a clear preflight error instead of multi-round path failures.
 * - Fail closed: if `toolMetadataMap` is unavailable, treat the batch as
 *   workspace-critical (block when unbound). There is no second TS catalog.
 */
export function resolveWorkspaceToolPreflight(input: {
  projectDir: string | null | undefined;
  pipiOutputDir: string | null | undefined;
  ensureResult: string | null | undefined;
  toolNames: string[];
  toolMetadataMap?: Map<string, { requiresWorkspace?: boolean }>;
}): {
  workDir: string | null;
  blockWorkspaceTools: boolean;
  needsWorkspaceTools: boolean;
} {
  // Fail closed: without Rust metadata, any tool batch is treated as
  // workspace-critical so we never guess from a TS-side catalog.
  const needsWorkspaceTools = !input.toolMetadataMap
    ? input.toolNames.length > 0
    : input.toolNames.some((name) => input.toolMetadataMap!.get(name)?.requiresWorkspace === true);
  let workDir = typeof input.projectDir === 'string' && input.projectDir.trim()
    ? input.projectDir.trim()
    : null;

  if (!workDir && typeof input.ensureResult === 'string' && input.ensureResult.trim()) {
    const candidate = input.ensureResult.trim();
    const pipi = typeof input.pipiOutputDir === 'string' ? input.pipiOutputDir.trim() : '';
    if (!pipi || candidate !== pipi) {
      workDir = candidate;
    }
  }

  if (workDir && input.pipiOutputDir && workDir === input.pipiOutputDir.trim()) {
    workDir = null;
  }

  return {
    workDir,
    needsWorkspaceTools,
    blockWorkspaceTools: needsWorkspaceTools && !workDir,
  };
}

export async function resolveSerialToolPermission(
  tool: ToolRequest,
  effectiveArgs: string,
  activeSessionId: string,
  permissionMode: PermissionMode,
  workDir: string | null,
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
  // Frontend auto-approve still returns true here; callers must pass any
  // backend-issued approvalToken through to execute so RequireConfirmation
  // can be consumed. Do not gate this on confirmation state or Bypass
  // write tools will regress to a modal.
  if (canAutoApproveTool(permissionMode, tool.name, { browserIntent })) {
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
      sessionId: activeSessionId,
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
      sessionId: activeSessionId,
    });
  }

  const swarm = await deps.loadSwarmModule();
  const parentCtx = resolveParentAgentContext(deps, activeSessionId, workDir);
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
    sessionId: activeSessionId,
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
