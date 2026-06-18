import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();
const mockSafeInvokeOrNull = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// `resolveRealSessionPipiOutputDir` falls through to `safeInvokeOrNull`
// when the session has no persisted `pipiOutputDir`. The default test
// fixture below has an explicit `pipiOutputDir`, so this mock should
// never be called — any test that exercises the fallback path must
// mock it explicitly.
jest.mock('@/utils/safeInvoke', () => ({
  safeInvokeOrNull: (...args: unknown[]) => mockSafeInvokeOrNull(...args),
}));

// Two-folder model: SavePlanDocTool resolves the destination folder
// through `getSessionPipiOutputDir(session)`. We mock the chat store
// so the tool sees a session with the expected `pipiOutputDir` (or,
// in the no-binding case, no folder at all so the tool can fail with
// the correct error).
const mockChatState: {
  sessions: Array<{ id: string; projectDir?: string; pipiOutputDir?: string }>;
} = {
  sessions: [
    {
      id: 'session-1',
      // The default test session has an explicit PiPi Output Folder
      // that differs from `cwd` (= the Project Folder) so the test
      // can prove the tool writes to the right one.
      projectDir: '/tmp/pipi/session-1/project',
      pipiOutputDir: '/tmp/pipi/session-1',
    },
  ],
};

jest.mock('@/store/createChatStore', () => ({
  useChatStore: {
    getState: () => mockChatState,
  },
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
    mockSafeInvokeOrNull.mockReset();
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

  it('refuses to save when no PiPi Output Folder is available (no binding)', async () => {
    // Two-folder model: the tool requires the session's PiPi Output
    // Folder, not the Project Folder. We mock the store to throw so
    // the tool fails fast on the resolution path; in production the
    // store always has a session for the active tool call.
    const chatStoreMock = await import('@/store/createChatStore');
    const originalGetState = chatStoreMock.useChatStore.getState;
    chatStoreMock.useChatStore.getState = jest.fn(() => ({ sessions: [] })) as never;
    try {
      const result = await savePlanDocTool.execute(
        { markdown: VALID_PLAN_BODY },
        makeContext({ cwd: '/tmp/project' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/PiPi Output Folder/i);
      expect(mockInvoke).not.toHaveBeenCalled();
    } finally {
      chatStoreMock.useChatStore.getState = originalGetState;
    }
  });

  it('uses the session PiPi Output Folder, NOT ToolContext.cwd (the Project Folder)', async () => {
    // Regression: pre-fix the tool used `context.cwd` (= Project
    // Folder) as the destination, which silently wrote plan docs
    // into the user's repo. Verify the new behaviour routes through
    // the session's `pipiOutputDir` and ignores `cwd`.
    mockChatState.sessions = [
      {
        id: 'session-1',
        projectDir: '/home/user/repo',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      },
    ];
    mockInvoke.mockResolvedValue({
      number: '001',
      filename: '001-plan-test.md',
      path: '/home/user/.local/share/PiPi-Shrimp/chats/session-1/.pipi-shrimp/docs/001-plan-test.md',
      index_updated: true,
    });

    await savePlanDocTool.execute(
      { markdown: VALID_PLAN_BODY },
      makeContext({ cwd: '/home/user/repo' }),
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      'create_doc',
      expect.objectContaining({
        // Must be the PiPi Output Folder, NOT the Project Folder.
        workDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }),
    );
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
