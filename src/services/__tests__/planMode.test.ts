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
  it('exposes exactly the three documented read-only tools, in order', () => {
    // Plan mode is read-only inspection of the bound workspace. Plan
    // document persistence is an app-side post-turn action, NOT a
    // model-callable tool — so `save_plan_doc` is intentionally
    // absent here.
    expect([...PLAN_MODE_ALLOWED_TOOLS]).toEqual([
      'read_file',
      'list_files',
      'search_files',
    ]);
  });

  it('does not include save_plan_doc (Option A — app-side post-turn persistence)', () => {
    // The Rust tool registry has no `save_plan_doc` handler, so the
    // model must never be told to call it. Plan docs are saved by
    // chatActions after turn_complete via shouldSavePlanDoc +
    // savePlanModeDoc using the real PiPi Output Folder.
    expect(PLAN_MODE_ALLOWED_TOOLS).not.toContain('save_plan_doc');
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

  it('enumerates the three read-only tools the model may call', () => {
    for (const tool of PLAN_MODE_ALLOWED_TOOLS) {
      // The prompt names each allowed tool (with backticks) in the
      // "Tools you MAY call" section.
      expect(PLAN_MODE_SYSTEM_PROMPT).toContain(`\`${tool}\``);
    }
  });

  it('does not advertise save_plan_doc to the model', () => {
    // The "Tools you MAY call" section must not contain save_plan_doc.
    // Plan-doc persistence is handled by the chat store, not by a
    // model tool call.
    const mayCallSection = PLAN_MODE_SYSTEM_PROMPT.split('### Tools you MAY call')[1]
      ?.split('### Tools you MUST NOT call')[0] ?? '';
    expect(mayCallSection).not.toMatch(/save_plan_doc/);
  });

  it('explicitly states the chat store auto-saves valid plans', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/auto-saves your final assistant message/i);
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

  it('tells the model to read first, then produce a structured plan', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/read first, plan second/i);
    // The prompt now tells the model to write the plan in chat and
    // let the app persist it — not to call save_plan_doc.
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/do not need to call any tool to persist the plan/i);
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