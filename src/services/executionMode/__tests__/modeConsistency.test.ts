/**
 * Mode Consistency regression suite.
 *
 * PHASE 2 of the Mode Consistency + AutoResearch Execution audit.
 *
 * These tests are the contract between the 5-mode registry, the
 * permission-mode hooks, the hydration layer, and the persistence
 * path (DB / localStorage / Telegram mirror). They are deliberately
 * wider than the existing `registry.test.ts` so a single regression in
 * any of these surfaces shows up here.
 *
 * Invariants protected:
 *   A. Registry order, default, warning gate, advanced section.
 *   B. 5-mode → 4-mode mapping.
 *   C. Hydration: session.executionMode / session.permissionMode must
 *      always agree, with executionMode as the source of truth.
 *   D. DB / chatHelpers roundtrip preserves both columns.
 *   E. localStorage / Telegram mirror write back the same shape.
 *   F. Direct reads of raw session.executionMode / session.permissionMode
 *      are only allowed inside persistence/serialization code or inside
 *      the resolver itself — every product/tool decision must go
 *      through the resolver.
 */

import { describe, expect, it } from '@jest/globals';

import {
  EXECUTION_MODES,
  getDefaultExecutionMode,
  getExecutionMode,
  executionModeFromPermissionMode,
  hydrateSessionModes,
  isDefaultMode,
  isExecutionModeId,
  isToolAllowedForMode,
  modeRequiresWarning,
  resolvePermissionMode,
  resolveSessionExecutionModeId,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from '../index';
import { dbToSession, sessionToDb } from '@/utils/chatHelpers';
import enUS from '@/i18n/locales/en-US';
import zhCN from '@/i18n/locales/zh-CN';

const REQUIRED_PROFILE_KEYS: Array<keyof ExecutionModeProfile> = [
  'id',
  'labelKey',
  'descriptionKey',
  'icon',
  'riskLevel',
  'permissionMode',
  'allowedToolPolicy',
  'approvalPolicy',
  'isDefault',
  'requiresWarning',
  'isAdvanced',
];

const ALLOWED_PERMISSION_MODES = new Set([
  'standard',
  'auto-edits',
  'bypass',
  'plan-only',
]);

const ALLOWED_ALLOWED_TOOL_POLICIES = new Set([
  'none',
  'plan',
  'read-only',
  'edit',
  'shell',
  'full',
]);

const ALLOWED_APPROVAL_POLICIES = new Set([
  'always-ask',
  'ask-on-risky',
  'auto-safe-only',
  'auto-everything',
]);

const ALLOWED_ICONS = new Set([
  'plan',
  'bug',
  'agent',
  'bypass',
  'ask',
]);

const ALLOWED_RISK_LEVELS = new Set([
  'safe',
  'moderate',
  'elevated',
  'dangerous',
]);

describe('A. Registry invariants', () => {
  it('contains exactly the five documented modes in the documented order', () => {
    expect(EXECUTION_MODES.map((m) => m.id)).toEqual([
      'ask',
      'plan',
      'debug',
      'agent',
      'bypass',
    ]);
  });

  it('Ask is the only default; every other mode is not default', () => {
    const defaults = EXECUTION_MODES.filter((m) => m.isDefault);
    expect(defaults.map((m) => m.id)).toEqual(['ask']);
    expect(isDefaultMode('ask')).toBe(true);
    expect(isDefaultMode('plan')).toBe(false);
    expect(isDefaultMode('debug')).toBe(false);
    expect(isDefaultMode('agent')).toBe(false);
    expect(isDefaultMode('bypass')).toBe(false);
    expect(getDefaultExecutionMode().id).toBe('ask');
  });

  it('Bypass is the only mode that requires a warning', () => {
    expect(modeRequiresWarning('bypass')).toBe(true);
    for (const id of ['ask', 'plan', 'debug', 'agent'] as const) {
      expect(modeRequiresWarning(id)).toBe(false);
    }
  });

  it('Bypass is the only advanced mode (visually separated in the dropdown)', () => {
    const advanced = EXECUTION_MODES.filter((m) => m.isAdvanced);
    expect(advanced.map((m) => m.id)).toEqual(['bypass']);
  });

  it('every profile has the full set of documented fields', () => {
    for (const profile of EXECUTION_MODES) {
      for (const key of REQUIRED_PROFILE_KEYS) {
        expect(profile[key]).toBeDefined();
      }
      expect(ALLOWED_PERMISSION_MODES.has(profile.permissionMode)).toBe(true);
      expect(ALLOWED_ALLOWED_TOOL_POLICIES.has(profile.allowedToolPolicy)).toBe(true);
      expect(ALLOWED_APPROVAL_POLICIES.has(profile.approvalPolicy)).toBe(true);
      expect(ALLOWED_ICONS.has(profile.icon)).toBe(true);
      expect(ALLOWED_RISK_LEVELS.has(profile.riskLevel)).toBe(true);
    }
  });

  it('every labelKey/descriptionKey exists in en-US and zh-CN', () => {
    for (const profile of EXECUTION_MODES) {
      expect(enUS[profile.labelKey]).toBeTruthy();
      expect(enUS[profile.descriptionKey]).toBeTruthy();
      expect(zhCN[profile.labelKey]).toBeTruthy();
      expect(zhCN[profile.descriptionKey]).toBeTruthy();
    }
  });

  it('Bypass risk level is "dangerous" — the only mode at that level', () => {
    const dangerous = EXECUTION_MODES.filter((m) => m.riskLevel === 'dangerous');
    expect(dangerous.map((m) => m.id)).toEqual(['bypass']);
  });

  it('"5-mode" appears in registry/guards copy, no references to 4-mode/6-mode', async () => {
    // Pull the file sources and check for stale wording. A misspelled
    // "6-mode" or a stale "4-mode" reference would silently disagree
    // with the dropdown and the tests above.
    const fs = await import('node:fs');
    const path = await import('node:path');

    const repoRoot = path.resolve(process.cwd());
    const registrySource = fs.readFileSync(
      path.join(repoRoot, 'src/services/executionMode/registry.ts'),
      'utf8',
    );
    const guardsSource = fs.readFileSync(
      path.join(repoRoot, 'src/services/executionMode/guards.ts'),
      'utf8',
    );
    expect(registrySource).toMatch(/5-mode/);
    expect(guardsSource).toMatch(/5-mode/);
    // No stale "4-mode" framing.
    expect(registrySource).not.toMatch(/4-mode/);
    expect(guardsSource).not.toMatch(/4-mode/);
    // No stale "6-mode" framing.
    expect(registrySource).not.toMatch(/6-mode/);
    expect(guardsSource).not.toMatch(/6-mode/);
  });
});

describe('B. Mapping invariants (5-mode → 4-mode permission)', () => {
  it('ask → plan-only / none / always-ask', () => {
    expect(resolvePermissionMode('ask')).toBe('plan-only');
    const profile = getExecutionMode('ask');
    expect(profile.allowedToolPolicy).toBe('none');
    expect(profile.approvalPolicy).toBe('always-ask');
  });

  it('plan → plan-only / plan / always-ask (read-only + save_plan_doc)', () => {
    expect(resolvePermissionMode('plan')).toBe('plan-only');
    const profile = getExecutionMode('plan');
    expect(profile.allowedToolPolicy).toBe('plan');
    expect(profile.approvalPolicy).toBe('always-ask');
  });

  it('debug → auto-edits / edit / auto-safe-only', () => {
    expect(resolvePermissionMode('debug')).toBe('auto-edits');
    const profile = getExecutionMode('debug');
    expect(profile.allowedToolPolicy).toBe('edit');
    expect(profile.approvalPolicy).toBe('auto-safe-only');
  });

  it('agent → auto-edits / shell / ask-on-risky', () => {
    expect(resolvePermissionMode('agent')).toBe('auto-edits');
    const profile = getExecutionMode('agent');
    expect(profile.allowedToolPolicy).toBe('shell');
    expect(profile.approvalPolicy).toBe('ask-on-risky');
  });

  it('bypass → bypass / full / auto-everything', () => {
    expect(resolvePermissionMode('bypass')).toBe('bypass');
    const profile = getExecutionMode('bypass');
    expect(profile.allowedToolPolicy).toBe('full');
    expect(profile.approvalPolicy).toBe('auto-everything');
  });

  it('every 5-mode id maps into a known 4-mode PermissionMode', () => {
    for (const profile of EXECUTION_MODES) {
      expect(ALLOWED_PERMISSION_MODES.has(resolvePermissionMode(profile.id))).toBe(true);
    }
  });

  it('legacy permissionMode → 5-mode mapping matches the documented migration table', () => {
    expect(executionModeFromPermissionMode('plan-only')).toBe('plan');
    expect(executionModeFromPermissionMode('bypass')).toBe('bypass');
    expect(executionModeFromPermissionMode('auto-edits')).toBe('agent');
    expect(executionModeFromPermissionMode('standard')).toBe('agent');
    expect(executionModeFromPermissionMode(undefined)).toBe('ask');
    expect(executionModeFromPermissionMode(null)).toBe('ask');
    // Unknown permissionMode strings must collapse to Ask, never to
    // a tool-capable mode — silently inheriting Agent would let a
    // corrupted row fall into the Agent tool loop.
    expect(executionModeFromPermissionMode('garbage' as unknown as 'standard')).toBe('ask');
  });
});

describe('C. Hydration invariants', () => {
  it('new empty session resolves to Ask', () => {
    expect(resolveSessionExecutionModeId(undefined)).toBe('ask');
    expect(resolveSessionExecutionModeId(null)).toBe('ask');
    expect(resolveSessionExecutionModeId({})).toBe('ask');
  });

  it('Ask session hydrates with executionMode=ask and permissionMode=plan-only', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'ask' });
    expect(hydrated.executionMode).toBe('ask');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('Plan session hydrates with executionMode=plan and permissionMode=plan-only', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'plan' });
    expect(hydrated.executionMode).toBe('plan');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('Debug session hydrates with executionMode=debug and permissionMode=auto-edits', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'debug' });
    expect(hydrated.executionMode).toBe('debug');
    expect(hydrated.permissionMode).toBe('auto-edits');
  });

  it('Agent session hydrates with executionMode=agent and permissionMode=auto-edits', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'agent' });
    expect(hydrated.executionMode).toBe('agent');
    expect(hydrated.permissionMode).toBe('auto-edits');
  });

  it('Bypass session hydrates with executionMode=bypass and permissionMode=bypass', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'bypass' });
    expect(hydrated.executionMode).toBe('bypass');
    expect(hydrated.permissionMode).toBe('bypass');
  });

  it('executionMode wins when both executionMode and permissionMode are set', () => {
    // Ask is the safest mode — if a session was created with
    // executionMode='ask' but a stale permissionMode='bypass', the
    // session must still be treated as Ask.
    const hydrated = hydrateSessionModes({
      executionMode: 'ask',
      permissionMode: 'bypass',
    });
    expect(hydrated.executionMode).toBe('ask');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('legacy permissionMode=bypass with no executionMode hydrates to Bypass', () => {
    const hydrated = hydrateSessionModes({ permissionMode: 'bypass' });
    expect(hydrated.executionMode).toBe('bypass');
    expect(hydrated.permissionMode).toBe('bypass');
  });

  it('legacy permissionMode=plan-only hydrates to Plan (not Ask)', () => {
    const hydrated = hydrateSessionModes({ permissionMode: 'plan-only' });
    expect(hydrated.executionMode).toBe('plan');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('legacy permissionMode=auto-edits hydrates to Agent', () => {
    const hydrated = hydrateSessionModes({ permissionMode: 'auto-edits' });
    expect(hydrated.executionMode).toBe('agent');
    expect(hydrated.permissionMode).toBe('auto-edits');
  });

  it('legacy permissionMode=standard hydrates to Agent', () => {
    const hydrated = hydrateSessionModes({ permissionMode: 'standard' });
    expect(hydrated.executionMode).toBe('agent');
    expect(hydrated.permissionMode).toBe('auto-edits');
  });

  it('invalid executionMode string falls back safely to Ask', () => {
    const hydrated = hydrateSessionModes({
      executionMode: 'multitask' as unknown as ExecutionModeId,
      permissionMode: 'bypass',
    });
    expect(hydrated.executionMode).toBe('ask');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('createSession persists the registry default Ask mode', async () => {
    const { createSession } = await import('@/types/chat');
    const session = createSession();
    expect(session.executionMode).toBe('ask');
    expect(session.permissionMode).toBe('plan-only');
  });

  it('resolveSessionExecutionModeId never returns an invalid id for any input shape', () => {
    const inputs = [
      undefined,
      null,
      {},
      { executionMode: 'unknown' },
      { executionMode: 'ASK' },
      { permissionMode: 'unknown' },
      { executionMode: 'ask', permissionMode: 'auto-edits' },
    ];
    for (const input of inputs) {
      const resolved = resolveSessionExecutionModeId(input as never);
      expect(isExecutionModeId(resolved)).toBe(true);
    }
  });
});

describe('C.2 DB roundtrip preserves executionMode + permissionMode', () => {
  it('dbToSession → sessionToDb is a lossless roundtrip for every mode', () => {
    for (const profile of EXECUTION_MODES) {
      const session = dbToSession(
        {
          id: 'sess-1',
          title: 'Roundtrip',
          created_at: 1,
          updated_at: 2,
          cwd: null,
          project_id: null,
          model: null,
          work_dir: null,
          project_dir: null,
          pipi_output_dir: null,
          working_files: null,
          permission_mode: profile.permissionMode,
          execution_mode: profile.id,
        },
        [],
      );
      expect(session.executionMode).toBe(profile.id);
      expect(session.permissionMode).toBe(profile.permissionMode);

      const serialized = sessionToDb(session);
      expect(serialized.execution_mode).toBe(profile.id);
      expect(serialized.permission_mode).toBe(profile.permissionMode);
    }
  });

  it('pre-v7 row (execution_mode null, permission_mode=auto-edits) hydrates to Agent', () => {
    const session = dbToSession(
      {
        id: 'legacy-1',
        title: 'Legacy',
        created_at: 1,
        updated_at: 1,
        cwd: null,
        project_id: null,
        model: null,
        work_dir: '/tmp/legacy',
        project_dir: null,
        pipi_output_dir: null,
        working_files: null,
        permission_mode: 'auto-edits',
        execution_mode: null,
      },
      [],
    );
    expect(session.executionMode).toBe('agent');
    expect(session.permissionMode).toBe('auto-edits');
  });

  it('pre-v7 row (execution_mode null, permission_mode=bypass) hydrates to Bypass', () => {
    const session = dbToSession(
      {
        id: 'legacy-2',
        title: 'Legacy Bypass',
        created_at: 1,
        updated_at: 1,
        cwd: null,
        project_id: null,
        model: null,
        work_dir: null,
        project_dir: null,
        pipi_output_dir: null,
        working_files: null,
        permission_mode: 'bypass',
        execution_mode: null,
      },
      [],
    );
    expect(session.executionMode).toBe('bypass');
    expect(session.permissionMode).toBe('bypass');
  });
});

describe('D. Telegram / session mirror preservation', () => {
  // The Telegram mirror writes new sessions through createSession +
  // hydrateSessionModes + the binding's defaultPermissionMode. This
  // simulates that path without booting the Tauri runtime.
  it('Telegram-bound session hydrates defaultPermissionMode into the resolver', () => {
    const bindingDefaultPermission = 'bypass';
    const session = {
      ...hydrateSessionModes({ permissionMode: bindingDefaultPermission }),
    };
    expect(session.executionMode).toBe('bypass');
    expect(session.permissionMode).toBe('bypass');
  });

  it('Telegram-bound session with defaultPermissionMode=auto-edits hydrates to Agent', () => {
    const session = hydrateSessionModes({ permissionMode: 'auto-edits' });
    expect(session.executionMode).toBe('agent');
    expect(session.permissionMode).toBe('auto-edits');
  });

  it('Telegram-bound session with defaultPermissionMode=plan-only hydrates to Plan', () => {
    const session = hydrateSessionModes({ permissionMode: 'plan-only' });
    expect(session.executionMode).toBe('plan');
    expect(session.permissionMode).toBe('plan-only');
  });
});

describe('E. localStorage / chat draft persistence does not leak modes', () => {
  // localStorage holds draft text + lastTouchedAt; it does NOT persist
  // session mode. We assert that because ChatInput's draft code never
  // touches session.executionMode / session.permissionMode — only the
  // composer dropdown does. If a future regression sneaks a draft
  // mode key in, this test fails loudly.
  it('ChatInput draft code does not read or write executionMode/permissionMode', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/ChatInput.tsx'),
      'utf8',
    );
    // The dropdown uses `resolveSessionExecutionModeId`, not raw
    // session.executionMode / session.permissionMode. No code should
    // dereference those fields directly.
    expect(source).not.toMatch(/session\.executionMode\s*[=!]/);
    expect(source).not.toMatch(/session\.permissionMode\s*[=!]/);
    // No localStorage key that mirrors mode state.
    expect(source).not.toMatch(/localStorage\.(?:setItem|getItem)[^;]*executionMode/);
    expect(source).not.toMatch(/localStorage\.(?:setItem|getItem)[^;]*permissionMode/);
  });
});

describe('F. Resolver is the canonical source of truth', () => {
  // Audit every TypeScript file under src/ for direct reads of
  // session.executionMode / session.permissionMode / currentSession.executionMode /
  // currentSession.permissionMode. The allowed exceptions are:
  //   - the registry / guards source of truth,
  //   - persistence code (utils/chatHelpers, types/chat, src-tauri),
  //   - direct equality guards that are READ-ONLY.
  //   A read that is followed by an `=== 'bypass'` style comparison
  //   inside chatActions / chatToolExecution is still classified as a
  //   product decision and must go through the resolver.
  it('product code consults the resolver, never raw mode fields', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const allowList = new Set<string>([
      // Source of truth + persistence
      path.resolve('src/services/executionMode/index.ts'),
      path.resolve('src/services/executionMode/registry.ts'),
      path.resolve('src/services/executionMode/guards.ts'),
      path.resolve('src/utils/chatHelpers.ts'),
      path.resolve('src/types/chat.ts'),
      // Migration / Telegram mirror — hydrates via canonical resolver
      path.resolve('src/services/telegram/sessionMirror.ts'),
      // Mirror drop-in: same hydration path as createSession
      path.resolve('src/store/createChatStore.ts'),
    ]);

    const suspect = /(?:session|currentSession)\.executionMode\s*[=!]|(?:session|currentSession)\.permissionMode\s*[=!]/g;

    const offenders: Array<{ file: string; line: number; snippet: string }> = [];

    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (allowList.has(path.resolve(full))) continue;
        const text = fs.readFileSync(full, 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, idx) => {
          if (suspect.test(line)) {
            offenders.push({ file: full, line: idx + 1, snippet: line.trim() });
          }
          suspect.lastIndex = 0;
        });
      }
    };

    walk(path.resolve('src'));

    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  ${path.relative(process.cwd(), o.file)}:${o.line}  ${o.snippet}`)
        .join('\n');
      throw new Error(
        `Product code must use resolveSessionExecutionModeId/resolvePermissionMode, not raw session.executionMode / session.permissionMode:\n${summary}`,
      );
    }
  });
});

describe('G. Tool allow-list per mode (outer guard)', () => {
  it('Ask blocks every tool regardless of name', () => {
    const tools = [
      'read_file', 'write_file', 'create_directory', 'edit_file',
      'list_files', 'path_exists', 'search_files', 'glob_search',
      'grep_files', 'get_current_workspace',
      'execute_command', 'run_in_terminal',
      'ssh_exec', 'ssh_read_file', 'ssh_upload_file',
      'browser_navigate', 'browser_click', 'browser_type',
      'browser_scroll', 'browser_press_key', 'browser_wait',
      'mcp__tool', 'agent_tool',
    ];
    for (const tool of tools) {
      expect(isToolAllowedForMode('ask', tool)).toBe(false);
    }
  });

  it('Plan allows read-only inspection + save_plan_doc and blocks side-effecting tools', () => {
    // Plan mode is read-only inspection + plan-doc persistence. The
    // exact allowlist lives in PLAN_MODE_ALLOWED_TOOLS so all three
    // enforcement layers (registry, preToolUseHooks, chatActions)
    // stay in sync.
    expect(isToolAllowedForMode('plan', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('plan', 'list_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'search_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'save_plan_doc')).toBe(true);

    const blocked = [
      'write_file', 'edit_file', 'create_directory', 'delete_file',
      'execute_command', 'run_in_terminal',
      'browser_navigate', 'browser_click', 'browser_type',
      'ssh_exec', 'ssh_read_file', 'ssh_upload_file',
      'mcp__tool', 'agent_tool',
    ];
    for (const tool of blocked) {
      expect(isToolAllowedForMode('plan', tool)).toBe(false);
    }
  });

  it('Debug allows read + edit but blocks shell/browser/ssh/mcp/agent_tool', () => {
    expect(isToolAllowedForMode('debug', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('debug', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('debug', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('debug', 'ssh_exec')).toBe(false);
    expect(isToolAllowedForMode('debug', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('debug', 'mcp__tool')).toBe(false);
    expect(isToolAllowedForMode('debug', 'agent_tool')).toBe(false);
  });

  it('Agent allows shell but still blocks ssh/browser/mcp/agent_tool', () => {
    expect(isToolAllowedForMode('agent', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('agent', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('agent', 'execute_command')).toBe(true);
    expect(isToolAllowedForMode('agent', 'run_in_terminal')).toBe(true);
    expect(isToolAllowedForMode('agent', 'ssh_exec')).toBe(false);
    expect(isToolAllowedForMode('agent', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('agent', 'mcp__tool')).toBe(false);
    expect(isToolAllowedForMode('agent', 'agent_tool')).toBe(false);
  });

  it('Bypass allows everything under the registry allow-list', () => {
    expect(isToolAllowedForMode('bypass', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'execute_command')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'ssh_exec')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'browser_click')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'mcp__tool')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'agent_tool')).toBe(true);
  });
});
