/**
 * Run Delegation Plan
 *
 * Executes a DelegationPlan by spawning agents through the existing swarm runtime,
 * tracking progress, and collecting results for synthesis.
 *
 * This is the bridge between the orchestration planner and the swarm execution backend.
 */

import type { DelegationPlan, DelegationResult } from './types';
import { startCollecting, recordAgentResult, forceFinish, findDelegationForAgent } from './resultCollector';

// Lazy-loaded to avoid circular imports
let swarmModule: typeof import('../swarm') | null = null;
let inboxCoordinatorModule: typeof import('../swarm/inboxCoordinator') | null = null;
let subagentModule: typeof import('../multiagent/subagent') | null = null;
let agentContextModule: typeof import('../multiagent/agentContext') | null = null;

async function ensureModules() {
  if (!swarmModule) {
    swarmModule = await import('../swarm');
    inboxCoordinatorModule = await import('../swarm/inboxCoordinator');
    subagentModule = await import('../multiagent/subagent');
    agentContextModule = await import('../multiagent/agentContext');
  }
}

/** Max time to wait for all agents to complete (5 minutes) */
const DELEGATION_TIMEOUT_MS = 5 * 60 * 1000;

// =============================================================================
// Public API
// =============================================================================

/**
 * Execute a delegation plan through the swarm runtime.
 *
 * 1. Creates a swarm team for this delegation
 * 2. Spawns agents per the plan
 * 3. Starts each agent via runAgentBackground
 * 4. Returns a promise that resolves with collected results
 *
 * @param plan - The delegation plan to execute
 * @param sessionId - The chat session this delegation belongs to
 * @param workDir - The working directory for agents
 * @returns Promise resolving to delegation results
 */
export async function runDelegationPlan(
  plan: DelegationPlan,
  sessionId: string,
  workDir?: string,
): Promise<DelegationResult> {
  await ensureModules();
  const swarm = swarmModule!;
  const inbox = inboxCoordinatorModule!;
  const subagent = subagentModule!;
  const agentCtx = agentContextModule!;

  // Initialize swarm store if needed
  const { useSwarmStore } = await import('../../store/swarmStore');
  useSwarmStore.getState().init();

  // Ensure there is an active run for this session
  let activeRun = swarm.getActiveRunForChatSession(sessionId);
  if (!activeRun) {
    activeRun = swarm.startRun(sessionId);
  }

  // Create a team for this delegation
  const teamName = `auto-delegation-${plan.id.slice(-8)}`;
  const { team, leader } = await swarm.createTeam({
    name: teamName,
    sessionId,
    description: `Auto-delegation: ${plan.planType} — ${plan.userMessage.slice(0, 80)}`,
    leaderName: 'orchestrator',
    projectRoot: workDir || undefined,
  });

  // Start leader inbox polling
  inbox.onTeamCreated(team.id, leader.id);

  // Set up result collection
  const { promise: completionPromise, registerAgent } = startCollecting(plan);

  // Wire swarm events to result collector for this delegation
  const eventHandler = (detail: {
    teamId: string;
    leaderId: string;
    fromAgentId: string;
    taskId?: string;
    content: string;
    messageId: string;
  }) => {
    if (detail.teamId !== team.id) return;

    // Find the plan ID for this agent
    const planId = findDelegationForAgent(detail.fromAgentId);
    if (planId !== plan.id) return;

    const isFailure = detail.content.startsWith('FAILED:');
    recordAgentResult(
      plan.id,
      detail.fromAgentId,
      detail.taskId || '',
      detail.content,
      !isFailure,
      isFailure ? detail.content : undefined,
    );
  };

  swarm.swarmEvents.on('task_result_received', eventHandler);

  // Build parent context for all agents
  const parentContext = agentCtx.getCurrentAgentContext() || {
    agentId: leader.id,
    sessionId,
    workDir: workDir || undefined,
    toolPool: [],
    metadata: {},
  };

  // Spawn and start each planned agent
  for (const plannedAgent of plan.agents) {
    // Spawn agent in swarm runtime
    const { agent: runtimeAgent } = await swarm.spawnAgent({
      teamId: team.id,
      name: plannedAgent.name,
      role: 'member',
      sessionId,
      parentAgentId: leader.id,
      projectRoot: workDir || undefined,
    });

    // Create a task for this agent
    const runtimeTask = swarm.createTask({
      teamId: team.id,
      type: 'research',
      description: plannedAgent.expectedOutput,
      assignedAgentId: runtimeAgent.id,
    });

    // Start the agent and task
    swarm.startAgent(runtimeAgent.id, runtimeTask.id);
    swarm.startTask(runtimeTask.id);

    // Start member inbox polling
    inbox.onAgentStarted(runtimeAgent.id);

    // Register agent for result collection
    registerAgent(plannedAgent.name, runtimeAgent.id, runtimeTask.id);

    // Record prompt in transcript
    swarm.recordUserPrompt(runtimeAgent.id, plannedAgent.prompt, runtimeTask.id);

    // Actually run the agent via the existing subagent executor
    await subagent.runAgentBackground({
      name: plannedAgent.name,
      prompt: plannedAgent.prompt,
      description: `Auto-delegated ${plannedAgent.role}: ${plannedAgent.expectedOutput}`,
      sessionId,
      parentContext: {
        ...parentContext,
        agentId: runtimeAgent.id,
        teamName: teamName,
        name: plannedAgent.name,
      },
      runInBackground: true,
      subagentType: plannedAgent.role,
    });
  }

  // Set timeout for delegation completion
  const timeoutPromise = new Promise<DelegationResult>((resolve) => {
    setTimeout(() => {
      const result = forceFinish(plan.id);
      if (result) {
        resolve(result);
      }
    }, DELEGATION_TIMEOUT_MS);
  });

  // Wait for either all agents to complete or timeout
  const result = await Promise.race([completionPromise, timeoutPromise]);

  // Clean up event listener
  swarm.swarmEvents.off('task_result_received', eventHandler);

  // Stop inbox polling for all agents in the team and disband
  inbox.onTeamDisbanded(team.id);

  // Reconcile the run
  swarm.reconcileRunForChatSession(sessionId);

  return result;
}
