import { describe, expect, it } from '@jest/globals';
import { buildReleaseDiagnosticsSnapshot, serializeReleaseDiagnostics } from '../releaseDiagnostics';

const baseSnapshotInput = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  environment: { userAgent: 'test-agent' },
  database: { ok: false, diagnostics: null, error: 'offline' },
  chat: {
    initialized: true,
    sessionCount: 2,
    projectCount: 1,
    currentSessionId: 'session-1',
    currentMessageCount: 4,
    isStreaming: false,
    streamingSessionId: null,
    pendingToolCalls: 0,
    pendingToolResults: 0,
    hasError: false,
  },
  settings: {
    apiConfigCount: 1,
    activeConfigId: 'config-1',
    activeProvider: 'anthropic',
    activeModel: 'claude-test',
    theme: 'light',
    language: 'en-US',
    maxToolRounds: 50,
    hasTelegramToken: false,
  },
  ui: {
    currentView: 'chat',
    pendingPermissionCount: 0,
    permissionLedgerCount: 3,
    notificationCount: 1,
    notificationHistoryCount: 5,
    taskStepCount: 2,
    activeQuestionnaireSessionId: null,
  },
  browser: {
    cdpStatus: 'disconnected',
    cdpFailureReason: null,
    cdpErrorMessage: null,
    lastSyncedAt: null,
    connectionState: null,
  },
};

describe('releaseDiagnostics', () => {
  it('builds a stable diagnostics snapshot without requiring browser globals', () => {
    const snapshot = buildReleaseDiagnosticsSnapshot(baseSnapshotInput);

    expect(snapshot.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.environment).toEqual({ userAgent: 'test-agent', language: null, platform: null });
    expect(snapshot.database.error).toBe('offline');
    expect(snapshot.chat.sessionCount).toBe(2);
    expect(snapshot.settings.activeModel).toBe('claude-test');
  });

  it('serializes diagnostics as readable JSON', () => {
    const serialized = serializeReleaseDiagnostics(buildReleaseDiagnosticsSnapshot(baseSnapshotInput));

    expect(JSON.parse(serialized).ui.permissionLedgerCount).toBe(3);
    expect(serialized).toContain('\n  "generatedAt"');
  });
});
