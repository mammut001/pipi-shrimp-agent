/**
 * i18n key parity tests
 *
 * The en-US and zh-CN bundles must expose the same set of keys. Otherwise
 * a missing translation silently falls back to the key itself in the UI
 * (see `t()` in `@/i18n/index.ts`). These tests catch the "I added a key
 * to en-US but forgot zh-CN" regression, which is the failure mode that
 * most often bites us when shipping copy changes.
 */

import { describe, it, expect } from '@jest/globals';
import enUS from '@/i18n/locales/en-US';
import zhCN from '@/i18n/locales/zh-CN';

type Keys = keyof typeof enUS;

const EN_KEYS = Object.keys(enUS) as Keys[];
const ZH_KEYS = Object.keys(zhCN) as Keys[];

function diff<T>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right);
  return left.filter((key) => !rightSet.has(key));
}

describe('i18n key parity', () => {
  it('zh-CN has every key en-US has', () => {
    const missingInZh = diff<string>(EN_KEYS, ZH_KEYS);
    expect(missingInZh).toEqual([]);
  });

  it('en-US has every key zh-CN has (catches accidental zh-only drift)', () => {
    const missingInEn = diff<string>(ZH_KEYS, EN_KEYS);
    expect(missingInEn).toEqual([]);
  });

  it('en-US translations for new workspace/context copy are non-empty', () => {
    // Spot-check the keys added in the Workspace Folder / Context Files
    // rename so an empty string can't sneak through.
    const requiredKeys: Keys[] = [
      'chat.workspaceFolder',
      'chat.workspaceFolderTooltip',
      'chat.setWorkspaceFolder',
      'chat.noWorkspaceHint',
      'chat.contextFiles',
      'chat.contextFileExternal',
      'chat.contextFileInsideWorkspace',
      'chat.contextFileSetAsWorkspace',
      'chat.useAsWorkspace',
      'chat.input.contextFilesHeader',
      'chat.input.contextFilesSubtitle',
      'chat.input.contextFilesNotWorkspace',
    ];
    for (const key of requiredKeys) {
      const value = enUS[key];
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('zh-CN translations for new workspace/context copy are non-empty', () => {
    const requiredKeys: Keys[] = [
      'chat.workspaceFolder',
      'chat.workspaceFolderTooltip',
      'chat.setWorkspaceFolder',
      'chat.noWorkspaceHint',
      'chat.contextFiles',
      'chat.contextFileExternal',
      'chat.contextFileInsideWorkspace',
      'chat.contextFileSetAsWorkspace',
      'chat.useAsWorkspace',
      'chat.input.contextFilesHeader',
      'chat.input.contextFilesSubtitle',
      'chat.input.contextFilesNotWorkspace',
    ];
    for (const key of requiredKeys) {
      const value = zhCN[key];
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('removes keys that were retired during the Workspace Folder / Context Files rename', () => {
    // AUDIT-FIX — These keys are explicitly retired. If a future refactor
    // accidentally resurrects them, the test will fail loudly. The keys
    // are also not referenced anywhere in `src/` (see
    // `tools/find-unused-i18n-keys.mjs`).
    const retiredKeys: Keys[] = [
      // Renamed/restructured
      'chat.bindWorkFolder',
      'chat.workspaceFolderDescription',
      'chat.workspaceFolderNotSet',
      'chat.setWorkspaceFolderHint',
      // Early-draft "Context Files" copy that was never wired into JSX
      'chat.contextFile',
      'chat.contextFilesEmpty',
      'chat.dropFilesAsContextFiles',
      'chat.dropFilesAsContextFilesDescription',
      // Chat-input alt copy that the final UI never used
      'chat.input.dropFiles',
      'chat.input.attachFile',
      'chat.input.filesSelected',
      'chat.input.filesWillBeAddedToList',
    ];
    for (const key of retiredKeys) {
      expect(EN_KEYS).not.toContain(key);
      expect(ZH_KEYS).not.toContain(key);
    }
  });
});
