/**
 * Swarm Teammates (LEGACY — TRANSITIONAL)
 *
 * ⚠️ This module is NO LONGER the primary swarm execution path.
 * The new runtime at `src/services/swarm/` is now the source of truth.
 *
 * This file is kept temporarily for compatibility with any code that
 * still references these functions directly. The main `agent_tool` path
 * in chatStore now uses the new swarm runtime instead.
 *
 * TODO: Remove this file once all callers are migrated.
 */

import { AgentContext, createChildContext } from './agentContext';
import { runAgentBackground } from './subagent';

export interface TeamMember {
  id: string;
  name: string;
  role: 'leader' | 'member';
  agentId?: string;
  status: 'idle' | 'working' | 'completed' | 'failed';
}

export interface TeamMailbox {
  to: string;
  from: string;
  content: string;
  timestamp: number;
  read: boolean;
}

export interface TeamTask {
  id: string;
  assignedTo: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  result?: string;
}

export interface Team {
  name: string;
  leaderId: string;
  members: TeamMember[];
  mailbox: TeamMailbox[];
  tasks: TeamTask[];
  sessionId: string;
}

// Global team store
const teams = new Map<string, Team>();

/**
 * Create a new team.
 */
export function createTeam(
  name: string,
  leaderContext: AgentContext,
  memberNames: string[],
): Team {
  const members: TeamMember[] = [
    { id: leaderContext.agentId, name: 'Leader', role: 'leader', status: 'idle' },
    ...memberNames.map((name, i) => ({
      id: `member-${i}`,
      name,
      role: 'member' as const,
      status: 'idle' as const,
    })),
  ];

  const team: Team = {
    name,
    leaderId: leaderContext.agentId,
    members,
    mailbox: [],
    tasks: [],
    sessionId: leaderContext.sessionId,
  };

  teams.set(name, team);
  return team;
}

/**
 * Spawn a teammate (background agent).
 * Note: Teammates cannot spawn other teammates (prevents infinite nesting).
 */
export async function spawnTeammate(
  teamName: string,
  memberName: string,
  prompt: string,
  description: string,
  parentContext: AgentContext,
): Promise<string> {
  const team = teams.get(teamName);
  if (!team) {
    throw new Error(`Team ${teamName} not found`);
  }

  const member = team.members.find(m => m.name === memberName);
  if (!member) {
    throw new Error(`Member ${memberName} not found in team ${teamName}`);
  }

  // Prevent infinite nesting: teammates cannot spawn other teammates
  if (parentContext.teamName) {
    throw new Error('Teammates cannot spawn other teammates');
  }

  const context = createChildContext(parentContext, {
    agentId: `teammate-${teamName}-${memberName}`,
    teamName,
    name: memberName,
  });

  member.status = 'working';

  const agentId = await runAgentBackground({
    name: memberName,
    prompt,
    description,
    sessionId: parentContext.sessionId,
    parentContext: context,
    runInBackground: true,
  });

  member.agentId = agentId;
  return agentId;
}

/**
 * Send a message to a team member's mailbox.
 */
export function sendToMailbox(
  teamName: string,
  to: string,
  from: string,
  content: string,
): void {
  const team = teams.get(teamName);
  if (!team) return;

  team.mailbox.push({
    to,
    from,
    content,
    timestamp: Date.now(),
    read: false,
  });
}

/**
 * Read unread messages for a team member.
 */
export function readMailbox(
  teamName: string,
  memberId: string,
): TeamMailbox[] {
  const team = teams.get(teamName);
  if (!team) return [];

  const unread = team.mailbox.filter(m => m.to === memberId && !m.read);
  unread.forEach(m => { m.read = true; });
  return unread;
}

/**
 * Add a task to the team's task list.
 */
export function addTeamTask(
  teamName: string,
  assignedTo: string,
  description: string,
): string {
  const team = teams.get(teamName);
  if (!team) throw new Error(`Team ${teamName} not found`);

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  team.tasks.push({
    id: taskId,
    assignedTo,
    description,
    status: 'pending',
  });

  return taskId;
}

/**
 * Update a team task status.
 */
export function updateTeamTask(
  teamName: string,
  taskId: string,
  status: TeamTask['status'],
  result?: string,
): boolean {
  const team = teams.get(teamName);
  if (!team) return false;

  const task = team.tasks.find(t => t.id === taskId);
  if (!task) return false;

  task.status = status;
  if (result) task.result = result;
  return true;
}

/**
 * Get team status.
 */
export function getTeamStatus(teamName: string): Team | null {
  return teams.get(teamName) || null;
}

/**
 * Get all teams.
 */
export function getAllTeams(): Team[] {
  return Array.from(teams.values());
}

/**
 * Delete a team.
 */
export function deleteTeam(teamName: string): boolean {
  return teams.delete(teamName);
}
