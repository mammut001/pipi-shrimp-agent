/**
 * Workflow Types - Multi-agent workflow system type definitions
 *
 * Defines the data models for:
 * - WorkflowAgent: A node in the workflow graph
 * - WorkflowConnection: An edge between two agents
 * - OutputRoute: Conditional routing from an agent's output
 * - WorkflowRun: A historical execution record
 * - WorkflowState: Global Zustand store state
 */

// ============ Execution Config ============

export type ExecutionMode = 'single' | 'multi-round';

export type RoundCondition = 'untilComplete' | 'untilError' | 'fixed';

export interface AgentExecutionConfig {
  mode: ExecutionMode;
  maxRounds?: number;           // Used only in multi-round mode
  roundCondition?: RoundCondition;
}

export const DEFAULT_EXECUTION_CONFIG: AgentExecutionConfig = {
  mode: 'single',
};

// ============ Output Routes ============

export type RouteCondition = 'onComplete' | 'onError' | 'outputContains' | 'always';

export interface OutputRoute {
  id: string;
  condition: RouteCondition;
  keyword?: string;             // Used only when condition === 'outputContains'
  targetAgentId: string;
}

// ============ Agent Node ============

export interface WorkflowAgentModel {
  provider: string;
  modelId: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface WorkflowAgent {
  id: string;
  name: string;
  soulPrompt?: string;
  task?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  outputRoutes: OutputRoute[];
  execution: AgentExecutionConfig;
  model?: WorkflowAgentModel;   // Optional: overrides global API config
  inputFrom?: string | null;     // Agent ID of upstream node (null = entry point)
}

// ============ Connection ============

export type ConnectionType = 'sequential' | 'parallel';

export interface WorkflowConnection {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  condition: string;            // Display label
  type?: ConnectionType;
}

// ============ Workflow Run (History) ============

export interface WorkflowRunAgentEntry {
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  output?: string;              // First 2000 chars of agent output
  iteration?: number;
}

export interface WorkflowRun {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  startTime: number;
  endTime?: number;
  agents: WorkflowRunAgentEntry[];
  runDirectory?: string;       // Isolated workspace directory for this run
  sessionId?: string;          // Cowork session ID for viewing in chat
}

// ============ Global State ============

export interface WorkflowState {
  agents: WorkflowAgent[];
  connections: WorkflowConnection[];
  isRunning: boolean;
  currentRunningAgentId: string | null;
  workflowRuns: WorkflowRun[];
}

// ============ Agent Templates ============

export interface AgentTemplate {
  id: string;
  name: string;
  color: string;
  task: string;
  soulPrompt: string;
  execution: AgentExecutionConfig;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tech-writer',
    name: 'Technical Writer',
    color: '#3B82F6',
    task: '根据用户需求编写详细的需求文档',
    execution: { mode: 'single' },
    soulPrompt: `你是一名专业的技术文档撰写员和需求分析师。你的唯一工作是编写清晰、完整的需求文档。

## 严格规则：
1. 你收到用户的原始任务描述（例如"写一个检查奇偶数的脚本"）。
2. 不要写任何代码——那不是你的工作。
3. 不要运行测试——那不是你的工作。

## 你必须输出：
一份名为 "requirements.md" 的文档（输出到聊天中），包含：
1. **项目标题** — 任务的清晰名称
2. **目标** — 用2-3句话描述程序应该做什么
3. **功能需求** — 具体功能的编号列表
4. **边界情况与约束** — 无效输入时应发生什么
5. **示例输入/输出** — 至少2-3个具体示例

完成后，输出："需求文档已完成。"`,
  },
  {
    id: 'fullstack-dev',
    name: 'Full Stack Developer',
    color: '#10B981',
    task: '根据需求文档编写生产级代码',
    execution: { mode: 'single' },
    soulPrompt: `你是一名专业的全栈软件开发工程师。你的唯一工作是编写生产级代码。

## 严格规则：
1. 仔细阅读上游输入中的需求说明。
2. 如果上游有代码审查报告提到了 REJECT，先修复所有列出的问题。
3. 不要写需求文档——那不是你的工作。
4. 不要运行测试——那是 QA 工程师的工作。

## 你必须输出：
1. 完整的源代码（内嵌在响应中，标明文件名和语言）
2. 一份简短的实现说明，包含：
   - 设计决策摘要
   - 如何运行程序
   - 任何假设说明

## 编码标准：
- 清晰可读的代码，合适的命名规范
- 适当的错误处理和输入验证
- 仅在复杂逻辑处添加注释`,
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    color: '#8B5CF6',
    task: '审查代码质量并给出 PASS/REJECT 结论',
    execution: { mode: 'single' },
    soulPrompt: `你是一名严格但公正的高级代码审查员。

## 你的职责：
1. 检查上游输入中的代码。
2. 分析代码的可读性、安全漏洞、性能瓶颈、错误处理。
3. 提供具体、可操作的反馈。

## 路由要求（非常重要）：
你必须在输出的最后一行，输出以下两个关键词之一（单独一行）：
- 如果代码**没有错误且质量良好**：输出 <PASS>
- 如果代码**有需要开发者修复的错误**：输出 <REJECT>

不要遗漏这个关键词，工作流引擎依赖它来路由。`,
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    color: '#EF4444',
    task: '编写并执行测试，直到所有测试通过',
    execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
    soulPrompt: `你是一名严谨的 QA 工程师。你的唯一工作是测试代码并报告结果。

## 严格规则：
1. 仔细阅读上游输入中的代码。
2. 不要编写任何生产代码——那不是你的工作。
3. 不要编写需求文档——那不是你的工作。

## 你必须输出：
1. 测试用例列表（带描述）
2. 每个测试用例的通过/失败状态
3. 失败时的具体错误信息
4. 总体结论

## 重要——你的结论决定路由：
- 如果所有测试通过：最后一行输出 <PASS>
- 如果有测试失败：最后一行输出 <REJECT>，并描述需要修复的内容

请严格诚实。不要让有 bug 的代码通过。`,
  },
  {
    id: 'security-auditor',
    name: 'Security Auditor',
    color: '#F59E0B',
    task: '对代码进行安全漏洞审计',
    execution: { mode: 'single' },
    soulPrompt: `你是一名网络安全专家，专注于应用安全审计。

## 你的职责：
1. 检查上游输入中的代码和架构。
2. 识别 OWASP Top 10 等常见安全漏洞。
3. 检查认证/授权、数据加密、输入验证等安全点。
4. 提供具体的修复建议。

## 输出格式：
- 发现的漏洞列表（严重程度：高/中/低）
- 每个漏洞的详细描述
- 具体的修复方案
- 总体安全评估`,
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    color: '#EC4899',
    task: '创建 CI/CD 流程和部署配置',
    execution: { mode: 'single' },
    soulPrompt: `你是一名经验丰富的 DevOps 工程师，专注于 CI/CD 和部署自动化。

## 你的职责：
1. 分析上游输入中的项目代码，了解其语言和依赖。
2. 编写 Dockerfile、docker-compose.yml 或 GitHub Actions 配置。
3. 提供完整的部署指南。

## 输出内容：
- 完整的 Dockerfile（如适用）
- docker-compose.yml（如适用）
- CI/CD pipeline 配置（GitHub Actions YAML）
- 部署步骤说明`,
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    color: '#EAB308',
    task: '分析数据并提供可视化建议',
    execution: { mode: 'single' },
    soulPrompt: `你是一名数据分析师。

## 你的职责：
1. 分析上游输入中的数据集或数据描述。
2. 提取关键洞察和模式。
3. 建议合适的数据可视化方式。
4. 识别数据质量问题。

## 输出内容：
- 数据概要统计
- 关键洞察（3-5条）
- 建议的图表类型和对应分析目标
- 数据质量问题和改进建议`,
  },
  {
    id: 'translator',
    name: 'Translator',
    color: '#06B6D4',
    task: '将内容翻译成目标语言',
    execution: { mode: 'single' },
    soulPrompt: `你是一名专业翻译。

## 你的任务：
将上游输入中的内容翻译成中文（如果原文是中文，则翻译成英文）。

## 要求：
- 保持原始文档的格式结构
- 翻译准确、自然，符合目标语言习惯
- 保留代码块不翻译（只翻译注释）
- 专业术语保持原文`,
  },
];

// ============ Color Palette ============

export const AGENT_COLORS = [
  '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#3B82F6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];
