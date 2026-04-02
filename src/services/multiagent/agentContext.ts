/**
 * Agent Context Isolation
 *
 * Provides isolated context for each agent instance.
 * Similar to Claude Code's AsyncLocalStorage approach,
 * but adapted for Tauri's single-process architecture.
 *
 * Based on Claude Code's AsyncLocalStorage context isolation
 */

export interface AgentContext {
  agentId: string;
  sessionId: string;
  name?: string;
  parentId?: string;
  teamName?: string;
  workDir?: string;
  systemPrompt?: string;
  toolPool: string[];
  metadata: Record<string, any>;
}

// Global context store (like AsyncLocalStorage)
const agentContexts = new Map<string, AgentContext>();
let currentAgentId: string | null = null;

/**
 * Run a function within an agent's context.
 */
export async function withAgentContext<T>(
  context: AgentContext,
  fn: () => Promise<T>,
): Promise<T> {
  const previousId = currentAgentId;
  agentContexts.set(context.agentId, context);
  currentAgentId = context.agentId;

  try {
    return await fn();
  } finally {
    currentAgentId = previousId;
    agentContexts.delete(context.agentId);
  }
}

/**
 * Get the current agent context.
 */
export function getCurrentAgentContext(): AgentContext | null {
  if (!currentAgentId) return null;
  return agentContexts.get(currentAgentId) || null;
}

/**
 * Get a specific agent context by ID.
 */
export function getAgentContext(agentId: string): AgentContext | null {
  return agentContexts.get(agentId) || null;
}

/**
 * Create a child agent context (inherits from parent).
 */
export function createChildContext(
  parent: AgentContext,
  overrides: Partial<AgentContext>,
): AgentContext {
  return {
    ...parent,
    ...overrides,
    parentId: parent.agentId,
    toolPool: overrides.toolPool || parent.toolPool,
  };
}

/**
 * Get all active agent contexts.
 */
export function getAllAgentContexts(): AgentContext[] {
  return Array.from(agentContexts.values());
}

/**
 * Check if currently running within an agent context.
 */
export function isInAgentContext(): boolean {
  return currentAgentId !== null;
}
