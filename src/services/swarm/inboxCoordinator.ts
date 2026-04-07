/**
 * Swarm Inbox Coordinator
 *
 * Lifecycle-aware layer that starts/stops inbox polling for swarm agents
 * and defines actual message consumption behavior.
 *
 * This is the module that makes inbox/message flow operational:
 * - Starts polling when agents become active
 * - Defines handlers per message type for leaders and members
 * - Marks messages as read when consumed
 * - Records consumption events in transcript for observability
 * - Cleans up pollers when agents/teams finish
 *
 * Design:
 * - Leader inbox handler: consumes task_result, status_update
 * - Member inbox handler: consumes task_assignment (ack only — actual execution
 *   is driven by the subagent executor, not by inbox polling)
 * - All consumed messages are marked read immediately
 * - Transcript entries record message consumption for observability
 * - Cleanup is idempotent and safe to call multiple times
 */

import type { SwarmMessage } from './types';
import * as repo from './repository';
import { startInboxPolling, stopInboxPolling, stopAllInboxPolling, markRead, broadcastToTeam } from './messageService';
import { recordTranscript } from './transcript';

// =============================================================================
// Typed in-app event bus for intra-module signaling
// =============================================================================

type SwarmEventMap = {
  task_result_received: {
    teamId: string;
    leaderId: string;
    fromAgentId: string;
    taskId?: string;
    content: string;
    messageId: string;
  };
};

class SwarmEventBus extends EventTarget {
  emit<K extends keyof SwarmEventMap>(type: K, detail: SwarmEventMap[K]): void {
    this.dispatchEvent(new CustomEvent(type as string, { detail }));
  }
  on<K extends keyof SwarmEventMap>(
    type: K,
    handler: (detail: SwarmEventMap[K]) => void,
  ): void {
    this.addEventListener(type as string, (e) =>
      handler((e as CustomEvent<SwarmEventMap[K]>).detail),
    );
  }
  off<K extends keyof SwarmEventMap>(
    type: K,
    handler: (detail: SwarmEventMap[K]) => void,
  ): void {
    this.removeEventListener(type as string, handler as unknown as EventListener);
  }
}

/** Singleton in-app event bus for swarm coordinator signals */
export const swarmEvents = new SwarmEventBus();

// =============================================================================
// Tracking active coordinator state
// =============================================================================

/** Set of agent IDs that currently have active inbox polling */
const activePollers = new Set<string>();

/** Map of teamId → leaderId for quick lookup */
const teamLeaderMap = new Map<string, string>();

// =============================================================================
// Leader inbox handler
// =============================================================================

/**
 * Handle incoming messages for a team leader.
 *
 * Consumes:
 * - task_result: records the result in leader transcript, broadcasts a status_update
 *   to the team, and marks the message read
 * - status_update: records in leader transcript and marks read
 * - question: records in leader transcript (answering is not yet automated)
 */
function handleLeaderInbox(leaderId: string, teamId: string, messages: SwarmMessage[]): void {
  for (const msg of messages) {
    switch (msg.messageType) {
      case 'task_result': {
        // The core collaboration loop: leader consumes teammate results
        const fromAgent = repo.getAgent(msg.fromAgentId);
        const agentName = fromAgent?.name || msg.fromAgentId.slice(-8);
        const task = msg.taskId ? repo.getTask(msg.taskId) : null;
        const taskDesc = task?.description?.slice(0, 100) || 'unknown task';

        // Record consumption in leader's transcript
        recordTranscript(leaderId, {
          role: 'system',
          content: `Received task_result from ${agentName} for "${taskDesc}": ${msg.content.slice(0, 300)}`,
          eventType: 'tool_result',
          toolName: 'inbox:task_result',
          taskId: msg.taskId,
        });

        // Broadcast status_update to team so other members are aware
        broadcastToTeam(
          teamId,
          leaderId,
          'status_update',
          `[${agentName}] completed task: ${taskDesc}`,
          msg.taskId,
        );

        // Emit to in-app bus so chatStore can inject result into the conversation
        swarmEvents.emit('task_result_received', {
          teamId,
          leaderId,
          fromAgentId: msg.fromAgentId,
          taskId: msg.taskId,
          content: msg.content,
          messageId: msg.id,
        });

        // Mark consumed
        markRead(msg.id);
        break;
      }

      case 'status_update': {
        // Record in transcript for observability
        recordTranscript(leaderId, {
          role: 'system',
          content: `Status update: ${msg.content.slice(0, 300)}`,
          eventType: 'tool_result',
          toolName: 'inbox:status_update',
        });
        markRead(msg.id);
        break;
      }

      case 'question': {
        // Record in transcript — automated answering not yet implemented
        const fromAgent = repo.getAgent(msg.fromAgentId);
        const agentName = fromAgent?.name || msg.fromAgentId.slice(-8);
        recordTranscript(leaderId, {
          role: 'system',
          content: `Question from ${agentName}: ${msg.content.slice(0, 300)}`,
          eventType: 'tool_result',
          toolName: 'inbox:question',
        });
        markRead(msg.id);
        break;
      }

      case 'permission_result': {
        markRead(msg.id);
        break;
      }

      default: {
        // For any other message type, mark read to prevent accumulation
        markRead(msg.id);
        break;
      }
    }
  }
}

// =============================================================================
// Member inbox handler
// =============================================================================

/**
 * Handle incoming messages for a team member.
 *
 * Consumes:
 * - task_assignment: acknowledges receipt, marks read (actual execution
 *   is driven by the subagent executor, not by polling)
 * - status_update: records in transcript, marks read
 * - answer: records in transcript, marks read
 */
