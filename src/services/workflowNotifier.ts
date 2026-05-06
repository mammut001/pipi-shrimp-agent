import type { WorkflowAgent } from '@/types/workflow';
import { listUnread, markRead, sendMessage } from '@/services/swarm/messageService';
import type { WorkflowInboxPromptItem } from './workflowPromptBuilder';

const WORKFLOW_NOTIFICATION_VERSION = 1;

interface WorkflowNotificationContent {
  version: number;
  kind: 'agent_output';
  runId: string;
  summary: string;
  fullLength: number;
  timestamp: number;
}

function serializeNotification(content: WorkflowNotificationContent): string {
  return JSON.stringify(content);
}

function parseNotification(raw: string): WorkflowNotificationContent | null {
  try {
    const parsed = JSON.parse(raw) as WorkflowNotificationContent;
    if (parsed?.kind !== 'agent_output' || !parsed.runId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function notifyOnComplete(
  fromAgent: WorkflowAgent,
  agents: WorkflowAgent[],
  output: string,
  runId: string,
): Promise<void> {
  const targetAgents = (fromAgent.notifyOnComplete ?? [])
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is WorkflowAgent => Boolean(agent));

  const summary = output.slice(0, 600);

  for (const target of targetAgents) {
    sendMessage({
      teamId: runId,
      fromAgentId: fromAgent.id,
      toAgentId: target.id,
      messageType: 'status_update',
      content: serializeNotification({
        version: WORKFLOW_NOTIFICATION_VERSION,
        kind: 'agent_output',
        runId,
        summary,
        fullLength: output.length,
        timestamp: Date.now(),
      }),
    });
  }
}

export function readAgentInbox(
  agentId: string,
  runId: string,
  agents: WorkflowAgent[],
): WorkflowInboxPromptItem[] {
  const unreadMessages = listUnread(agentId)
    .filter((message) => message.teamId === runId)
    .sort((left, right) => left.createdAt - right.createdAt);

  const promptItems: WorkflowInboxPromptItem[] = [];

  for (const message of unreadMessages) {
    const payload = parseNotification(message.content);
    if (!payload || payload.runId !== runId) {
      continue;
    }

    const fromAgentName = agents.find((agent) => agent.id === message.fromAgentId)?.name ?? message.fromAgentId;
    promptItems.push({
      fromAgentId: message.fromAgentId,
      fromAgentName,
      summary: payload.summary,
      fullLength: payload.fullLength,
      createdAt: payload.timestamp || message.createdAt,
    });
    markRead(message.id);
  }

  return promptItems;
}
