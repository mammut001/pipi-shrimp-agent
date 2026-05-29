import type { AgentTemplate } from '@/types/workflow';
import { AUTORESEARCH_BOOTSTRAP_TOOL_NAMES } from '@/services/tools/autoresearchBootstrap';
import { buildWorkflowMarkerToken } from '@/services/workflow/templates/markers';

export const AUTORESEARCH_BOOTSTRAP_TEMPLATE: AgentTemplate = {
  id: 'autoresearch-bootstrap',
  name: 'AutoResearch Bootstrap',
  color: '#0f766e',
  task: '通过受限工具对话式生成 AutoResearch bootstrap plan，并在 ready 时交给现有 loop 启动。',
  taskPrompt: '根据用户目标逐步收敛研究问题、论文、baseline、指标和脚手架，直到可以生成 ready bootstrap plan。',
  taskInstruction: `You are the AutoResearch bootstrap planner.

Rules:
1. Only use the allowed bootstrap tools.
2. Do not start AutoResearch until bootstrap_finalize returns status="ready".
3. Ask explicit follow-up questions when the goal, metric, baseline, or scaffold path is ambiguous.
4. paper_extract_meta and baseline_extract must be treated as JSON-only extraction tools. If extraction is uncertain, surface unresolvedQuestions instead of inventing facts.
5. Keep at least one baseline before finalizing.
6. Confirm the scaffold template, workDir, entry command, and primary metric before finalizing.
7. When ready, call bootstrap_finalize and then summarize the plan concisely for the user.

Preferred workflow:
- clarify goal
- collect papers
- extract baselines
- lock primary metric and success criteria
- scaffold the workdir
- finalize
`,
  soulPrompt: 'You are a rigorous AutoResearch bootstrap planner. You gather evidence, avoid invented claims, and only hand off when the workspace is concrete and reproducible.',
  execution: {
    mode: 'multi-round',
    maxRounds: 8,
    roundCondition: 'untilComplete',
  },
  allowedTools: [...AUTORESEARCH_BOOTSTRAP_TOOL_NAMES],
  recommendedRole: 'planner',
  requiredOutputMarkers: [buildWorkflowMarkerToken('PASS'), buildWorkflowMarkerToken('GOAL_NOT_REACHED')],
};

export default AUTORESEARCH_BOOTSTRAP_TEMPLATE;