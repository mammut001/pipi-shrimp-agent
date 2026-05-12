import type {
  AgentRole,
  RoleModelHint,
  WorkflowAgent,
  WorkflowAgentRole,
} from '@/types/workflow';

export const WORKFLOW_AGENT_ROLES: WorkflowAgentRole[] = [
  'planner',
  'writer',
  'developer',
  'reviewer',
  'qa',
  'security',
  'devops',
  'goal-evaluator',
  'custom',
];

const ROLE_ALIASES: Record<string, WorkflowAgentRole> = {
  planner: 'planner',
  writer: 'writer',
  translator: 'writer',
  developer: 'developer',
  coder: 'developer',
  reviewer: 'reviewer',
  qa: 'qa',
  tester: 'qa',
  security: 'security',
  devops: 'devops',
  'goal-evaluator': 'goal-evaluator',
  goal_evaluator: 'goal-evaluator',
  goalevaluator: 'goal-evaluator',
  'data-analyst': 'custom',
  data_analyst: 'custom',
  analyst: 'custom',
  custom: 'custom',
};

export function normalizeWorkflowAgentRole(role?: AgentRole | string | null): WorkflowAgentRole {
  if (!role) return 'custom';
  const normalizedKey = role.trim().toLowerCase().replace(/\s+/g, '-');
  return ROLE_ALIASES[normalizedKey] ?? 'custom';
}

export const ROLE_MODEL_HINTS: RoleModelHint[] = [
  {
    role: 'planner',
    preferredProviders: ['anthropic', 'openai-compatible', 'openai'],
    preferredModelKeywords: ['sonnet', 'gpt-4o', 'planner'],
    reason: 'workflow.roleHint.custom.reason',
  },
  {
    role: 'writer',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.writer.reason',
  },
  {
    role: 'developer',
    preferredProviders: ['openai-compatible', 'anthropic', 'deepseek', 'openai'],
    preferredModelKeywords: ['deepseek', 'coder', 'sonnet', 'gpt-4o'],
    reason: 'workflow.roleHint.coder.reason',
  },
  {
    role: 'reviewer',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.reviewer.reason',
  },
  {
    role: 'qa',
    preferredProviders: ['openai-compatible', 'openai', 'anthropic', 'deepseek'],
    preferredModelKeywords: ['gpt-4o-mini', 'mini', 'haiku', 'deepseek'],
    reason: 'workflow.roleHint.tester.reason',
  },
  {
    role: 'security',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.security.reason',
  },
  {
    role: 'devops',
    preferredProviders: ['anthropic', 'openai-compatible', 'openai'],
    preferredModelKeywords: ['sonnet', 'gpt-4o', 'deepseek'],
    reason: 'workflow.roleHint.devops.reason',
  },
  {
    role: 'goal-evaluator',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.goalEvaluator.reason',
  },
  {
    role: 'custom',
    preferredProviders: ['anthropic', 'openai-compatible', 'openai', 'deepseek'],
    preferredModelKeywords: ['sonnet', 'deepseek', 'gpt'],
    reason: 'workflow.roleHint.custom.reason',
  },
];

export function getRoleModelHint(role?: AgentRole | null): RoleModelHint | undefined {
  const normalizedRole = normalizeWorkflowAgentRole(role);
  return ROLE_MODEL_HINTS.find((hint) => hint.role === normalizedRole);
}

export function normalizeWorkflowRoleHint(roleHint?: string | null): WorkflowAgentRole | undefined {
  if (!roleHint?.trim()) return undefined;
  return normalizeWorkflowAgentRole(roleHint);
}

export function resolveAgentIdByRole(
  agents: WorkflowAgent[],
  roleHint?: string | null,
): string | undefined {
  const normalizedRole = normalizeWorkflowRoleHint(roleHint);
  if (!normalizedRole) return undefined;
  return agents.find((agent) => normalizeWorkflowAgentRole(agent.role) === normalizedRole)?.id;
}