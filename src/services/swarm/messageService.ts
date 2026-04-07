/**
 * Swarm Message Service
 *
 * Provides async collaboration protocol via inbox/message queues.
 * Messages are runtime entities, not temporary helper state.
 *
 * Design:
 * - Messages are created, delivered to target agent's inbox
 * - Inbox polling is centralized (not scattered intervals)
 * - Subscribers can react to new messages via the event bus
 * - Message types define the communication protocol
 */

import type { SwarmMessage, MessageType } from './types';
import * as repo from './repository';

// =============================================================================
// Message sending
// =============================================================================

export interface SendMessageOptions {
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  messageType: MessageType;
  content: string;
  taskId?: string;
}

export function sendMessage(options: SendMessageOptions): SwarmMessage {
  return repo.createMessage({
    id: repo.generateId('msg'),
    teamId: options.teamId,
    fromAgentId: options.fromAgentId,
    toAgentId: options.toAgentId,
    messageType: options.messageType,
    content: options.content,
    taskId: options.taskId,
    createdAt: Date.now(),
  });
}

/**
 * Broadcast a message to all team members (except sender).
 */
export function broadcastToTeam(
  teamId: string,
  fromAgentId: string,
  messageType: MessageType,
  content: string,
  taskId?: string,
): SwarmMessage[] {
  const agents = repo.getAgentsForTeam(teamId);
  const messages: SwarmMessage[] = [];
  for (const agent of agents) {
    if (agent.id !== fromAgentId) {
      messages.push(sendMessage({
        teamId,
        fromAgentId,
        toAgentId: agent.id,
        messageType,
        content,
        taskId,
      }));
    }
  }
  return messages;
}

// =============================================================================
// Inbox access patterns
// =============================================================================

/**
 * Poll inbox for an agent. Returns all unread messages sorted by creation time.
 */
export function pollInbox(agentId: string): SwarmMessage[] {
  return repo.getUnreadMessages(agentId).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Mark a specific message as read.
 */
export function markRead(messageId: string): SwarmMessage | undefined {
  return repo.markMessageRead(messageId);
}

/**
 * Mark all unread messages for an agent as read.
 */
export function markAllRead(agentId: string): number {
  const unread = repo.getUnreadMessages(agentId);
  let count = 0;
  for (const msg of unread) {
    repo.markMessageRead(msg.id);
    count++;
  }
  return count;
}

/**
 * List all unread messages for an agent.
 */
export function listUnread(agentId: string): SwarmMessage[] {
  return repo.getUnreadMessages(agentId);
}

/**
 * Get full conversation between two agents (both directions).
 */
export function getConversation(agentId1: string, agentId2: string): SwarmMessage[] {
  return repo.getAllMessages()
    .filter(m =>
      (m.fromAgentId === agentId1 && m.toAgentId === agentId2) ||
      (m.fromAgentId === agentId2 && m.toAgentId === agentId1)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get messages of a specific type for an agent.
 */
export function getMessagesByType(agentId: string, type: MessageType): SwarmMessage[] {
  return repo.getMessagesForAgent(agentId)
    .filter(m => m.messageType === type)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get inbox summary for an agent.
 */
export function getInboxSummary(agentId: string): {
  totalUnread: number;
  byType: Record<MessageType, number>;
} {
  const unread = repo.getUnreadMessages(agentId);
  const byType: Record<string, number> = {};
  for (const msg of unread) {
    byType[msg.messageType] = (byType[msg.messageType] || 0) + 1;
  }
  return {
    totalUnread: unread.length,
    byType: byType as Record<MessageType, number>,
  };
}

// =============================================================================
// Centralized inbox polling mechanism
// =============================================================================

type InboxHandler = (messages: SwarmMessage[]) => void;
const inboxPollers = new Map<string, { handler: InboxHandler; intervalId: ReturnType<typeof setInterval> }>();

/**
 * Start polling inbox for an agent at a set interval.
 * Handler is called with new unread messages each poll cycle.
 * Returns a cleanup function.
 */
export function startInboxPolling(
  agentId: string,
  handler: InboxHandler,
  intervalMs: number = 2000,
): () => void {
  // Stop existing poller for this agent if any
  stopInboxPolling(agentId);

  const intervalId = setInterval(() => {
    const unread = pollInbox(agentId);
    if (unread.length > 0) {
      handler(unread);
    }
  }, intervalMs);

  inboxPollers.set(agentId, { handler, intervalId });

  return () => stopInboxPolling(agentId);
}

/**
 * Stop polling for an agent.
 */
export function stopInboxPolling(agentId: string): void {
  const poller = inboxPollers.get(agentId);
  if (poller) {
    clearInterval(poller.intervalId);
    inboxPollers.delete(agentId);
  }
}

/**
 * Stop all pollers (cleanup on app teardown).
 */
export function stopAllInboxPolling(): void {
  for (const [, poller] of inboxPollers) {
    clearInterval(poller.intervalId);
  }
  inboxPollers.clear();
}
