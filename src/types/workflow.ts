/**
 * Workflow Types - Multi-agent workflow system type definitions
 */

import type { ProviderName } from '@/shared/providers';
import type { WorkflowVisionPolicy } from './vision';

// ============ Execution Config ============

export type ExecutionMode = 'single' | 'multi-round';

export type RoundCondition = 'untilComplete' | 'untilError' | 'fixed';

export interface AgentExecutionConfig {
  mode: ExecutionMode;
  maxRounds?: number;
  roundCondition?: RoundCondition;
}

export const DEFAULT_EXECUTION_CONFIG: AgentExecutionConfig = {
  mode: 'single',
};

// ============ Agent Role ============

export type AgentRole =
  | 'writer'
  | 'coder'
  | 'tester'
  | 'reviewer'
  | 'security'
  | 'devops'
  | 'data-analyst'
  | 'translator'
  | 'goal-evaluator'
  | 'custom';

export interface RoleModelHint {
  role: AgentRole;
  preferredProviders: ProviderName[];
  preferredModelKeywords: string[];
  reason: string;
}

export const ROLE_MODEL_HINTS: RoleModelHint[] = [
  {
    role: 'writer',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.writer.reason',
  },
  {
    role: 'coder',
    preferredProviders: ['openai-compatible', 'anthropic', 'deepseek', 'openai'],
    preferredModelKeywords: ['deepseek', 'coder', 'sonnet', 'gpt-4o'],
    reason: 'workflow.roleHint.coder.reason',
  },
  {
    role: 'tester',
    preferredProviders: ['openai-compatible', 'openai', 'anthropic', 'deepseek'],
    preferredModelKeywords: ['gpt-4o-mini', 'mini', 'haiku', 'deepseek'],
    reason: 'workflow.roleHint.tester.reason',
  },
  {
    role: 'reviewer',
    preferredProviders: ['anthropic'],
    preferredModelKeywords: ['opus', 'sonnet'],
    reason: 'workflow.roleHint.reviewer.reason',
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
    role: 'data-analyst',
    preferredProviders: ['anthropic', 'openai'],
    preferredModelKeywords: ['sonnet', 'gpt-4o'],
    reason: 'workflow.roleHint.dataAnalyst.reason',
  },
  {
    role: 'translator',
    preferredProviders: ['anthropic', 'openai'],
    preferredModelKeywords: ['sonnet', 'gpt-4o-mini'],
    reason: 'workflow.roleHint.translator.reason',
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
  if (!role) return undefined;
  return ROLE_MODEL_HINTS.find((hint) => hint.role === role);
}

// ============ Retry Policy ============

export interface AgentRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  fallbackConfigIds?: string[];
}

export const DEFAULT_RETRY_POLICY: AgentRetryPolicy = {
  maxAttempts: 3,
  backoffMs: 1500,
};

export const DEFAULT_MAX_GOAL_ITERATIONS = 5;

// ============ Output Routes ============

export type RouteCondition = 'onComplete' | 'onError' | 'outputContains' | 'always';

export type RouteKeywordMode = 'includes' | 'regex';

export interface OutputRoute {
  id: string;
  condition: RouteCondition;
  keyword?: string;
  keywordMode?: RouteKeywordMode;
  targetAgentId: string;
}

// ============ Agent Node ============

