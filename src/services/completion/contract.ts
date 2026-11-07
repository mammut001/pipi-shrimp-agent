import type { WorkflowAgent } from '@/types/workflow';
export interface AcceptanceCommand {
  command: string;
  timeoutMs?: number;
}

export interface CompletionContract {
  requireNonEmpty: boolean;
  requireDeliveryReport: boolean;
  acceptanceCommands: AcceptanceCommand[];
  maxRepairTurns: number;
  /** When set, acceptance failures retry across the agent's fallback model configs. */
  retryOnStrongerModel?: boolean;
}

export interface CompletionRecord {
  status: 'pass' | 'failed';
  repairs: number;
  reasons: string[];
  /** Model config ids actually used, when stronger-model retry ran. */
  modelTrail?: string[];
  /** Token usage accumulated across repair turns. */
  tokenUsage?: { input_tokens: number; output_tokens: number; model?: string };
  /** Estimated cost in USD, when pricing is known. */
  estimatedCostUsd?: number | null;
}

export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 120_000;
export const COMPLETION_MAX_REPAIR_TURNS = 1;

export function defaultCompletionContract(): CompletionContract {
  return {
    requireNonEmpty: true,
    requireDeliveryReport: true,
    acceptanceCommands: [],
    maxRepairTurns: COMPLETION_MAX_REPAIR_TURNS,
    retryOnStrongerModel: false,
  };
}

export function normalizeAcceptanceCommands(raw: unknown): AcceptanceCommand[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AcceptanceCommand[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const command = item.trim();
      if (command) {
        out.push({ command });
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const candidate = item as { command?: unknown; timeoutMs?: unknown };
      if (typeof candidate.command === 'string' && candidate.command.trim()) {
        const entry: AcceptanceCommand = { command: candidate.command.trim() };
        if (typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs) && candidate.timeoutMs > 0) {
          entry.timeoutMs = Math.floor(candidate.timeoutMs);
        }
        out.push(entry);
      }
    }
  }
  return out;
}

export function parseAcceptanceCommandsText(text: string): AcceptanceCommand[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((command) => ({ command }));
}

export function formatAcceptanceCommandsText(commands: AcceptanceCommand[]): string {
  return commands.map((item) => item.command).join('\n');
}

export function buildWorkflowCompletionContract(
  agent: { role?: WorkflowAgent['role']; acceptanceCommands?: unknown; retryPolicy?: WorkflowAgent['retryPolicy'] },
  instance: { acceptanceCommands?: unknown },
): CompletionContract {
  const agentCommands = normalizeAcceptanceCommands(agent.acceptanceCommands);
  const instanceCommands = normalizeAcceptanceCommands(instance.acceptanceCommands);
  const fallbackIds = agent.retryPolicy?.fallbackConfigIds ?? [];
  return {
    requireNonEmpty: true,
    requireDeliveryReport: true,
    acceptanceCommands: agentCommands.length > 0 ? agentCommands : instanceCommands,
    maxRepairTurns: COMPLETION_MAX_REPAIR_TURNS,
    retryOnStrongerModel: fallbackIds.length > 0,
  };
}

export function shouldAttachWorkflowCompletionContract(
  agent: Pick<WorkflowAgent, 'role'>,
  noTools?: boolean,
): boolean {
  if (noTools) {
    return false;
  }
  return agent.role !== 'goal-evaluator';
}

export function buildSessionGoalCompletionContract(
  goal: { acceptanceCommands?: unknown },
): CompletionContract {
  return {
    requireNonEmpty: true,
    requireDeliveryReport: false,
    acceptanceCommands: normalizeAcceptanceCommands(goal.acceptanceCommands),
    maxRepairTurns: COMPLETION_MAX_REPAIR_TURNS,
  };
}
