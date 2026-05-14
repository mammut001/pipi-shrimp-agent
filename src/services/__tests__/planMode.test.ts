import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const createDocMock = jest.fn();

jest.mock('@/services/docService', () => ({
  createDoc: (...args: unknown[]) => createDocMock(...args),
}));

import { DOCS_CHANGED_EVENT } from '@/services/docEvents';
import { savePlanModeDoc, shouldSavePlanDoc } from '@/services/planMode';

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