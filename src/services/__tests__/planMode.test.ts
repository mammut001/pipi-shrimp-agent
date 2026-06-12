import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const createDocMock = jest.fn();

jest.mock('@/services/docService', () => ({
  createDoc: (...args: unknown[]) => createDocMock(...args),
}));

import { DOCS_CHANGED_EVENT } from '@/services/docEvents';
import { PLAN_MODE_SYSTEM_PROMPT, savePlanModeDoc, shouldSavePlanDoc } from '@/services/planMode';

describe('planMode', () => {
  beforeEach(() => {
    createDocMock.mockReset();
    createDocMock.mockResolvedValue({
      number: '021',
      filename: '021-plan-ship-plan-mode.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/021-plan-ship-plan-mode.md',
      index_updated: true,
    });

    Object.defineProperty(globalThis, 'CustomEvent', {
      value: class CustomEvent<T = unknown> extends Event {
        detail: T;

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
      configurable: true,
      writable: true,
    });
  });

  it('saves a plan doc through createDoc and dispatches the shared docs changed event', async () => {
    const dispatchEvent = jest.fn();

    Object.defineProperty(globalThis, 'window', {
      value: { dispatchEvent },
      configurable: true,
      writable: true,
    });

    const result = await savePlanModeDoc({
      workDir: '/tmp/pipi/session-1',
      userRequest: 'Ship Plan Mode end to end',
      planMarkdown: '## Execution Plan: Ship Plan Mode\n\n### 6. Validation Plan\n\n### 7. Execution Gate',
      sessionId: 'session-1',
    });

    expect(createDocMock).toHaveBeenCalledWith('/tmp/pipi/session-1', expect.objectContaining({
      title: 'Plan - Ship Plan Mode end to end',
      body: '## Execution Plan: Ship Plan Mode\n\n### 6. Validation Plan\n\n### 7. Execution Gate',
      tags: ['plan', 'plan-mode', 'execution-plan'],
      summary: 'Execution plan generated in Plan Mode for: Ship Plan Mode end to end',
    }));
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DOCS_CHANGED_EVENT }));
    expect(result).toEqual({
      number: '021',
      filename: '021-plan-ship-plan-mode.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/021-plan-ship-plan-mode.md',
    });
  });

  it('detects plan-shaped content and ignores plain explanations', () => {
    expect(shouldSavePlanDoc('## Execution Plan: Add Plan Mode\n\n### 6. Validation Plan\n\n### 7. Execution Gate')).toBe(true);
    expect(shouldSavePlanDoc('## 执行计划：实现 Plan Mode\n\n### 3. 实施步骤\n\n### 6. 验证计划')).toBe(true);
    expect(shouldSavePlanDoc('This is a plain explanation without a structured plan.')).toBe(false);
  });
});

describe('PLAN_MODE_SYSTEM_PROMPT — no-tools theater guard', () => {
  // The fix for: "I will first take a look at the project structure…" being
  // streamed by the model in Plan Mode even though tools are disabled.
  // See tools/notes/plan-mode-no-tools-theater.md for the full diagnosis.
  it('still enforces the original strict constraints (regression guard)', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('Do not execute tools.');
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain(
      'Do not call file, terminal, browser, shell, or workspace tools.',
    );
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain(
      'Do not pretend that any code change has already happened.',
    );
  });

  it('tells the model tools are disabled in Plan Mode and not to announce "I will look"', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('Tool Availability in Plan Mode');
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/tools are intentionally disabled/i);
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/do not announce/i);
    // The exact failure-mode phrase from the user's report:
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/let me first take a look/i);
  });

  it('prescribes the two acceptable Plan Mode behaviors and the mode-switch fallback', () => {
    // Either produce a plan, or ask focused clarifying questions.
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/focused clarifying questions/i);
    // Or tell the user to switch Execution Mode.
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/switch Execution Mode/i);
  });

  it('applies the no-tools rule to follow-up revisions too', () => {
    // "Iteration Behavior" must reference the new rule, so that later turns
    // in the same Plan Mode session also stop the theater.
    const iterationIdx = PLAN_MODE_SYSTEM_PROMPT.indexOf('Iteration Behavior');
    expect(iterationIdx).toBeGreaterThanOrEqual(0);
    const after = PLAN_MODE_SYSTEM_PROMPT.slice(iterationIdx);
    expect(after).toMatch(/Tool Availability in Plan Mode/);
  });
});