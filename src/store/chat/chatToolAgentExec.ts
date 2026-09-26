import type { ToolRequest } from '../../services/StreamingToolExecutor';
import type { ToolBatchExecutionDeps } from './chatToolExecution';

export async function executeAgentTool(
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
