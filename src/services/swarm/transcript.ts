/**
 * Swarm Transcript Service
 *
 * Each agent has its own sidechain transcript — an append-only event log
 * that records lifecycle events, model outputs, tool calls, and permission flows.
 *
 * Design:
 * - Append-only: entries are never modified or deleted
 * - Agent-scoped: each agent has its own timeline
 * - Used for observability and future resume support
 * - Main system can inspect any agent's transcript without modifying it
 */

import type { TranscriptEntry, TranscriptEventType } from './types';
import * as repo from './repository';

// =============================================================================
// Recording
// =============================================================================

interface RecordOptions {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  eventType: TranscriptEventType;
  toolName?: string;
  taskId?: string;
}

/**
 * Append a transcript entry for an agent.
 * This is the primary write API — all lifecycle events should go through here.
 */
export function recordTranscript(agentId: string, options: RecordOptions): TranscriptEntry {
  return repo.appendTranscript({
    id: repo.generateId('tx'),
    agentId,
    role: options.role,
    content: options.content,
    eventType: options.eventType,
    toolName: options.toolName,
    taskId: options.taskId,
    createdAt: Date.now(),
  });
}

// =============================================================================
// Convenience recorders
// =============================================================================

export function recordAgentStarted(agentId: string, prompt: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'system',
    content: prompt,
    eventType: 'agent_started',
  });
}

export function recordUserPrompt(agentId: string, prompt: string, taskId?: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'user',
    content: prompt,
    eventType: 'user_prompt_injected',
    taskId,
  });
}

export function recordAssistantOutput(agentId: string, content: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'assistant',
    content,
    eventType: 'assistant_output',
  });
}

export function recordToolCall(agentId: string, toolName: string, args: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'assistant',
    content: args,
    eventType: 'tool_called',
    toolName,
  });
}

export function recordToolResult(agentId: string, toolName: string, result: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'tool',
    content: result.slice(0, 5000), // cap to avoid bloating storage
    eventType: 'tool_result',
    toolName,
  });
}

export function recordPermissionRequested(
  agentId: string,
  toolName: string,
  taskId?: string,
): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'system',
    content: `Permission requested: ${toolName}`,
    eventType: 'permission_requested',
    toolName,
    taskId,
  });
}

export function recordPermissionResolved(
  agentId: string,
  toolName: string,
  approved: boolean,
  taskId?: string,
): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'system',
    content: `Permission ${approved ? 'approved' : 'denied'}: ${toolName}`,
    eventType: 'permission_resolved',
    toolName,
    taskId,
  });
}

export function recordAgentCompleted(agentId: string, summary?: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'system',
    content: summary || 'Agent completed.',
    eventType: 'agent_completed',
  });
}

export function recordAgentFailed(agentId: string, error?: string): TranscriptEntry {
  return recordTranscript(agentId, {
    role: 'system',
    content: error || 'Agent failed.',
    eventType: 'agent_failed',
  });
}

// =============================================================================
// Querying
// =============================================================================

/**
 * Get full transcript for an agent, sorted chronologically.
 */
export function getAgentTranscript(agentId: string): TranscriptEntry[] {
  return repo.getTranscriptForAgent(agentId);
}

/**
 * Get transcript entries by event type for an agent.
 */
export function getTranscriptByType(
  agentId: string,
  eventType: TranscriptEventType,
): TranscriptEntry[] {
  return repo.getTranscriptForAgent(agentId).filter(e => e.eventType === eventType);
}

/**
 * Get a compact summary of an agent's transcript:
 * how many events of each type, first/last timestamps, etc.
 */
export function getTranscriptSummary(agentId: string): {
  totalEntries: number;
  eventCounts: Record<string, number>;
  firstEntry?: number;
  lastEntry?: number;
  hasErrors: boolean;
} {
  const entries = repo.getTranscriptForAgent(agentId);
  if (entries.length === 0) {
    return { totalEntries: 0, eventCounts: {}, hasErrors: false };
  }

  const eventCounts: Record<string, number> = {};
  let hasErrors = false;
  for (const e of entries) {
    eventCounts[e.eventType] = (eventCounts[e.eventType] || 0) + 1;
    if (e.eventType === 'agent_failed') hasErrors = true;
  }

  return {
    totalEntries: entries.length,
    eventCounts,
    firstEntry: entries[0].createdAt,
    lastEntry: entries[entries.length - 1].createdAt,
    hasErrors,
  };
}

/**
 * Get the most recent N transcript entries for an agent.
 */
export function getRecentTranscript(agentId: string, count: number = 20): TranscriptEntry[] {
  const all = repo.getTranscriptForAgent(agentId);
  return all.slice(-count);
}
