/**
 * Reactive Compact - Event-Driven Compression
 *
 * Triggers compaction immediately when key events occur, rather than waiting
 * for the next timed check. This improves context management for:
 * - Topic changes: User switches to a new task
 * - Task completion: Clear signal that a task is done
 * - Long silence: User has been idle for an extended period
 * - Long tool output: Single tool result is very large
 *
 * Source reference: restored-src/src/services/compact/reactiveCompact.ts
 */

import type { Message } from '../../types/chat';
import { runMicrocompactCheck } from './microCompact';
import { getCompactConfig } from './config';
import { detectTopicChange as contextDetectTopicChange, detectTaskCompletion as contextDetectTaskCompletion } from '../../utils/contextAnalysis';

// ============================================================================
// Event Types
// ============================================================================

export type ReactiveEventType =
  | 'topic_change'
  | 'task_complete'
  | 'long_idle'
  | 'long_tool_output';

export interface ReactiveEvent {
  type: ReactiveEventType;
  sessionId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ReactiveCompactResult {
  did_compact: boolean;
  event_type?: ReactiveEventType;
  updates?: unknown[];
}

// ============================================================================
// Topic Change Detection
// ============================================================================

/**
 * Detect if a new user message represents a topic change from previous conversation.
 *
 * Uses context analysis utility for more sophisticated detection.
 */
function detectTopicChange(
  newMessage: string,
  previousMessages: Message[],
  threshold: number = 0.3,
): boolean {
  // Use the context analysis utility
  const result = contextDetectTopicChange(previousMessages, [{ role: 'user', content: newMessage } as Message], threshold);
  return result.changed;
}

// ============================================================================
// Task Completion Detection
// ============================================================================

/**
 * Detect if the last assistant message indicates task completion.
 *
 * Uses context analysis utility for pattern matching.
 */
function detectTaskCompletion(messages: Message[]): boolean {
  const result = contextDetectTaskCompletion(messages);
  return result.completed;
}

// ============================================================================
// Long Idle Detection
// ============================================================================

interface IdleState {
  last_user_message_at?: number;
  last_check_at?: number;
}

const IDLE_STATE_KEY = 'pipi-shrimp-idle-state';

function getIdleState(sessionId: string): IdleState {
  try {
    const stored = localStorage.getItem(`${IDLE_STATE_KEY}-${sessionId}`);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function setIdleState(sessionId: string, state: IdleState): void {
  localStorage.setItem(`${IDLE_STATE_KEY}-${sessionId}`, JSON.stringify(state));
}

function detectLongIdle(sessionId: string, idleMinutesThreshold: number): boolean {
  const state = getIdleState(sessionId);
  const now = Date.now();

  if (!state.last_user_message_at) {
    // First check, just record time
    setIdleState(sessionId, { last_user_message_at: now, last_check_at: now });
    return false;
  }

  const idleMs = now - state.last_user_message_at;
  const idleMinutes = idleMs / (1000 * 60);

  // Update check time
  setIdleState(sessionId, { ...state, last_check_at: now });

  return idleMinutes >= idleMinutesThreshold;
}

function recordUserActivity(sessionId: string): void {
  const state = getIdleState(sessionId);
  setIdleState(sessionId, { ...state, last_user_message_at: Date.now() });
}

// ============================================================================
// Long Tool Output Detection
// ============================================================================

const TOOL_OUTPUT_KEY = 'pipi-shrimp-tool-outputs';

interface ToolOutputRecord {
  sessionId: string;
  toolId: string;
  toolName: string;
  outputLength: number;
  timestamp: number;
}

function getRecentToolOutputs(sessionId: string): ToolOutputRecord[] {
  try {
    const stored = localStorage.getItem(`${TOOL_OUTPUT_KEY}-${sessionId}`);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function recordToolOutput(
  sessionId: string,
  toolId: string,
  toolName: string,
  outputLength: number,
): void {
  const outputs = getRecentToolOutputs(sessionId);
  outputs.push({ sessionId, toolId, toolName, outputLength, timestamp: Date.now() });

  // Keep only last 20 records
  const trimmed = outputs.slice(-20);
  localStorage.setItem(`${TOOL_OUTPUT_KEY}-${sessionId}`, JSON.stringify(trimmed));
}

function detectLongToolOutput(sessionId: string, lengthThreshold: number = 10000): boolean {
  const outputs = getRecentToolOutputs(sessionId);
  const recentOutputs = outputs.filter((o) => Date.now() - o.timestamp < 60000); // Last minute

  for (const output of recentOutputs) {
    if (output.outputLength > lengthThreshold) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Main Reactive Compact Handler
// ============================================================================

/**
 * Check all reactive events and trigger compaction if any event fires.
 *
 * Called after each streaming turn completes.
 *
 * Events checked (in order):
 * 1. Topic change - user switched to new task
 * 2. Task completion - session appears to be done
 * 3. Long idle - user hasn't said anything in a while
 * 4. Long tool output - a tool produced very large output
 */
export async function checkReactiveCompact(
  sessionId: string,
  messages: Message[],
  newUserMessage?: string,
): Promise<ReactiveCompactResult> {
  const config = getCompactConfig();

  // 1. Check topic change (only if there's a new user message)
  if (newUserMessage) {
    if (detectTopicChange(newUserMessage, messages)) {
      console.log('[ReactiveCompact] Topic change detected');
      const result = await runMicrocompactCheck(sessionId);
      if (result.did_compact) {
        return { did_compact: true, event_type: 'topic_change', updates: result.updates };
      }
    }

    // Record user activity for idle detection
    recordUserActivity(sessionId);
  }

  // 2. Check task completion
  if (detectTaskCompletion(messages)) {
    console.log('[ReactiveCompact] Task completion detected');
    const result = await runMicrocompactCheck(sessionId);
    if (result.did_compact) {
      return { did_compact: true, event_type: 'task_complete', updates: result.updates };
    }
  }

  // 3. Check long idle (only if no new user message this turn)
  if (!newUserMessage) {
    const idleThreshold = config.micro_idle_minutes || 60;
    if (detectLongIdle(sessionId, idleThreshold)) {
      console.log('[ReactiveCompact] Long idle detected');
      const result = await runMicrocompactCheck(sessionId);
      if (result.did_compact) {
        return { did_compact: true, event_type: 'long_idle', updates: result.updates };
      }
    }
  }

  // 4. Check long tool output (from recent tools)
  if (detectLongToolOutput(sessionId)) {
    console.log('[ReactiveCompact] Long tool output detected');
    const result = await runMicrocompactCheck(sessionId);
    if (result.did_compact) {
      return { did_compact: true, event_type: 'long_tool_output', updates: result.updates };
    }
  }

  return { did_compact: false };
}

/**
 * Record a tool execution output for long output detection.
 * Call this after each tool completes.
 */
export function recordToolForReactiveCompact(
  sessionId: string,
  toolId: string,
  toolName: string,
  output: string,
): void {
  recordToolOutput(sessionId, toolId, toolName, output.length);

  // Also check immediately if this is a long output
  if (output.length > 10000) {
    console.log(`[ReactiveCompact] Long tool output detected: ${toolName} (${output.length} chars)`);
  }
}

// ============================================================================
// Event API (for external event system integration)
// ============================================================================

/**
 * Emit a reactive event manually.
 * Useful for integrating with external event systems.
 */
export async function emitReactiveEvent(
  event: ReactiveEvent,
): Promise<ReactiveCompactResult> {
  const { useChatStore } = await import('../../store/chatStore');
  const session = useChatStore.getState().sessions.find((s) => s.id === event.sessionId);
  if (!session) {
    return { did_compact: false };
  }

  switch (event.type) {
    case 'topic_change':
      // Topic change requires the new message content
      if (event.metadata?.newMessage) {
        return checkReactiveCompact(
          event.sessionId,
          session.messages,
          event.metadata.newMessage as string,
        );
      }
      break;

    case 'long_idle':
      return checkReactiveCompact(event.sessionId, session.messages);

    case 'task_complete':
      return checkReactiveCompact(event.sessionId, session.messages);

    case 'long_tool_output':
      // Already handled via recordToolForReactiveCompact
      break;
  }

  return { did_compact: false };
}
