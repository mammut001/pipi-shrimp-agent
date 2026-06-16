import type { SessionGoalRecord } from '@/types/sessionGoal';

function formatTraceLines(traces: SessionGoalRecord['traces']): string {
  if (traces.length === 0) {
    return '（尚无追踪记录）';
  }

  const recent = traces.slice(-8);
  return recent
    .map((entry, index) => {
      const label = entry.kind === 'user_turn'
        ? '用户'
        : entry.kind === 'assistant_turn'
          ? '助手'
          : '系统';
      return `${index + 1}. [${label}] ${entry.summary}`;
    })
    .join('\n');
}

function formatSuccessCriteria(criteria: string[]): string {
  if (criteria.length === 0) {
    return '（未设置，可由澄清流程补充）';
  }
  return criteria.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export function buildSessionGoalPromptContext(goal: SessionGoalRecord | null | undefined): Record<string, string> {
  if (!goal?.objective?.trim() || goal.status === 'idle') {
    return {
      sessionGoalBlock: '',
    };
  }

  const statusLabel = goal.status === 'active'
    ? '进行中'
    : goal.status === 'paused'
      ? '已暂停'
      : goal.status === 'completed'
        ? '已完成'
        : goal.status === 'restricted'
          ? '使用受限（当前有进行中的回复）'
          : goal.status === 'budget_limited'
            ? '预算已用尽'
            : '未设置';

  const guidance = goal.status === 'completed'
    ? '会话目标已标记完成。除非用户重新激活，不要擅自重启大范围实现。'
    : goal.status === 'paused'
      ? '会话目标已暂停。在用户明确要求继续前，不要自动扩展实现范围。'
      : goal.status === 'budget_limited'
        ? '目标预算已用尽。请总结已完成工作与剩余事项，等待用户决定是否恢复预算并继续。'
        : [
            '用户为本会话设定了持久目标。每轮回复后应自检：当前工作是否朝目标推进？',
            '若目标已达成，请在回复末尾输出 [[SESSION_GOAL_REACHED]] 并列出验证依据（测试、文件、命令输出等）。',
            '若被阻塞且必须等待用户操作，请输出 [[SESSION_GOAL_BLOCKED]] 并说明缺什么。',
            goal.autoContinue
              ? '自动续跑已开启：尽量在一次回复内完成可验证的下一步，不要只给计划不动手。'
              : '自动续跑未开启：给出清晰下一步，用户会手动继续。',
          ].join('\n');

  const asciiSection = goal.asciiPreview.trim()
    ? `\n\nASCII preview:\n${goal.asciiPreview.trim()}`
    : '';

  const budgetSection = `Budget: turns ${goal.budget.turnsUsed}/${goal.budget.maxTurns}, tokens ${goal.budget.tokensUsed}/${goal.budget.maxTokens}`;

  const sessionGoalBlock = [
    '## Session Goal',
    '',
    goal.objective.trim(),
    '',
    `Status: ${statusLabel}`,
    budgetSection,
    '',
    'Success criteria:',
    formatSuccessCriteria(goal.successCriteria),
    asciiSection,
    '',
    'Recent trace:',
    formatTraceLines(goal.traces),
    '',
    guidance,
  ].filter(Boolean).join('\n');

  return { sessionGoalBlock };
}

export function buildContinueGoalMessage(
  objective: string,
  successCriteria: string[] = [],
): string {
  const criteriaBlock = successCriteria.length > 0
    ? ['', '成功标准：', ...successCriteria.map((item, index) => `${index + 1}. ${item}`)].join('\n')
    : '';

  return [
    '请继续推进当前会话目标。',
    '',
    `目标：${objective}`,
    criteriaBlock,
    '',
    '请先回顾最近进展与已有证据，再执行下一步最有价值的行动。',
    '若目标已达成，请输出 [[SESSION_GOAL_REACHED]] 并列出验证依据。',
    '若被用户操作阻塞，请输出 [[SESSION_GOAL_BLOCKED]]。',
  ].filter(Boolean).join('\n');
}
