import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { savePlanDocTool } from '../SavePlanDocTool';
import type { ToolContext } from '../../base/Tool';

const VALID_PLAN_BODY = `## Execution Plan: Add a foo

**Mode**: Plan Only
**Status**: Not executed yet
**Purpose**: Prepare a safe implementation plan before making changes.

### 1. Goal Summary
Add the foo.

### 2. Context and Assumptions
- The foo is not yet present.

### 3. Proposed Implementation Steps

Step 1: Create the foo.
- Files: src/foo.ts (new)
- Tools later: write_file
- Dependencies: none

### 4. Files Likely Affected
- src/foo.ts -- new file

### 5. Risks and Considerations
None.

### 6. Validation Plan
- pnpm test
- manual smoke

### 7. Execution Gate
This plan has not been executed.
To proceed, the user must:
1. Review and approve or revise the plan.
2. Switch Execution Mode from Plan to Ask, Auto, or Bypass.
`;

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: 'session-1',
    messages: [
      { role: 'user', content: 'Please add a foo to the project' },
    ],
    tools: new Map(),
    cwd: '/tmp/pipi/session-1',
    settings: {},
    permissions: {},
    ...overrides,
  };
}

describe('SavePlanDocTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists a structurally valid plan and returns the saved file path', async () => {
    mockInvoke.mockResolvedValue({
      number: '021',
      filename: '021-plan-add-a-foo.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/021-plan-add-a-foo.md',
      index_updated: true,
    });

    const result = await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/021-plan-add-a-foo.md',
      filename: '021-plan-add-a-foo.md',
      number: '021',
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      'create_doc',
      expect.objectContaining({
        workDir: '/tmp/pipi/session-1',
        title: expect.stringMatching(/^Plan -/),
        body: expect.stringContaining('## Execution Plan: Add a foo'),
        tags: ['plan', 'plan-mode', 'execution-plan'],
      }),
    );
  });

  it('uses the explicit title when the model supplies one', async () => {
    mockInvoke.mockResolvedValue({
      number: '022',
      filename: '022-plan-shorter.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/022-plan-shorter.md',
      index_updated: true,
    });

    const result = await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY, title: 'Add a foo (short)' },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      'create_doc',
      expect.objectContaining({
        title: 'Plan - Add a foo (short)',
      }),
    );
  });

  it('refuses to save when the plan body lacks the required structure', async () => {
    const result = await savePlanDocTool.execute(
      { markdown: 'just a short note' },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/standard Plan Mode structure/i);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses to save when the markdown is empty', async () => {
    const result = await savePlanDocTool.execute(
      { markdown: '   ' },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-empty/i);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses to save when no workspace is bound (empty cwd)', async () => {
    const result = await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY },
      makeContext({ cwd: '' }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workspace/i);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back to deriving the title from the user message when none is given', async () => {
    mockInvoke.mockResolvedValue({
      number: '023',
      filename: '023-plan-foo.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/023-plan-foo.md',
      index_updated: true,
    });

    await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY },
      makeContext(),
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      'create_doc',
      expect.objectContaining({
        title: expect.stringContaining('Please add a foo'),
      }),
    );
  });

  it('propagates createDoc errors as a failed tool result', async () => {
    mockInvoke.mockRejectedValue(new Error('disk full'));

    const result = await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('disk full');
  });

  it('registers under the model-facing alias save_plan_doc', () => {
    expect(savePlanDocTool.name).toBe('SavePlanDoc');
    expect(savePlanDocTool.aliases).toContain('save_plan_doc');
  });
});
