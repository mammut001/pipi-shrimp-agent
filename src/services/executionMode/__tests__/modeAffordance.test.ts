import { describe, expect, it } from '@jest/globals';

import {
  describeExecutionModeAffordance,
  getDefaultExecutionMode,
  getExecutionModeAffordance,
} from '../index';

describe('executionMode defaults affordance', () => {
  it('keeps Ask as the product default for new sessions', () => {
    expect(getDefaultExecutionMode().id).toBe('ask');
    const ask = getExecutionModeAffordance('ask');
    expect(ask.isDefault).toBe(true);
    expect(ask.toolsActive).toBe(false);
    expect(ask.hintKey).toBe('executionMode.affordance.ask');
    expect(ask.testId).toBe('execution-mode-affordance-ask');
  });

  it('marks only Danger as tools/shell active while risky approvals remain', () => {
    const danger = getExecutionModeAffordance('danger');
    expect(danger.toolsActive).toBe(true);
    expect(danger.riskyApprovalsRemain).toBe(true);
    expect(danger.isDefault).toBe(false);
    expect(danger.hintKey).toBe('executionMode.affordance.danger');
    expect(danger.testId).toBe('execution-mode-affordance-danger');

    const plan = getExecutionModeAffordance('plan');
    expect(plan.toolsActive).toBe(false);
    expect(plan.riskyApprovalsRemain).toBe(true);
    expect(plan.hintKey).toBe('executionMode.affordance.plan');
  });

  it('normalizes legacy Bypass to Danger affordance without escalating Debug/Agent', () => {
    expect(getExecutionModeAffordance('bypass').modeId).toBe('danger');
    expect(getExecutionModeAffordance('bypass').toolsActive).toBe(true);
    expect(getExecutionModeAffordance('debug').modeId).toBe('plan');
    expect(getExecutionModeAffordance('agent').toolsActive).toBe(false);
    expect(getExecutionModeAffordance(null).modeId).toBe('ask');
  });

  it('exposes greppable English summaries for soak / docs', () => {
    expect(describeExecutionModeAffordance('ask')).toContain('default Ask');
    expect(describeExecutionModeAffordance('ask')).toContain('Danger');
    expect(describeExecutionModeAffordance('danger')).toContain('tools/shell active');
    expect(describeExecutionModeAffordance('danger')).toContain('risky ops still confirm');
  });
});
