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
  configId?: string;        // Reference to an existing apiConfig ID (takes priority)
  provider: string;
  modelId: string;
  name?: string;
  apiKey?: string;          // Only used when configId is absent
  baseUrl?: string;         // Only used when configId is absent
}

export interface WorkflowAgent {
  id: string;
  name: string;
  soulPrompt?: string;
  /** Short one-line label shown on the canvas card */
  task?: string;
  /** Concrete work item for this run, combined with the agent instruction template */
  taskPrompt?: string;
  /**
   * Detailed per-agent task instruction injected into the execution prompt.
   * Should describe exactly what THIS agent is responsible for producing
   * and how to use upstream outputs.
   *
   * Example for a coder agent:
   * "Read the design document produced by the writer and implement the
   * architecture improvements as working code. Do not write another analysis."
   */
  taskInstruction?: string;
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
  projectGoal: string;         // Full original user goal
  status: 'idle' | 'running' | 'completed' | 'error' | 'stopped';
  startTime: number;
  endTime?: number;
  agents: WorkflowRunAgentEntry[];
  runDirectory?: string;       // Isolated workspace directory for this run
  sessionId?: string;          // Cowork session ID for viewing in chat
}

// ============ Workflow Instance ============

/**
 * A single Workflow instance (analogous to a ChatSession).
 * Each instance has its own agents, connections, and run history.
 */
export interface WorkflowInstance {
  id: string;
  name: string;
  agents: WorkflowAgent[];
  connections: WorkflowConnection[];
  workflowRuns: WorkflowRun[];
  /** Currently running Run ID within this instance */
  activeRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ============ Global State ============

export interface WorkflowState {
  instances: WorkflowInstance[];
  currentInstanceId: string | null;
  isRunning: boolean;
  currentRunningAgentId: string | null;
  /** Which run's output is shown in the output panel (null = latest) */
  selectedRunId: string | null;
  /** Currently previewing file in the right panel */
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
    taskPrompt: '请基于上游需求文档，完成可运行的生产级实现，并给出简短实现说明。',
    taskInstruction: `仔细阅读上游（通常是技术写作者）提供的需求文档，然后编写完整的生产级代码。

你的输出必须包含：
1. 完整源代码（标明文件名和语言）
2. 简短的实现说明（设计决策与运行说明）

注意：
- 如果上游包含代码审查报告且结论为 REJECT，先修复报告中列出的所有问题，再提交代码
- 不要写需求文档，不要跑测试`,
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
    taskPrompt: '请对上游代码做严格审查，明确指出问题、风险，并给出 PASS/REJECT 结论。',
    taskInstruction: `审查上游开发者产出的代码。评估可读性、安全漏洞、性能、错误处理。

在输出的最后一行必须输出：
- <PASS> — 代码质量良好，无需修改
- <REJECT> — 存在需修复的问题

给出具体、可操作的反馈，而不仅仅是 PASS/REJECT。`,
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
    taskPrompt: '请基于上游需求和代码输出，设计测试、分析失败原因，并给出明确路由结论。',
    taskInstruction: `基于上游的需求文档和代码输出，编写测试用例并运行测试。

对于每个失败的测试，分析是"代码 bug"还是"需求理解错误"，并给出明确的修复指令。

在输出末尾使用路由标签：
- <PASS> — 所有测试通过
- <REJECT:CODE> — 代码有 bug，需要 Developer 修复
- <REJECT:DOC> — 需求不清晰，需要 Writer 澄清`,
    execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
    soulPrompt: `你是一名严谨的 QA 工程师。你的职责不只是测试，而是**定位问题根源**。

## 你的工作流程：
1. 阅读需求文档 (docs/requirements.md) 理解预期行为
2. 阅读源代码理解实现逻辑
3. 编写测试用例
4. 运行测试
5. 如果失败，分析是"代码 bug"还是"需求理解错误"
6. 给出明确的修复指令

## 严格规则：
- 不要只报告"测试失败了"
- 要分析"为什么失败，是谁的错"
- 不要编写任何生产代码
- 不要编写需求文档

## 输出格式：
完成测试后，你必须输出以下格式的结论：

=== 测试结果 ===
测试用例数: X
通过: Y
失败: Z

=== 失败分析 ===
[对于每个失败的测试]
- 测试: "功能名称"
- 预期: 期望行为
- 实际: 实际行为
- 根因: 原因分析
- 责任人: B(Developer) 或 A(Writer)
- 修复建议: 具体修复操作

=== 路由决定 ===
最后一行必须是以下之一：
- <PASS> — 所有测试通过，工作流完成
- <REJECT:CODE> — 有代码 bug，需要 Developer 修复
- <REJECT:DOC> — 需求文档不清晰，需要 Writer 澄清

重要：不要遗漏路由标签！`,
  },
  {
    id: 'security-auditor',
    name: 'Security Auditor',
    color: '#F59E0B',
    task: '对代码进行安全漏洞审计',
    taskPrompt: '请从架构、认证、输入验证、数据保护等角度对当前实现进行安全审计。',
    taskInstruction: `审查上游代码和架构，识别安全漏洞（参考 OWASP Top 10）。

输出：发现漏洞的列表（严重程度 高/中/低）、详细描述、及具体修复方案。`,
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
    taskPrompt: '请为当前项目补齐部署、容器化和 CI/CD 所需配置，并提供落地步骤。',
    taskInstruction: `分析上游代码，确定语言/框架/依赖，然后编写 Dockerfile、docker-compose.yml 或 GitHub Actions 配置。提供完整的部署指南。`,
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
    taskPrompt: '请分析当前数据或数据描述，输出关键洞察、质量问题和推荐的可视化方案。',
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
    taskPrompt: '请把上游内容准确翻译成目标语言，同时保留术语一致性和原始结构。',
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
