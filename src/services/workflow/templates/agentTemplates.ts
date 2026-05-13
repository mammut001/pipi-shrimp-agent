import type {
  AgentTemplate,
  RoleModelHint,
  WorkflowAgentRole,
  WorkflowMarkerCode,
} from '@/types/workflow';
import { DEFAULT_EXECUTION_CONFIG } from '@/services/workflow/defaults';
import {
  ROLE_MODEL_HINTS,
  normalizeWorkflowAgentRole,
} from './roles';
import { buildWorkflowMarkerToken } from './markers';
import { AUTORESEARCH_BOOTSTRAP_TEMPLATE } from '@/services/agents/templates/autoresearchBootstrap';

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

function hintFor(role: WorkflowAgentRole): RoleModelHint[] {
  return ROLE_MODEL_HINTS.filter((hint) => hint.role === normalizeWorkflowAgentRole(role));
}

function defaultMarkers(...markers: WorkflowMarkerCode[]): WorkflowMarkerCode[] {
  return markers;
}

const PASS_MARKER = buildWorkflowMarkerToken('PASS');
const REVIEW_REJECT_MARKER = buildWorkflowMarkerToken('REVIEW_REJECT');
const TESTS_FAIL_CODE_MARKER = buildWorkflowMarkerToken('TESTS_FAIL_CODE');
const TESTS_FAIL_SPEC_MARKER = buildWorkflowMarkerToken('TESTS_FAIL_SPEC');
const GOAL_NOT_REACHED_MARKER = buildWorkflowMarkerToken('GOAL_NOT_REACHED');

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tech-writer',
    name: 'Technical Writer',
    color: '#3B82F6',
    task: '根据用户需求编写详细的需求文档',
    taskPrompt: '请基于当前项目或上游输入，产出一份结构完整、可供后续开发使用的需求/设计文档。',
    taskInstruction: `根据上游提供的用户需求或项目目标，撰写一份结构完整的需求文档。

文档必须包含：
1. 项目标题与目标（2-3句话）
2. 功能需求（编号列表）
3. 边界情况与约束
4. 示例输入/输出（至少2-3个）

不要写任何代码，不要做实现。
如果已满足目标，请在结尾输出 ${PASS_MARKER}；如果目标仍未达成，请输出 ${GOAL_NOT_REACHED_MARKER}。`,
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名专业的技术文档撰写员和需求分析师。你的唯一工作是编写清晰、完整的需求文档。',
    recommendedRole: 'writer',
    recommendedModelHints: hintFor('writer'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'fullstack-dev',
    name: 'Full Stack Developer',
    color: '#10B981',
    task: '根据需求文档编写生产级代码',
    taskPrompt: '请基于上游需求文档，完成可运行的生产级实现，并给出简短实现说明。',
    taskInstruction: `仔细阅读上游提供的需求文档，然后编写完整的生产级代码。

你的输出必须包含：
1. 完整源代码（标明文件名和语言）
2. 简短的实现说明（设计决策与运行说明）

如果上游包含 ${REVIEW_REJECT_MARKER}，先修复报告中列出的所有问题，再提交代码。
完成后输出 ${PASS_MARKER}；如果你确认仍未满足整体目标，输出 ${GOAL_NOT_REACHED_MARKER}。`,
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名专业的全栈软件开发工程师。你的唯一工作是编写生产级代码。',
    recommendedRole: 'developer',
    recommendedModelHints: hintFor('developer'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    color: '#8B5CF6',
    task: '审查代码质量并给出 PASS/REJECT 结论',
    taskPrompt: '请对上游代码做严格审查，明确指出问题、风险，并给出 PASS/REJECT 结论。',
    taskInstruction: `审查上游开发者产出的代码，评估可读性、安全漏洞、性能与错误处理。

在输出的最后必须输出以下标记之一：
- ${PASS_MARKER} — 代码质量良好，无需修改
- ${REVIEW_REJECT_MARKER} — 存在必须修复的问题

给出具体、可操作的反馈，而不仅仅是 PASS/REJECT。`,
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: `你是一名严格但公正的高级代码审查员。你必须给出具体审查意见，并以 ${PASS_MARKER} 或 ${REVIEW_REJECT_MARKER} 结束。`,
    recommendedRole: 'reviewer',
    recommendedModelHints: hintFor('reviewer'),
    requiredOutputMarkers: defaultMarkers('PASS', 'REVIEW_REJECT'),
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    color: '#EF4444',
    task: '编写并执行测试，直到所有测试通过',
    taskPrompt: '请基于上游需求和代码输出，设计测试、分析失败原因，并给出明确路由结论。',
    taskInstruction: `基于上游的需求文档和代码输出，编写测试用例并运行测试。

对于每个失败的测试，分析是“代码 bug”还是“需求理解错误”，并给出明确的修复指令。

在输出末尾使用统一路由标记：
- ${PASS_MARKER} — 所有测试通过
- ${TESTS_FAIL_CODE_MARKER} — 代码有 bug，需要 Developer 修复
- ${TESTS_FAIL_SPEC_MARKER} — 需求不清晰，需要 Writer 澄清`,
    execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
    soulPrompt: `你是一名严谨的 QA 工程师。你的职责不只是测试，而是定位问题根源，并以 ${PASS_MARKER}、${TESTS_FAIL_CODE_MARKER} 或 ${TESTS_FAIL_SPEC_MARKER} 明确收尾。`,
    recommendedRole: 'qa',
    recommendedModelHints: hintFor('qa'),
    requiredOutputMarkers: defaultMarkers('PASS', 'TESTS_FAIL_CODE', 'TESTS_FAIL_SPEC'),
  },
  {
    id: 'security-auditor',
    name: 'Security Auditor',
    color: '#F59E0B',
    task: '对代码进行安全漏洞审计',
    taskPrompt: '请从架构、认证、输入验证、数据保护等角度对当前实现进行安全审计。',
    taskInstruction: `审查上游代码和架构，识别安全漏洞（参考 OWASP Top 10），输出漏洞列表、详细描述和具体修复方案。

完成后输出 ${PASS_MARKER}；如果你确认核心目标仍未达成，输出 ${GOAL_NOT_REACHED_MARKER}。`,
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名网络安全专家，专注于应用安全审计。',
    recommendedRole: 'security',
    recommendedModelHints: hintFor('security'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    color: '#EC4899',
    task: '创建 CI/CD 流程和部署配置',
    taskPrompt: '请为当前项目补齐部署、容器化和 CI/CD 所需配置，并提供落地步骤。',
    taskInstruction: `分析上游代码，确定语言、框架和依赖，然后编写 Dockerfile、docker-compose.yml 或 GitHub Actions 配置，并提供部署指南。

完成后输出 ${PASS_MARKER}；如果整体目标仍未达成，输出 ${GOAL_NOT_REACHED_MARKER}。`,
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名经验丰富的 DevOps 工程师，专注于 CI/CD 和部署自动化。',
    recommendedRole: 'devops',
    recommendedModelHints: hintFor('devops'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    color: '#EAB308',
    task: '分析数据并提供可视化建议',
    taskPrompt: '请分析当前数据或数据描述，输出关键洞察、质量问题和推荐的可视化方案。',
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名数据分析师，负责提取关键洞察并提出合适的可视化建议。',
    recommendedRole: 'custom',
    recommendedModelHints: hintFor('custom'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'translator',
    name: 'Translator',
    color: '#06B6D4',
    task: '将内容翻译成目标语言',
    taskPrompt: '请把上游内容准确翻译成目标语言，同时保留术语一致性和原始结构。',
    execution: DEFAULT_EXECUTION_CONFIG,
    soulPrompt: '你是一名专业翻译，需要在保留结构和术语一致性的前提下完成高质量翻译。',
    recommendedRole: 'writer',
    recommendedModelHints: hintFor('writer'),
    requiredOutputMarkers: defaultMarkers('PASS', 'GOAL_NOT_REACHED'),
  },
  {
    id: 'goal-evaluator',
    name: 'Goal Evaluator',
    color: '#0EA5E9',
    task: '判定项目目标是否达成',
    taskPrompt: '请阅读 projectGoal、successCriteria 和所有 agent 的最终输出，判断项目目标是否已经达成。',
    taskInstruction: '阅读 projectGoal、successCriteria 和所有 agent 的最终输出，按指定 JSON 格式输出评估结果。',
    soulPrompt: '你是一名严格的工作流目标评估官。你必须只输出严格 JSON: {"reached": bool, "confidence": 0-1, "missing_items": [...], "next_agent_role_hint": string, "reasoning": string }。不要输出任何额外文字。',
    execution: DEFAULT_EXECUTION_CONFIG,
    recommendedRole: 'goal-evaluator',
    recommendedModelHints: hintFor('goal-evaluator'),
  },
  AUTORESEARCH_BOOTSTRAP_TEMPLATE,
];

export function getAgentTemplateById(templateId: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((template) => template.id === templateId);
}