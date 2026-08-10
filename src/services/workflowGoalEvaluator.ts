import type {
  GoalEvaluationResult,
  WorkflowAgent,
  WorkflowInstance,
  WorkflowMarkerCode,
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
当工作流中的所有执行节点（如 Technical Writer, Full Stack Developer, QA Engineer 等）都已经成功执行并产出文档与代码，且产出中没有未修复的错误标识或阻塞项时，你应当判定 reached 为 true。
JSON schema:
{"reached": boolean, "confidence": number, "missing_items": string[], "next_agent_role_hint": string, "reasoning": string}`;

interface LlmEvaluationPayload {
  reached: boolean;
  confidence: number;
  missing_items?: string[];
  missingItems?: string[];
  next_agent_role_hint?: string;
  next_agent_hint?: string;
  nextAgentHint?: string;
  nextAgentRoleHint?: string;
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

const LAZY_STUB_REGEX = /(?:let me|i'll|i will|i am going to|first, i|我先|让我|我来|我会|首先).*(?:check|read|explore|look|examine|analyze|查看|了解|检查|探索|阅读)/i;

export function isLazyPlanningStub(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.length === 0) return true;
  if (parseWorkflowMarkers(trimmed).includes('PASS')) return false;
  if (trimmed.includes('```')) return false;

  const hasMarkdownStructure = /^(?:#|##|###|\d+\.|\*|-)\s+/m.test(trimmed);
  if (hasMarkdownStructure) return false;

  return trimmed.length < 100 && LAZY_STUB_REGEX.test(trimmed);
}

const FAILURE_MARKERS = new Set<WorkflowMarkerCode>([
  'REVIEW_REJECT',
  'TESTS_FAIL_CODE',
  'TESTS_FAIL_SPEC',
  'GOAL_NOT_REACHED',
]);

export function evaluateGoalWithRules(
  context: GoalEvaluationContext,
): GoalEvaluationResult {
  const outputs = Array.from(context.agentOutputs.values());
  const executableAgents = context.agents.filter((agent) => agent.role !== 'goal-evaluator');
  const allAgentsCompleted = executableAgents.length > 0 && executableAgents.every((agent) => Boolean(context.agentOutputs.get(agent.id)));

  const hasFailureMarker = outputs.some((output) => (
    parseWorkflowMarkers(output).some((marker) => FAILURE_MARKERS.has(marker))
  ));

  const missingItems = extractMissingItemsFromOutputs(context.agentOutputs);
  const reached = allAgentsCompleted && !hasFailureMarker;

  return {
    iteration: context.iteration,
    reached,
    confidence: reached ? 0.95 : 0.45,
    missingItems: reached ? [] : missingItems,
    reasoning: reached
      ? '所有 Agent 均已完成且未检测到未达成目标的失败标记，工作流已成功完成。'
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

function extractJsonObjectString(input: string): string {
  let text = input.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

function parseLlmEvaluation(
  rawOutput: string,
  context: GoalEvaluationContext,
): GoalEvaluationResult | null {
  try {
    const jsonStr = extractJsonObjectString(rawOutput);
    const parsed = JSON.parse(jsonStr) as LlmEvaluationPayload;
    return {
      iteration: context.iteration,
      reached: Boolean(parsed.reached),
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : DEFAULT_CONFIDENCE,
      missingItems: Array.isArray(parsed.missing_items)
        ? parsed.missing_items.filter(Boolean)
        : Array.isArray(parsed.missingItems)
          ? parsed.missingItems.filter(Boolean)
          : [],
      nextAgentIdHint: resolveNextAgentReference(
        context.agents,
        parsed.next_agent_role_hint || parsed.next_agent_hint || parsed.nextAgentHint || parsed.nextAgentRoleHint,
      ),
      reasoning: parsed.reasoning?.trim() || 'LLM evaluator returned no reasoning.',
      rawOutput,
      timestamp: Date.now(),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[workflowGoalEvaluator] Failed to parse LLM evaluation JSON:', err, 'raw:', rawOutput);
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
  const executableAgents = context.agents.filter((agent) => agent.role !== 'goal-evaluator');
  const completedAgentIds = executableAgents
    .filter((agent) => Boolean(context.agentOutputs.get(agent.id)))
    .map((agent) => `${agent.name}(${agent.id})`);

  // eslint-disable-next-line no-console
  console.info(`[workflowGoalEvaluator] Iteration ${context.iteration} rule evaluation:`, {
    ruleReached: ruleResult.reached,
    completedCount: `${completedAgentIds.length}/${executableAgents.length}`,
    completedAgents: completedAgentIds,
    missingItems: ruleResult.missingItems,
  });

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
  const systemPromptOverride = isBuiltInEvaluator(evaluatorAgent)
    ? GOAL_EVALUATOR_SYSTEM_PROMPT
    : undefined;

  try {
    const rawOutput = await runAgent(evaluatorAgent, prompt, { systemPromptOverride });
    const parsed = parseLlmEvaluation(rawOutput, context);

    // eslint-disable-next-line no-console
    console.info(`[workflowGoalEvaluator] Iteration ${context.iteration} LLM evaluation result:`, {
      parsedReached: parsed?.reached,
      nextAgentIdHint: parsed?.nextAgentIdHint,
      missingItems: parsed?.missingItems,
      reasoning: parsed?.reasoning,
      rawOutputSnippet: rawOutput.slice(0, 150),
    });

    if (parsed) {
      if (ruleResult.reached && !parsed.reached) {
        // eslint-disable-next-line no-console
        console.info(`[workflowGoalEvaluator] Overriding LLM parsed.reached=false to true because ruleResult.reached=true (all pipeline nodes executed cleanly without failure markers)`);
        return {
          ...parsed,
          reached: true,
          nextAgentIdHint: undefined,
          reasoning: `${parsed.reasoning}（全量 Agent 节点 A→B→C 已执行完成且无显式失败标记）`,
        };
      }
      return parsed;
    }
    return {
      ...ruleResult,
      rawOutput,
      reasoning: `${ruleResult.reasoning}（LLM evaluator JSON 解析失败，已回退到规则判定。）`,
    };
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted')))
    ) {
      throw error;
    }
    return {
      ...ruleResult,
      rawOutput: undefined,
      reasoning: `${ruleResult.reasoning}（LLM evaluator 执行失败，已回退到规则判定：${errorMessage(error)}）`,
    };
  }
}
