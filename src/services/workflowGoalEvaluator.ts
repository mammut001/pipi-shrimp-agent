import type {
  GoalEvaluationResult,
  WorkflowAgent,
  WorkflowInstance,
} from '@/types/workflow';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import {
  parseWorkflowMarkers,
} from '@/services/workflow/templates/markers';
import { resolveAgentIdByRole } from '@/services/workflow/templates/roles';
import {
  parseAgentStatusBlock,
} from './workflowPromptBuilder';

const DEFAULT_CONFIDENCE = 0.6;
const MAX_OUTPUT_CHARS = 4000;

const GOAL_EVALUATOR_SYSTEM_PROMPT = `你是一名严格的工作流目标评估官。
你必须只输出严格 JSON，不要输出 Markdown，不要输出解释性前后缀。
JSON schema:
{"reached": boolean, "confidence": number, "missing_items": string[], "next_agent_role_hint": string, "reasoning": string}`;

interface LlmEvaluationPayload {
  reached: boolean;
  confidence: number;
  missing_items?: string[];
  next_agent_role_hint?: string;
  reasoning?: string;
}

export interface GoalEvaluationContext {
  instance: WorkflowInstance;
  agents: WorkflowAgent[];
  agentOutputs: Map<string, string>;
  iteration: number;
}

export interface GoalEvaluatorDeps {
  runAgent?: (
    agent: WorkflowAgent,
    prompt: string,
    options?: { systemPromptOverride?: string },
  ) => Promise<string>;
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  // Slice on a code-point boundary so we never hand the LLM a malformed
  // UTF-16 surrogate (which would render as U+FFFD in the prompt).
  const truncated = Array.from(output).slice(0, MAX_OUTPUT_CHARS).join('');
  return `${truncated}\n... [truncated]`;
}

function resolveNextAgentReference(
  agents: WorkflowAgent[],
  roleHint?: string,
): string | undefined {
  if (!roleHint) return undefined;
  const resolved = resolveAgentIdByRole(agents, roleHint)
    ?? agents.find((agent) => agent.id === roleHint || agent.name === roleHint)?.id;
  if (!resolved) return undefined;
  // Defensive: never point the workflow back at the goal-evaluator itself,
  // which would create a self-loop on the next iteration. Look up the
  // resolved agent and bail out if it is the evaluator role.
  const target = agents.find((agent) => agent.id === resolved);
  if (target?.role === 'goal-evaluator') return undefined;
  return resolved;
}

function extractMissingItemsFromOutputs(outputs: Map<string, string>): string[] {
  const items = new Set<string>();

  for (const output of outputs.values()) {
    const markers = parseWorkflowMarkers(output);

    if (markers.includes('GOAL_NOT_REACHED')) {
      items.add('存在未满足的总体目标项。');
    }
    if (markers.includes('REVIEW_REJECT')) {
      items.add('代码审查仍有未修复问题。');
    }
    if (markers.includes('TESTS_FAIL_CODE')) {
      items.add('测试仍发现代码缺陷。');
    }
    if (markers.includes('TESTS_FAIL_SPEC')) {
      items.add('需求或文档仍需澄清。');
    }

    const status = parseAgentStatusBlock(output);
    if (status?.needs_followup && status.goal_progress) {
      items.add(status.goal_progress);
    }
  }

  return Array.from(items);
}

export function evaluateGoalWithRules(
  context: GoalEvaluationContext,
): GoalEvaluationResult {
  const outputs = Array.from(context.agentOutputs.values());
  const allAgentsCompleted = context.agents
    .filter((agent) => agent.role !== 'goal-evaluator')
    .every((agent) => Boolean(context.agentOutputs.get(agent.id)));

  const hasFailureMarker = outputs.some((output) => (
    parseWorkflowMarkers(output).some((marker) => marker !== 'PASS')
  ));

  const missingItems = extractMissingItemsFromOutputs(context.agentOutputs);
  const reached = allAgentsCompleted && !hasFailureMarker;

  return {
    iteration: context.iteration,
    reached,
    confidence: reached ? 0.7 : 0.45,
    missingItems: reached ? [] : missingItems,
    reasoning: reached
      ? '所有 Agent 已完成且未检测到未达成目标的失败标记。'
      : '检测到未达成目标的显式标记，或仍有 Agent 输出提示需要继续跟进。',
    timestamp: Date.now(),
  };
}

