/**
 * Swarm Lifecycle Manager
 *
 * Handles creation, state transitions, and teardown of swarm runtime entities.
 * This is the main orchestration layer that coordinates teams, agents, and their lifecycles.
 *
 * Design:
 * - All mutations go through repository (single source of truth)
 * - Lifecycle transitions are validated (no illegal state transitions)
 * - Transcript entries are recorded at lifecycle boundaries
 */

import type {
  SwarmAgent,
  SwarmTeam,
  SwarmRun,
  AgentRole,
  AgentStatus,
  AgentMemory,
  TeamMemory,
} from './types';
import * as repo from './repository';
import { recordTranscript } from './transcript';
import { initTeamMemory, initAgentMemory, getSwarmBaseDir } from './memory';

// =============================================================================
// Run lifecycle
// =============================================================================

export function startRun(chatSessionId: string): SwarmRun {
  const now = Date.now();
  return repo.createRun({
    id: repo.generateId('run'),
    chatSessionId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

export function getActiveRunForChatSession(chatSessionId: string): SwarmRun | undefined {
  return repo.getAllRuns().find(
    (run) => run.chatSessionId === chatSessionId && run.status === 'active'
  );
}

export function completeRun(runId: string): SwarmRun | undefined {
  return repo.updateRun(runId, { status: 'completed' });
}

export function failRun(runId: string): SwarmRun | undefined {
  return repo.updateRun(runId, { status: 'failed' });
}

/**
 * Reconcile a run's terminal state based on current runtime entities for a chat session.
 * - If any agents are still working, or tasks are still pending/claimed/in_progress, keep the run active.
 * - Otherwise mark the run completed or failed depending on whether any terminal failures occurred.
 */
export function reconcileRunForChatSession(chatSessionId: string): SwarmRun | undefined {
  const run = getActiveRunForChatSession(chatSessionId);
  if (!run) return undefined;

  const teams = repo.getTeamsForSession(chatSessionId);
  const teamIds = new Set(teams.map((team) => team.id));
  const agents = repo.getAllAgents().filter((agent) => agent.sessionId === chatSessionId);
  const tasks = repo.getAllTasks().filter((task) => teamIds.has(task.teamId));

  const hasActiveAgents = agents.some((agent) => agent.status === 'working');
  const hasOpenTasks = tasks.some((task) =>
    task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'
  );

  if (hasActiveAgents || hasOpenTasks) {
    return run;
  }

  const hasFailures =
    agents.some((agent) => agent.status === 'failed') ||
    tasks.some((task) => task.status === 'failed');

  return hasFailures ? failRun(run.id) : completeRun(run.id);
}

// =============================================================================
// Team lifecycle
// =============================================================================

export interface CreateTeamOptions {
  name: string;
  sessionId: string;
  description?: string;
  leaderName?: string;
  leaderModel?: string;
  /** Project root for determining memory directory */
  projectRoot?: string;
}

export async function createTeam(options: CreateTeamOptions): Promise<{ team: SwarmTeam; leader: SwarmAgent; teamMemory?: TeamMemory; leaderMemory?: AgentMemory }> {
  const now = Date.now();
  const teamId = repo.generateId('team');
  const leaderId = repo.generateId('agent');
  const leaderName = options.leaderName || 'leader';

  const team = repo.createTeam({
    id: teamId,
    name: options.name,
    leaderId,
    status: 'active',
    sessionId: options.sessionId,
    description: options.description,
    createdAt: now,
    updatedAt: now,
  });

  const leader = repo.createAgent({
    id: leaderId,
    teamId,
    name: leaderName,
    role: 'leader',
    status: 'idle',
    sessionId: options.sessionId,
    model: options.leaderModel,
    createdAt: now,
    updatedAt: now,
  });

  recordTranscript(leaderId, {
    role: 'system',
    content: `Team "${options.name}" created. Leader "${leaderName}" initialized.`,
    eventType: 'agent_started',
  });

  // Initialize memory directories (fire-and-forget on error)
  let teamMemory: TeamMemory | undefined;
  let leaderMemory: AgentMemory | undefined;
  try {
    const baseDir = await getSwarmBaseDir(options.projectRoot);
    teamMemory = await initTeamMemory(teamId, baseDir);
    leaderMemory = await initAgentMemory(teamId, leaderId, baseDir);
  } catch (e) {
    console.error('[SwarmLifecycle] Failed to initialize memory:', e);
  }

  return { team, leader, teamMemory, leaderMemory };
}

export function disbandTeam(teamId: string): boolean {
  const team = repo.getTeam(teamId);
  if (!team) return false;

  // Mark all agents in this team as completed
  const teamAgents = repo.getAgentsForTeam(teamId);
  for (const agent of teamAgents) {
    if (agent.status === 'idle' || agent.status === 'working') {
      repo.updateAgent(agent.id, { status: 'completed' });
      recordTranscript(agent.id, {
        role: 'system',
        content: `Agent "${agent.name}" completed (team disbanded).`,
        eventType: 'agent_completed',
      });
    }
  }

  repo.updateTeam(teamId, { status: 'disbanded' });
  return true;
}

// =============================================================================
// Agent lifecycle
// =============================================================================

export interface SpawnAgentOptions {
  teamId: string;
  name: string;
  role?: AgentRole;
  sessionId: string;
  parentAgentId?: string;
  model?: string;
  /** Project root for determining memory directory */
  projectRoot?: string;
}

export async function spawnAgent(options: SpawnAgentOptions): Promise<{ agent: SwarmAgent; memory?: AgentMemory }> {
  const now = Date.now();
  const agent = repo.createAgent({
    id: repo.generateId('agent'),
    teamId: options.teamId,
    name: options.name,
    role: options.role || 'member',
    status: 'idle',
    parentAgentId: options.parentAgentId,
    sessionId: options.sessionId,
    model: options.model,
    createdAt: now,
    updatedAt: now,
  });

  recordTranscript(agent.id, {
    role: 'system',
    content: `Agent "${options.name}" spawned in team "${options.teamId}".`,
    eventType: 'agent_started',
  });

  // Initialize agent memory directory
  let memory: AgentMemory | undefined;
  try {
    const baseDir = await getSwarmBaseDir(options.projectRoot);
    memory = await initAgentMemory(options.teamId, agent.id, baseDir);
  } catch (e) {
    console.error('[SwarmLifecycle] Failed to initialize agent memory:', e);
  }

  return { agent, memory };
}

export function startAgent(agentId: string, taskId?: string): SwarmAgent | undefined {
  const agent = repo.getAgent(agentId);
  if (!agent) return undefined;
  if (agent.status !== 'idle' && agent.status !== 'interrupted') return agent;

  return repo.updateAgent(agentId, {
    status: 'working',
    currentTaskId: taskId,
  });
}

export function completeAgent(agentId: string): SwarmAgent | undefined {
  const agent = repo.getAgent(agentId);
  if (!agent) return undefined;

  recordTranscript(agentId, {
    role: 'system',
    content: `Agent "${agent.name}" completed.`,
    eventType: 'agent_completed',
  });

  return repo.updateAgent(agentId, {
    status: 'completed',
    currentTaskId: undefined,
  });
}

export function failAgent(agentId: string, error?: string): SwarmAgent | undefined {
  const agent = repo.getAgent(agentId);
  if (!agent) return undefined;

  recordTranscript(agentId, {
    role: 'system',
    content: `Agent "${agent.name}" failed${error ? `: ${error}` : ''}.`,
    eventType: 'agent_failed',
  });

  return repo.updateAgent(agentId, {
    status: 'failed',
    currentTaskId: undefined,
  });
}

/**
 * Transition agent status with validation.
 * Only allows legal transitions.
 */
export function transitionAgent(agentId: string, newStatus: AgentStatus): SwarmAgent | undefined {
  const agent = repo.getAgent(agentId);
  if (!agent) return undefined;

  const allowed = getAllowedTransitions(agent.status);
  if (!allowed.includes(newStatus)) {
    console.warn(
      `[SwarmLifecycle] Illegal transition: ${agent.name} from ${agent.status} to ${newStatus}`
    );
    return agent;
  }

  return repo.updateAgent(agentId, { status: newStatus });
}

function getAllowedTransitions(current: AgentStatus): AgentStatus[] {
  switch (current) {
    case 'idle':        return ['working', 'completed', 'failed'];
    case 'working':     return ['idle', 'completed', 'failed', 'interrupted'];
    case 'completed':   return []; // terminal
    case 'failed':      return ['idle']; // can retry
    case 'interrupted': return ['idle', 'failed']; // can resume or give up
    default:            return [];
  }
}

// =============================================================================
// Queries
// =============================================================================

export function getTeamWithMembers(teamId: string): {
  team: SwarmTeam;
  members: SwarmAgent[];
} | undefined {
  const team = repo.getTeam(teamId);
  if (!team) return undefined;
  return { team, members: repo.getAgentsForTeam(teamId) };
}

export function getAgentSummary(agentId: string): {
  agent: SwarmAgent;
  tasks: import('./types').SwarmTask[];
  unreadCount: number;
  transcriptCount: number;
  pendingPermissions: number;
} | undefined {
  const agent = repo.getAgent(agentId);
  if (!agent) return undefined;
  return {
    agent,
    tasks: repo.getTasksForAgent(agentId),
    unreadCount: repo.getUnreadMessages(agentId).length,
    transcriptCount: repo.getTranscriptForAgent(agentId).length,
    pendingPermissions: repo.getPendingPermissionsForTeam(agent.teamId).length,
  };
}
