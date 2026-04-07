/**
 * Swarm Task Manager
 *
 * Manages task creation, assignment, claiming, and completion within teams.
 * Follows a work-queue pattern: tasks are posted, then claimed by agents.
 *
 * Design:
 * - Tasks start as 'pending' and can be freely assigned or claimed
 * - Only one agent can hold a task at a time
 * - Task lifecycle generates transcript entries
 */

import type { SwarmTask, TaskType } from './types';
import * as repo from './repository';
import { recordTranscript } from './transcript';
import { sendMessage } from './messageService';

// =============================================================================
// Task creation
// =============================================================================

export interface CreateTaskOptions {
  teamId: string;
  type?: TaskType;
  description: string;
  assignedAgentId?: string;
}

export function createTask(options: CreateTaskOptions): SwarmTask {
  const now = Date.now();
  const task = repo.createTask({
    id: repo.generateId('task'),
    teamId: options.teamId,
    assignedAgentId: options.assignedAgentId,
    type: options.type || 'general',
    description: options.description,
    status: options.assignedAgentId ? 'claimed' : 'pending',
    createdAt: now,
    updatedAt: now,
  });

  // If directly assigned, send a task_assignment message
  if (options.assignedAgentId) {
    const team = repo.getTeam(options.teamId);
    if (team) {
      sendMessage({
        teamId: options.teamId,
        fromAgentId: team.leaderId,
        toAgentId: options.assignedAgentId,
        messageType: 'task_assignment',
        content: options.description,
        taskId: task.id,
      });
    }
  }

  return task;
}

// =============================================================================
// Task claiming (work-queue pattern)
// =============================================================================

/**
 * Agent claims the next available task in their team.
 * Returns the claimed task, or undefined if no tasks available.
 */
export function claimNextTask(teamId: string, agentId: string): SwarmTask | undefined {
  const unclaimed = repo.getUnclaimedTasks(teamId);
  if (unclaimed.length === 0) return undefined;

  // Claim the oldest unclaimed task
  const task = unclaimed.sort((a, b) => a.createdAt - b.createdAt)[0];
  return claimTask(task.id, agentId);
}

export function claimTask(taskId: string, agentId: string): SwarmTask | undefined {
  const task = repo.getTask(taskId);
  if (!task) return undefined;
  if (task.status !== 'pending') return undefined;

  const updated = repo.updateTask(taskId, {
    assignedAgentId: agentId,
    status: 'claimed',
  });

  if (updated) {
    // Update agent's current task
    repo.updateAgent(agentId, { currentTaskId: taskId });

    recordTranscript(agentId, {
      role: 'system',
      content: `Claimed task: ${task.description}`,
      eventType: 'user_prompt_injected',
      taskId,
    });
  }

  return updated;
}

// =============================================================================
// Task progress
// =============================================================================

export function startTask(taskId: string): SwarmTask | undefined {
  const task = repo.getTask(taskId);
  if (!task) return undefined;
  if (task.status !== 'claimed') return undefined;

  return repo.updateTask(taskId, { status: 'in_progress' });
}

export function completeTask(taskId: string, resultSummary?: string): SwarmTask | undefined {
  const task = repo.getTask(taskId);
  if (!task) return undefined;

  const updated = repo.updateTask(taskId, {
    status: 'completed',
    resultSummary,
  });

  if (updated && task.assignedAgentId) {
    // Clear agent's current task
    repo.updateAgent(task.assignedAgentId, { currentTaskId: undefined });

    recordTranscript(task.assignedAgentId, {
      role: 'system',
      content: `Task completed: ${task.description}${resultSummary ? `\nResult: ${resultSummary}` : ''}`,
      eventType: 'agent_completed',
      taskId,
    });

    // Send task_result message to team leader
    const team = repo.getTeam(task.teamId);
    if (team) {
      sendMessage({
        teamId: task.teamId,
        fromAgentId: task.assignedAgentId,
        toAgentId: team.leaderId,
        messageType: 'task_result',
        content: resultSummary || `Task "${task.description}" completed.`,
        taskId,
      });
    }
  }

  return updated;
}

export function failTask(taskId: string, error?: string): SwarmTask | undefined {
  const task = repo.getTask(taskId);
  if (!task) return undefined;

  const updated = repo.updateTask(taskId, {
    status: 'failed',
    resultSummary: error ? `Error: ${error}` : undefined,
  });

  if (updated && task.assignedAgentId) {
    repo.updateAgent(task.assignedAgentId, { currentTaskId: undefined });

    recordTranscript(task.assignedAgentId, {
      role: 'system',
      content: `Task failed: ${task.description}${error ? `\nError: ${error}` : ''}`,
      eventType: 'agent_failed',
      taskId,
    });

    // Notify team leader so the result appears in the conversation
    const team = repo.getTeam(task.teamId);
    if (team) {
      sendMessage({
        teamId: task.teamId,
        fromAgentId: task.assignedAgentId,
        toAgentId: team.leaderId,
        messageType: 'task_result',
        content: `FAILED: ${error || 'Unknown error'} (task: "${task.description}")`,
        taskId,
      });
    }
  }

  return updated;
}

// =============================================================================
// Queries
// =============================================================================

export function getTeamTaskSummary(teamId: string): {
  total: number;
  pending: number;
  claimed: number;
  inProgress: number;
  completed: number;
  failed: number;
} {
  const allTasks = repo.getTasksForTeam(teamId);
  return {
    total: allTasks.length,
    pending: allTasks.filter(t => t.status === 'pending').length,
    claimed: allTasks.filter(t => t.status === 'claimed').length,
    inProgress: allTasks.filter(t => t.status === 'in_progress').length,
    completed: allTasks.filter(t => t.status === 'completed').length,
    failed: allTasks.filter(t => t.status === 'failed').length,
  };
}
