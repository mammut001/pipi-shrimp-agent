import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const createDocMock = jest.fn();

jest.mock('@/services/docService', () => ({
  createDoc: (...args: unknown[]) => createDocMock(...args),
}));

import { DOCS_CHANGED_EVENT } from '@/services/docEvents';
import {
  PLAN_MODE_ALLOWED_TOOLS,
  PLAN_MODE_SYSTEM_PROMPT,
  savePlanModeDoc,
  shouldSavePlanDoc,
} from '@/services/planMode';

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

describe('PLAN_MODE_ALLOWED_TOOLS — read-only plan allowlist', () => {
  it('exposes exactly the four documented read + save tools, in order', () => {
    expect([...PLAN_MODE_ALLOWED_TOOLS]).toEqual([
      'read_file',
      'list_files',
      'search_files',
      'save_plan_doc',
    ]);
  });

  it('does not include any write, execute, or browser tool', () => {
    const banned = [
      'write_file',
      'edit_file',
      'create_directory',
      'delete_file',
      'execute_command',
      'browser_navigate',
      'browser_click',
      'browser_type',
    ];
    for (const name of banned) {
      expect(PLAN_MODE_ALLOWED_TOOLS).not.toContain(name);
    }
  });
});

describe('PLAN_MODE_SYSTEM_PROMPT — read-only plan mode', () => {
  it('still forbids claiming any code change has happened (regression guard)', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain(
      'Do not pretend that any code change has already happened.',
    );
  });

  it('enumerates the four read + save tools the model may call', () => {
    for (const tool of PLAN_MODE_ALLOWED_TOOLS) {
      // The prompt names each allowed tool (with backticks) in the
      // "Tools you MAY call" section.
      expect(PLAN_MODE_SYSTEM_PROMPT).toContain(`\`${tool}\``);
    }
  });

  it('forbids the write / execute / browser families by name', () => {
    // These are the families the prompt must explicitly call out as
    // unavailable so the model does not try to call them.
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/write_file/);
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/execute_command/);
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/browser_navigate/);
    // And it must state that they are filtered out at the request
    // boundary, not just "behave yourself" in prose.
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/filtered out at the request boundary/i);
  });

  it('tells the model to read first, then save the plan as a doc', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/read first, plan second/i);
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('save_plan_doc');
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/\.pipi-shrimp\/docs\//);
  });

  it('does not regress to the old "tools are intentionally disabled" framing', () => {
    // The old "no tools at all" copy is intentionally gone — that was
    // the source of the "I'll go look at the code" theater. If a future
    // edit accidentally restores it, fail loudly.
    expect(PLAN_MODE_SYSTEM_PROMPT).not.toMatch(/tools are intentionally disabled/i);
    expect(PLAN_MODE_SYSTEM_PROMPT).not.toMatch(/let me first take a look at the project/i);
  });

  it('prescribes focused clarifying questions and the mode-switch fallback', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/focused clarifying questions/i);
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/switch Execution Mode/i);
  });
});