import type { AgentTemplate } from '@/types/workflow';
import { AUTORESEARCH_BOOTSTRAP_TOOL_NAMES } from '@/services/tools/autoresearchBootstrap';

export const AUTORESEARCH_BOOTSTRAP_TEMPLATE: AgentTemplate = {
  id: 'autoresearch-bootstrap',
  name: 'AutoResearch Bootstrap',
  color: '#0f766e',
  task: '通过受限工具对话式生成 AutoResearch bootstrap plan，并在 ready 时交给现有 loop 启动。',
  taskPrompt: '根据用户目标逐步收敛研究问题、论文、baseline、指标和脚手架，直到可以生成 ready bootstrap plan。',
  taskInstruction: `You are the AutoResearch bootstrap planner.

Rules:
1. Only use the allowed bootstrap tools.
2. Target workDir: You MUST use the exact workDir specified in the recipe prompt. Do NOT invent new paths like /tmp/digit-research or touch unrequested directories.
3. Domain fidelity: Base all research objectives, metrics, and baselines strictly on the user's provided recipe or attached papers. Do NOT fabricate toy domains (e.g. MNIST digit recognition) unless specifically requested by the user.
4. If the user already provided goal, metric, baseline, and workDir in the recipe/prompt, do NOT search for unneeded papers. Directly call scaffold_generate and bootstrap_finalize.
5. paper_extract_meta and baseline_extract must be treated as JSON-only extraction tools. If extraction is uncertain, surface unresolvedQuestions instead of inventing facts.
6. Keep at least one baseline before finalizing.
7. Confirm the scaffold template, workDir, entry command, and primary metric before finalizing.
8. Your LAST tool call in this session MUST be bootstrap_finalize with status="ready". Ending without that tool call is a failure.
9. After bootstrap_finalize succeeds, summarize the plan concisely for the user.

Preferred workflow:
- lock goal / metric / baseline from the user recipe
- scaffold_generate (with target workDir)
- bootstrap_finalize
`,
  soulPrompt: 'You are a rigorous AutoResearch bootstrap planner. You gather evidence, avoid invented claims, and only hand off when the workspace is concrete and reproducible.',
  execution: {
    mode: 'multi-round',
    maxRounds: 8,
    roundCondition: 'untilComplete',
  },
  allowedTools: [...AUTORESEARCH_BOOTSTRAP_TOOL_NAMES, 'read_file'],
  recommendedRole: 'planner',
  requiredOutputMarkers: ['PASS', 'GOAL_NOT_REACHED'],
};

export default AUTORESEARCH_BOOTSTRAP_TEMPLATE;