function buildGoalEvaluatorPrompt(context: GoalEvaluationContext): string {
  const outputBlocks = context.agents
    .filter((agent) => context.agentOutputs.has(agent.id))
    .map((agent) => {
      const output = truncateOutput(context.agentOutputs.get(agent.id) ?? '');
      return `## Agent: ${agent.name}\nrole: ${agent.role ?? 'custom'}\n\n${output}`;
    })
    .join('\n\n---\n\n');

  return [
    `Project Goal:\n${context.instance.projectGoal?.trim() || ''}`,
    `Success Criteria:\n${context.instance.successCriteria?.trim() || ''}`,
    'You must evaluate whether the project goal is reached based on the final outputs below.',
    outputBlocks || 'No agent outputs were produced.',
    'Return strict JSON only.',
  ].join('\n\n');
}

function parseLlmEvaluation(
  rawOutput: string,
  context: GoalEvaluationContext,
): GoalEvaluationResult | null {
  try {
    const parsed = JSON.parse(rawOutput.trim()) as LlmEvaluationPayload;
    return {
      iteration: context.iteration,
      reached: Boolean(parsed.reached),
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : DEFAULT_CONFIDENCE,
      missingItems: Array.isArray(parsed.missing_items) ? parsed.missing_items.filter(Boolean) : [],
      nextAgentIdHint: resolveNextAgentReference(context.agents, parsed.next_agent_role_hint),
      reasoning: parsed.reasoning?.trim() || 'LLM evaluator returned no reasoning.',
      rawOutput,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function createBuiltInEvaluatorAgent(): WorkflowAgent {
  const template = AGENT_TEMPLATES.find((item) => item.id === 'goal-evaluator');

  return {
    id: 'builtin-goal-evaluator',
    name: template?.name || 'Goal Evaluator',
    soulPrompt: GOAL_EVALUATOR_SYSTEM_PROMPT,
    task: template?.task || '判定项目目标是否达成',
    taskPrompt: template?.taskPrompt,
    taskInstruction: template?.taskInstruction,
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role: 'goal-evaluator',
  };
}

function isBuiltInEvaluator(agent: WorkflowAgent): boolean {
  return agent.id === 'builtin-goal-evaluator';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}

export async function evaluateWorkflowGoal(
  context: GoalEvaluationContext,
  deps: GoalEvaluatorDeps = {},
): Promise<GoalEvaluationResult> {
  const ruleResult = evaluateGoalWithRules(context);
  const runAgent = deps.runAgent;

  if (!runAgent) {
    return ruleResult;
  }

  const evaluatorAgent = context.instance.goalEvaluatorAgentId
    ? context.agents.find((agent) => agent.id === context.instance.goalEvaluatorAgentId)
    : createBuiltInEvaluatorAgent();

  if (!evaluatorAgent) {
    return ruleResult;
  }

  const prompt = buildGoalEvaluatorPrompt(context);
  // The built-in evaluator has no real agent config; it relies on the
  // bundled system prompt. Custom evaluators use their own soulPrompt.
  const systemPromptOverride = isBuiltInEvaluator(evaluatorAgent)
    ? GOAL_EVALUATOR_SYSTEM_PROMPT
    : undefined;

  try {
    const rawOutput = await runAgent(evaluatorAgent, prompt, { systemPromptOverride });
    const parsed = parseLlmEvaluation(rawOutput, context);
    return parsed ?? {
      ...ruleResult,
      rawOutput,
      reasoning: `${ruleResult.reasoning}（LLM evaluator JSON 解析失败，已回退到规则判定。）`,
    };
  } catch (error) {
    return {
      ...ruleResult,
      rawOutput: undefined,
      reasoning: `${ruleResult.reasoning}（LLM evaluator 执行失败，已回退到规则判定：${errorMessage(error)}）`,
    };
  }
}
