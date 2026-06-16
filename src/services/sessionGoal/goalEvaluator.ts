import type { SessionGoalEvaluation, SessionGoalRecord } from '@/types/sessionGoal';

const GOAL_REACHED_MARKERS = [
  /\[\[SESSION_GOAL_REACHED\]\]/i,
  /\[\[GOAL_COMPLETE\]\]/i,
  /\[\[GOAL_REACHED\]\]/i,
];

const GOAL_BLOCKED_MARKERS = [
  /\[\[SESSION_GOAL_BLOCKED\]\]/i,
  /\[\[GOAL_BLOCKED\]\]/i,
  /需要用户(输入|确认|介入)/,
  /请先(登录|确认|提供)/i,
];

export function stripGoalMarkers(content: string): string {
  return content
    .replace(/\[\[SESSION_GOAL_REACHED\]\]/gi, '')
    .replace(/\[\[GOAL_COMPLETE\]\]/gi, '')
    .replace(/\[\[GOAL_REACHED\]\]/gi, '')
    .replace(/\[\[SESSION_GOAL_BLOCKED\]\]/gi, '')
    .replace(/\[\[GOAL_BLOCKED\]\]/gi, '')
    .trim();
}

function extractEvidence(content: string): string[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !GOAL_REACHED_MARKERS.some((pattern) => pattern.test(line)));

  return lines.slice(-4);
}

function criteriaMentioned(content: string, criteria: string[]): string[] {
  const normalized = content.toLowerCase();
  return criteria.filter((item) => {
    const probe = item.replace(/^[-•\s]+/, '').trim().toLowerCase();
    if (!probe) return false;
    const tokens = probe.split(/\s+/).filter((token) => token.length > 3).slice(0, 4);
    return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
  });
}

export function evaluateSessionGoalTurn(
  goal: SessionGoalRecord,
  assistantContent: string,
): SessionGoalEvaluation {
  const content = assistantContent.trim();
  const reachedByMarker = GOAL_REACHED_MARKERS.some((pattern) => pattern.test(content));
  const blocked = GOAL_BLOCKED_MARKERS.some((pattern) => pattern.test(content));
  const matchedCriteria = criteriaMentioned(content, goal.successCriteria);
  const evidence = extractEvidence(content);

  if (reachedByMarker) {
    return {
      reached: true,
      confidence: 0.92,
      reasoning: '助手显式输出了目标完成标记。',
      evidence,
      timestamp: Date.now(),
    };
  }

  if (
    goal.successCriteria.length > 0
    && matchedCriteria.length === goal.successCriteria.length
    && !blocked
  ) {
    return {
      reached: true,
      confidence: 0.78,
      reasoning: '回复内容覆盖了全部成功标准。',
      evidence: matchedCriteria,
      timestamp: Date.now(),
    };
  }

  if (blocked) {
    return {
      reached: false,
      confidence: 0.85,
      reasoning: '助手提示需要用户介入，暂停自动续跑。',
      evidence,
      timestamp: Date.now(),
    };
  }

  return {
    reached: false,
    confidence: goal.successCriteria.length > 0 ? 0.45 : 0.35,
    reasoning: goal.successCriteria.length > 0
      ? `仍有 ${goal.successCriteria.length - matchedCriteria.length} 条成功标准未在回复中得到明确证据。`
      : '目标尚未被标记完成，可继续推进。',
    evidence,
    timestamp: Date.now(),
  };
}

export function isBudgetExhausted(goal: SessionGoalRecord): boolean {
  return goal.budget.turnsUsed >= goal.budget.maxTurns
    || goal.budget.tokensUsed >= goal.budget.maxTokens;
}
