/**
 * setSessionWorkDirFromPath — store-level test
 *
 * Covers the new "bind a known path" action that's wired to the
 * "Set parent folder as workspace?" toast in `FileDropOverlay`. The test
 * stubs Tauri's `invoke` so we don't need the desktop runtime, and
 * exercises the public action through `useChatStore`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const invokeMock = jest.fn(async (cmd: string) => {
  // Two-folder model: `setSessionWorkDirFromPath` is a backwards-compatible
  // alias for `setSessionProjectDirFromPath`, which routes through
  // `bindSessionWorkDirPath`. That helper first auto-provisions a PiPi
  // Output Folder (`get_app_default_dir` + `create_directory` +
  // `db_save_session`), then runs `init_pipi_shrimp` against the
  // PiPi Output Folder (NOT the Project Folder — see `createChatStore`).
  // The Project Folder bind itself is the trailing `db_save_session`.
  if (cmd === 'get_app_default_dir') return '/default/pipi-output';
  if (cmd === 'create_directory') return null;
  if (cmd === 'init_pipi_shrimp') return `${process.cwd()}|existing`;
  if (cmd === 'db_save_session') return null;
  if (cmd === 'read_file') return { content: '' };
  if (cmd === 'list_files') return [];
  if (cmd === 'write_file') return null;
  return null;
});

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      addNotification: jest.fn(),
    }),
  },
}));

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
  configurable: true,
});

// Imported *after* the mocks above so they take effect.
import { useChatStore } from '@/store/createChatStore';
import { createSession } from '@/types/chat';

describe('useChatStore.setSessionWorkDirFromPath', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useChatStore.setState({
      sessions: [{ ...createSession('Chat 1'), id: 'session-1' }],
      currentSessionId: 'session-1',
    });
  });

  it('binds the supplied path and persists the session to the DB', async () => {
    const path = '/tmp/proj';
    const bound = await useChatStore.getState().setSessionWorkDirFromPath('session-1', path);
    expect(bound).toBe(path);

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1');
    expect(session?.workDir).toBe(path);

    const calls = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(calls).toContain('init_pipi_shrimp');
    expect(calls).toContain('db_save_session');
  });

  it('returns null and does not call invoke when path is empty / blank', async () => {
    const bound1 = await useChatStore.getState().setSessionWorkDirFromPath('session-1', '');
    const bound2 = await useChatStore.getState().setSessionWorkDirFromPath('session-1', '   ');
    expect(bound1).toBeNull();
    expect(bound2).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns null when the session does not exist', async () => {
    const bound = await useChatStore.getState().setSessionWorkDirFromPath('does-not-exist', '/tmp/proj');
    expect(bound).toBeNull();
    // init_pipi_shrimp may still fire as part of the shared init flow, but
    // the session write must not happen and the in-memory store is unchanged.
    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1');
    expect(session?.workDir).toBeUndefined();
  });
});