function handleMemberInbox(agentId: string, messages: SwarmMessage[]): void {
  for (const msg of messages) {
    switch (msg.messageType) {
      case 'task_assignment': {
        // Ack: the task was already assigned during createTask();
        // this message is the inbox notification — mark it consumed
        recordTranscript(agentId, {
          role: 'system',
          content: `Received task assignment: ${msg.content.slice(0, 200)}`,
          eventType: 'user_prompt_injected',
          taskId: msg.taskId,
        });
        markRead(msg.id);
        break;
      }

      case 'status_update': {
        recordTranscript(agentId, {
          role: 'system',
          content: `Team update: ${msg.content.slice(0, 300)}`,
          eventType: 'tool_result',
          toolName: 'inbox:status_update',
        });
        markRead(msg.id);
        break;
      }

      case 'answer': {
        recordTranscript(agentId, {
          role: 'system',
          content: `Answer received: ${msg.content.slice(0, 300)}`,
          eventType: 'tool_result',
          toolName: 'inbox:answer',
        });
        markRead(msg.id);
        break;
      }

      default: {
        markRead(msg.id);
        break;
      }
    }
  }
}

// =============================================================================
// Polling lifecycle management
// =============================================================================

/** Default polling interval in ms */
const POLL_INTERVAL_MS = 2000;

/**
 * Start inbox polling for a team leader.
 * Should be called when a team is created or becomes active.
 */
export function startLeaderPolling(teamId: string, leaderId: string): void {
  if (activePollers.has(leaderId)) return; // already polling

  teamLeaderMap.set(teamId, leaderId);

  startInboxPolling(
    leaderId,
    (messages) => handleLeaderInbox(leaderId, teamId, messages),
    POLL_INTERVAL_MS,
  );
  activePollers.add(leaderId);

  console.log(`[InboxCoordinator] Started leader polling: ${leaderId} (team: ${teamId})`);
}

/**
 * Start inbox polling for a team member.
 * Should be called when a member agent is spawned.
 */
export function startMemberPolling(agentId: string): void {
  if (activePollers.has(agentId)) return; // already polling

  startInboxPolling(
    agentId,
    (messages) => handleMemberInbox(agentId, messages),
    POLL_INTERVAL_MS,
  );
  activePollers.add(agentId);

  console.log(`[InboxCoordinator] Started member polling: ${agentId}`);
}

/**
 * Stop inbox polling for a specific agent.
 * Should be called when an agent completes, fails, or is interrupted.
 */
export function stopAgentPolling(agentId: string): void {
  if (!activePollers.has(agentId)) return;

  stopInboxPolling(agentId);
  activePollers.delete(agentId);

  // Clean up leader map if this was a leader
  for (const [teamId, leaderId] of teamLeaderMap) {
    if (leaderId === agentId) {
      teamLeaderMap.delete(teamId);
    }
  }

  console.log(`[InboxCoordinator] Stopped polling: ${agentId}`);
}

/**
 * Stop all inbox polling for all agents in a team.
 * Should be called when a team is disbanded.
 */
export function stopTeamPolling(teamId: string): void {
  const agents = repo.getAgentsForTeam(teamId);
  for (const agent of agents) {
    stopAgentPolling(agent.id);
  }
  teamLeaderMap.delete(teamId);

  console.log(`[InboxCoordinator] Stopped all polling for team: ${teamId}`);
}

/**
 * Stop all inbox polling globally.
 * Should be called on app teardown or swarm store cleanup.
 */
export function stopAllPolling(): void {
  stopAllInboxPolling();
  activePollers.clear();
  teamLeaderMap.clear();

  console.log('[InboxCoordinator] Stopped all polling globally');
}

/**
 * Check whether an agent currently has active inbox polling.
 */
export function isPollingActive(agentId: string): boolean {
  return activePollers.has(agentId);
}

/**
 * Get the count of agents currently being polled.
 */
export function getActivePollerCount(): number {
  return activePollers.size;
}

// =============================================================================
// Lifecycle integration hooks
// =============================================================================

/**
 * Hook: call when a new team is created.
 * Starts leader inbox polling automatically.
 */
export function onTeamCreated(teamId: string, leaderId: string): void {
  startLeaderPolling(teamId, leaderId);
}

/**
 * Hook: call when a member agent is spawned and started.
 * Starts member inbox polling automatically.
 */
export function onAgentStarted(agentId: string): void {
  const agent = repo.getAgent(agentId);
  if (!agent) return;

  if (agent.role === 'leader') {
    startLeaderPolling(agent.teamId, agentId);
  } else {
    startMemberPolling(agentId);
  }
}

/**
 * Hook: call when an agent completes or fails.
 * Stops inbox polling and processes any remaining unread messages.
 */
export function onAgentFinished(agentId: string): void {
  const agent = repo.getAgent(agentId);

  // Process any remaining unread messages before stopping
  if (agent) {
    const unread = repo.getUnreadMessages(agentId);
    if (unread.length > 0) {
      if (agent.role === 'leader') {
        handleLeaderInbox(agentId, agent.teamId, unread);
      } else {
        handleMemberInbox(agentId, unread);
      }
    }
  }

  stopAgentPolling(agentId);
}

/**
 * Hook: call when a team is disbanded.
 * Stops all polling for the team.
 */
export function onTeamDisbanded(teamId: string): void {
  stopTeamPolling(teamId);
}
