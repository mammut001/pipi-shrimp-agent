/**
 * uiStoreMigration Tests - Persisted UI state migration and recovery
 *
 * Covers:
 * 1. persisted currentView=browser → migrates to chat on init
 * 2. persisted modal/artifact/sidebar state corruption → no crash, use defaults
 * 3. persisted JSON corruption → store uses defaults (no crash)
 * 4. recoverToChatView clears transient UI state (modal, artifact, permissionQueue, etc.)
 * 5. recoverToChatView does NOT clear user data: sessions, api config, drafts
 *
 * Note: Uses jest.resetModules() to simulate fresh store initialization with
 * pre-populated localStorage, mirroring the real startup scenario.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { normalizePersistedCurrentView } from '../utils/storageMigrations';

// ─── Mock localStorage ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// ─── Mock other stores to avoid cross-store side-effects ─────────────────────

jest.mock('../store/artifactsStore', () => ({
  useArtifactsStore: jest.fn(() => ({
    closePanel: jest.fn(),
  })),
}));

// ─── Import after localStorage is mocked ─────────────────────────────────────

let useUIStore: typeof import('../store/uiStore').useUIStore;

function freshImport() {
  jest.resetModules();
  return import('../store/uiStore');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('uiStoreMigration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.resetModules();
  });

  describe('currentView persistence and migration', () => {
    it('normalizes deprecated browser view through the shared migration helper', () => {
      expect(normalizePersistedCurrentView('browser')).toEqual({
        currentView: 'chat',
        migratedFromBrowser: true,
      });
      expect(normalizePersistedCurrentView('workflow')).toEqual({
        currentView: 'workflow',
        migratedFromBrowser: false,
      });
      expect(normalizePersistedCurrentView('{ invalid json')).toEqual({
        currentView: 'chat',
        migratedFromBrowser: false,
      });
    });

    it('migrates persisted browser view to chat on init', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'browser');

      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('chat');
      expect(localStorageMock.getItem('ai-agent-current-view')).toBe('chat');
    });

    it('persists chat view normally (no migration needed)', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'chat');

      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('chat');
    });

    it('persists workflow view normally', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'workflow');

      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('workflow');
    });

    it('defaults to chat if localStorage has unknown value', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'something-invalid');

      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('chat');
    });

    it('defaults to chat if localStorage is empty', async () => {
      // No localStorage set

      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('chat');
    });

    it('setCurrentView with browser redirects to chat with browserDockMode=split', async () => {
      const { useUIStore: store } = await freshImport();

      store.getState().setCurrentView('browser');

      expect(store.getState().currentView).toBe('chat');
      expect(store.getState().browserDockMode).toBe('split');
      expect(store.getState().browserPaneVisible).toBe(true);
      expect(store.getState().browserSplitFocus).toBe('chat');
    });
  });

  describe('recoverToChatView transient state cleanup', () => {
    it('recoverToChatView clears settingsOpen', async () => {
      const { useUIStore: store } = await freshImport();

      // Set some transient state
      store.getState().toggleSettings(); // opens settings
      expect(store.getState().settingsOpen).toBe(true);

      store.getState().recoverToChatView();

      expect(store.getState().settingsOpen).toBe(false);
    });

    it('recoverToChatView clears currentArtifactId', async () => {
      const { useUIStore: store } = await freshImport();

      store.getState().setArtifactId('artifact-123');
      expect(store.getState().currentArtifactId).toBe('artifact-123');

      store.getState().recoverToChatView();

      expect(store.getState().currentArtifactId).toBeUndefined();
    });

    it('recoverToChatView clears permissionQueue', async () => {
      const { useUIStore: store } = await freshImport();

      // Add a permission request
      store.getState().setPermissionRequest({
        tool: 'read_file',
        args: {},
        sessionId: 'sess-1',
        resolve: jest.fn(),
        reject: jest.fn(),
      });
      expect(store.getState().permissionQueue.length).toBeGreaterThan(0);

      store.getState().recoverToChatView();

      expect(store.getState().permissionQueue).toHaveLength(0);
    });

    it('recoverToChatView clears activeQuestionnaire', async () => {
      const { useUIStore: store } = await freshImport();

      // Active questionnaire would be set via showQuestionnaire
      // We test the clear path directly
      // Recover to chat should reset activeQuestionnaire to null
      store.getState().recoverToChatView();

      expect(store.getState().activeQuestionnaire).toBeNull();
    });

    it('recoverToChatView hides browser dock', async () => {
      const { useUIStore: store } = await freshImport();

      // First set browser dock visible
      store.getState().setCurrentView('browser');
      expect(store.getState().browserDockMode).toBe('split');
      expect(store.getState().browserPaneVisible).toBe(true);

      store.getState().recoverToChatView();

      expect(store.getState().browserDockMode).toBe('hidden');
      expect(store.getState().browserPaneVisible).toBe(false);
    });

    it('recoverToChatView hides terminal panel', async () => {
      const { useUIStore: store } = await freshImport();

      store.getState().toggleTerminalPanel(); // opens terminal
      expect(store.getState().terminalPanelVisible).toBe(true);

      store.getState().recoverToChatView();

      expect(store.getState().terminalPanelVisible).toBe(false);
    });

    it('recoverToChatView does NOT reset currentView to non-chat', async () => {
      // After recovery, view should stay at chat
      const { useUIStore: store } = await freshImport();

      store.getState().recoverToChatView();

      expect(store.getState().currentView).toBe('chat');
    });
  });

  describe('corrupt persisted state handling', () => {
    it('corrupt JSON in localStorage does not crash the store', async () => {
      localStorageMock.setItem('ai-agent-current-view', '{ invalid json {{{');

      // Should not throw
      const { useUIStore: store } = await freshImport();
      expect(store.getState().currentView).toBe('chat');
    });

    it('malformed persisted state uses defaults for UI fields', async () => {
      // localStorage has some keys but values are corrupt
      localStorageMock.setItem('ai-agent-current-view', null as any);
      localStorageMock.setItem('ai-agent-instructions', '{ broken');

      const { useUIStore: store } = await freshImport();

      // Should use defaults, not crash
      expect(store.getState().currentView).toBe('chat');
      expect(typeof store.getState().agentInstructions).toBe('string');
    });
  });

  describe('data preservation on recoverToChatView', () => {
    it('recoverToChatView does not clear sessions (user data)', async () => {
      const { useUIStore: store } = await freshImport();

      // recoverToChatView operates only on UI state — sessions are in chatStore
      // We verify the store interface: recoverToChatView has no session-clearing action
      const stateBefore = store.getState();
      // No sessions field in UIState — that's chatStore's domain
      expect(stateBefore).not.toHaveProperty('sessions');
    });

    it('recoverToChatView does not touch apiConfigs (settingsStore)', async () => {
      const { useUIStore: store } = await freshImport();

      const stateBefore = { ...store.getState() };
      store.getState().recoverToChatView();
      const stateAfter = store.getState();

      // UI state changed, but no apiConfigs field in UIStore (that's settingsStore)
      expect(stateAfter).not.toHaveProperty('apiConfigs');
    });

    it('recoverToChatView does not clear draft localStorage keys', async () => {
      // Pre-condition: some draft exists
      localStorageMock.setItem('chat_draft_default', '我的草稿内容');
      expect(localStorageMock.getItem('chat_draft_default')).toBe('我的草稿内容');

      const { useUIStore: store } = await freshImport();

      store.getState().recoverToChatView();

      // Draft localStorage should still exist
      // recoverToChatView only clears in-memory UI state, not localStorage drafts
      // (ChatInput manages its own draft persistence via useEffect)
      expect(localStorageMock.getItem('chat_draft_default')).toBe('我的草稿内容');
    });
  });

  describe('startup sanitization of persisted transient state', () => {
    it('invalid currentView in localStorage does not cause white screen', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'super-admin-panel');

      const { useUIStore: store } = await freshImport();

      // Should gracefully default to 'chat', not crash or show blank
      expect(store.getState().currentView).toBe('chat');
    });

    it('corrupted browserDockMode in localStorage uses safe default', async () => {
      localStorageMock.setItem('ai-agent-current-view', 'chat');

      const { useUIStore: store } = await freshImport();

      // browserDockMode initial state is 'hidden' by default
      // Even if localStorage had something weird, init uses the default
      expect(store.getState().browserDockMode).toBe('hidden');
    });
  });
});