export interface WorkflowAgentModel {
  configId?: string;
  provider?: ProviderName;
  modelId?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface WorkflowAgent {
  id: string;
  name: string;
  soulPrompt?: string;
  task?: string;
  taskPrompt?: string;
  taskInstruction?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  outputRoutes: OutputRoute[];
  execution: AgentExecutionConfig;
  model?: WorkflowAgentModel;
  inputFrom?: string | null;
  role?: AgentRole;
  retryPolicy?: AgentRetryPolicy;
  notifyOnComplete?: string[];
  visionPolicy?: WorkflowVisionPolicy;
}

// ============ Connection ============

export type ConnectionType = 'sequential' | 'parallel';

export interface WorkflowConnection {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  condition: string;
  type?: ConnectionType;
}

// ============ Goal Evaluation ============

export interface GoalEvaluationResult {
  iteration: number;
  reached: boolean;
  confidence: number;
  missingItems: string[];
  nextAgentIdHint?: string;
  reasoning: string;
  rawOutput?: string;
  timestamp: number;
}

// ============ Workflow Run (History) ============

export interface WorkflowRunAgentEntry {
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  output?: string;
  iteration?: number;
}

export interface WorkflowRun {
  id: string;
  title: string;
  projectGoal: string;
  successCriteria?: string;
  status: 'idle' | 'running' | 'completed' | 'completed-not-reached' | 'error' | 'stopped';
  startTime: number;
  endTime?: number;
  agents: WorkflowRunAgentEntry[];
  runDirectory?: string;
  sessionId?: string;
  currentIteration?: number;
  goalEvaluations?: GoalEvaluationResult[];
  reachedGoal?: boolean;
}

// ============ Workflow Instance ============

export interface WorkflowInstance {
  id: string;
  name: string;
  projectGoal?: string;
  successCriteria?: string;
  goalEvaluatorAgentId?: string | null;
  maxGoalIterations?: number;
  agents: WorkflowAgent[];
  connections: WorkflowConnection[];
  workflowRuns: WorkflowRun[];
  activeRunId: string | null;
  dirtyAgentIds?: string[];
  createdAt: number;
  updatedAt: number;
}

// ============ Global State ============

export interface WorkflowState {
  instances: WorkflowInstance[];
  currentInstanceId: string | null;
  isRunning: boolean;
  currentRunningAgentId: string | null;
  selectedRunId: string | null;
  selectedPreviewFile: string | null;
}

// ============ Agent Templates ============

export interface AgentTemplate {
  id: string;
  name: string;
  color: string;
  task: string;
  taskPrompt?: string;
  taskInstruction?: string;
  soulPrompt: string;
  execution: AgentExecutionConfig;
  recommendedRole?: AgentRole;
  recommendedModelHints?: RoleModelHint[];
}

function hintFor(role: AgentRole): RoleModelHint[] {
  return ROLE_MODEL_HINTS.filter((hint) => hint.role === role);
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tech-writer',
    name: 'Technical Writer',
    color: '#3B82F6',
    task: '根据用户需求编写详细的需求文档',
    taskPrompt: '请基于当前项目或上游输入，产出一份结构完整、可供后续开发使用的需求/设计文档。',
    taskInstruction: `根据上游提供的用户需求（或项目目标），撰写一份结构完整的需求文档。

文档必须包含：
1. 项目标题与目标（2-3句话）
2. 功能需求（编号列表）
3. 边界情况与约束
4. 示例输入/输出（至少2-3个）

不要写任何代码，不要做实现。你的输出是供下游开发者或评审者使用的设计文档。`,
    execution: { mode: 'single' },
    soulPrompt: `你是一名专业的技术文档撰写员和需求分析师。你的唯一工作是编写清晰、完整的需求文档。`,
    recommendedRole: 'writer',
    recommendedModelHints: hintFor('writer'),
  },
  {
    id: 'fullstack-dev',
    name: 'Full Stack Developer',
    color: '#10B981',
    task: '根据需求文档编写生产级代码',
    taskPrompt: '请基于上游需求文档，完成可运行的生产级实现，并给出简短实现说明。',
    taskInstruction: `仔细阅读上游（通常是技术写作者）提供的需求文档，然后编写完整的生产级代码。

你的输出必须包含：
1. 完整源代码（标明文件名和语言）
2. 简短的实现说明（设计决策与运行说明）

注意：
- 如果上游包含代码审查报告且结论为 [[REVIEW_REJECT]]，先修复报告中列出的所有问题，再提交代码
- 不要写需求文档，不要跑测试`,
    execution: { mode: 'single' },
    soulPrompt: `你是一名专业的全栈软件开发工程师。你的唯一工作是编写生产级代码。`,
    recommendedRole: 'coder',
    recommendedModelHints: hintFor('coder'),
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    color: '#8B5CF6',
    task: '审查代码质量并给出 PASS/REJECT 结论',
    taskPrompt: '请对上游代码做严格审查，明确指出问题、风险，并给出 PASS/REJECT 结论。',
    taskInstruction: `审查上游开发者产出的代码。评估可读性、安全漏洞、性能、错误处理。

在输出的最后一行必须输出：
- [[REVIEW_PASS]] — 代码质量良好，无需修改
- [[REVIEW_REJECT]] — 存在需修复的问题

给出具体、可操作的反馈，而不仅仅是 PASS/REJECT。`,
    execution: { mode: 'single' },
    soulPrompt: `你是一名严格但公正的高级代码审查员。你必须给出具体审查意见，并以 [[REVIEW_PASS]] 或 [[REVIEW_REJECT]] 结束。`,
    recommendedRole: 'reviewer',
    recommendedModelHints: hintFor('reviewer'),
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    color: '#EF4444',
    task: '编写并执行测试，直到所有测试通过',
    taskPrompt: '请基于上游需求和代码输出，设计测试、分析失败原因，并给出明确路由结论。',
    taskInstruction: `基于上游的需求文档和代码输出，编写测试用例并运行测试。

对于每个失败的测试，分析是“代码 bug”还是“需求理解错误”，并给出明确的修复指令。

在输出末尾使用路由标签：
- [[TESTS_PASS]] — 所有测试通过
- [[TESTS_FAIL_CODE]] — 代码有 bug，需要 Developer 修复
- [[TESTS_FAIL_SPEC]] — 需求不清晰，需要 Writer 澄清`,
    execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
    soulPrompt: `你是一名严谨的 QA 工程师。你的职责不只是测试，而是定位问题根源，并以 [[TESTS_PASS]]、[[TESTS_FAIL_CODE]] 或 [[TESTS_FAIL_SPEC]] 明确收尾。`,
    recommendedRole: 'tester',
    recommendedModelHints: hintFor('tester'),
  },
  {
    id: 'security-auditor',
    name: 'Security Auditor',
    color: '#F59E0B',
    task: '对代码进行安全漏洞审计',
    taskPrompt: '请从架构、认证、输入验证、数据保护等角度对当前实现进行安全审计。',
    taskInstruction: '审查上游代码和架构，识别安全漏洞（参考 OWASP Top 10），输出漏洞列表、详细描述和具体修复方案。',
    execution: { mode: 'single' },
    soulPrompt: '你是一名网络安全专家，专注于应用安全审计。',
    recommendedRole: 'security',
    recommendedModelHints: hintFor('security'),
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    color: '#EC4899',
    task: '创建 CI/CD 流程和部署配置',
    taskPrompt: '请为当前项目补齐部署、容器化和 CI/CD 所需配置，并提供落地步骤。',
    taskInstruction: '分析上游代码，确定语言/框架/依赖，然后编写 Dockerfile、docker-compose.yml 或 GitHub Actions 配置，并提供部署指南。',
    execution: { mode: 'single' },
    soulPrompt: '你是一名经验丰富的 DevOps 工程师，专注于 CI/CD 和部署自动化。',
    recommendedRole: 'devops',
    recommendedModelHints: hintFor('devops'),
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    color: '#EAB308',
    task: '分析数据并提供可视化建议',
    taskPrompt: '请分析当前数据或数据描述，输出关键洞察、质量问题和推荐的可视化方案。',
    execution: { mode: 'single' },
    soulPrompt: '你是一名数据分析师，负责提取关键洞察并提出合适的可视化建议。',
    recommendedRole: 'data-analyst',
    recommendedModelHints: hintFor('data-analyst'),
  },
  {
    id: 'translator',
    name: 'Translator',
    color: '#06B6D4',
    task: '将内容翻译成目标语言',
    taskPrompt: '请把上游内容准确翻译成目标语言，同时保留术语一致性和原始结构。',
    execution: { mode: 'single' },
    soulPrompt: '你是一名专业翻译，需要在保留结构和术语一致性的前提下完成高质量翻译。',
    recommendedRole: 'translator',
    recommendedModelHints: hintFor('translator'),
  },
  {
    id: 'goal-evaluator',
    name: 'Goal Evaluator',
    color: '#0EA5E9',
    task: '判定项目目标是否达成',
    taskPrompt: '请阅读 projectGoal、successCriteria 和所有 agent 的最终输出，判断项目目标是否已经达成。',
    taskInstruction: '阅读 projectGoal、successCriteria 和所有 agent 的最终输出，按指定 JSON 格式输出评估结果。',
    soulPrompt: '你是一名严格的工作流目标评估官。你必须只输出严格 JSON: {"reached": bool, "confidence": 0-1, "missing_items": [...], "next_agent_role_hint": string, "reasoning": string }。不要输出任何额外文字。',
    execution: { mode: 'single' },
    recommendedRole: 'goal-evaluator',
    recommendedModelHints: hintFor('goal-evaluator'),
  },
];

// ============ Color Palette ============

export const AGENT_COLORS = [
  '#10B981',
  '#8B5CF6',
  '#F59E0B',
  '#EF4444',
  '#3B82F6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#6366F1',
];
