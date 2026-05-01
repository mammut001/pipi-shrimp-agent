import { getDatabaseDiagnostics, type DbDiagnostics } from './databaseDiagnostics';
import { useChatStore, useCdpStore, useSettingsStore, useUIStore } from '@/store';

export interface ReleaseDiagnosticsSnapshot {
  generatedAt: string;
  environment: {
    userAgent: string | null;
    language: string | null;
    platform: string | null;
  };
  database: {
    ok: boolean;
    diagnostics: DbDiagnostics | null;
    error: string | null;
  };
  chat: {
    initialized: boolean;
    sessionCount: number;
    projectCount: number;
    currentSessionId: string | null;
    currentMessageCount: number;
    isStreaming: boolean;
    streamingSessionId: string | null;
    pendingToolCalls: number;
    pendingToolResults: number;
    hasError: boolean;
  };
  settings: {
    apiConfigCount: number;
    activeConfigId: string | null;
    activeProvider: string | null;
    activeModel: string | null;
    theme: string;
    language: string;
    maxToolRounds: number;
    hasTelegramToken: boolean;
  };
  ui: {
    currentView: string;
    pendingPermissionCount: number;
    permissionLedgerCount: number;
    notificationCount: number;
    notificationHistoryCount: number;
    taskStepCount: number;
    activeQuestionnaireSessionId: string | null;
  };
  browser: {
    cdpStatus: string;
    cdpFailureReason: string | null;
    cdpErrorMessage: string | null;
    lastSyncedAt: number | null;
    connectionState: unknown;
  };
}

export function buildReleaseDiagnosticsSnapshot(input: {
  generatedAt?: string;
  environment?: Partial<ReleaseDiagnosticsSnapshot['environment']>;
  database: ReleaseDiagnosticsSnapshot['database'];
  chat: ReleaseDiagnosticsSnapshot['chat'];
  settings: ReleaseDiagnosticsSnapshot['settings'];
  ui: ReleaseDiagnosticsSnapshot['ui'];
  browser: ReleaseDiagnosticsSnapshot['browser'];
}): ReleaseDiagnosticsSnapshot {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    environment: {
      userAgent: input.environment?.userAgent ?? null,
      language: input.environment?.language ?? null,
      platform: input.environment?.platform ?? null,
    },
    database: input.database,
    chat: input.chat,
    settings: input.settings,
    ui: input.ui,
    browser: input.browser,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBrowserEnvironment(): ReleaseDiagnosticsSnapshot['environment'] {
  if (typeof navigator === 'undefined') {
    return { userAgent: null, language: null, platform: null };
  }

  return {
    userAgent: navigator.userAgent || null,
    language: navigator.language || null,
    platform: navigator.platform || null,
  };
}

export async function collectReleaseDiagnostics(): Promise<ReleaseDiagnosticsSnapshot> {
  let database: ReleaseDiagnosticsSnapshot['database'];

  try {
    database = {
      ok: true,
      diagnostics: await getDatabaseDiagnostics(),
      error: null,
    };
  } catch (error) {
    database = {
      ok: false,
      diagnostics: null,
      error: toErrorMessage(error),
    };
  }

  const chatState = useChatStore.getState();
  const currentSession = chatState.currentSession();
  const settingsState = useSettingsStore.getState();
  const activeConfig = settingsState.apiConfigs.find((config) => config.id === settingsState.activeConfigId) ?? null;
  const uiState = useUIStore.getState();
  const cdpState = useCdpStore.getState();

  return buildReleaseDiagnosticsSnapshot({
    environment: getBrowserEnvironment(),
    database,
    chat: {
      initialized: chatState.isInitialized,
      sessionCount: chatState.sessions.length,
      projectCount: chatState.projects.length,
      currentSessionId: chatState.currentSessionId,
      currentMessageCount: currentSession?.messages.length ?? 0,
      isStreaming: chatState.isStreaming,
      streamingSessionId: chatState.streamingSessionId,
      pendingToolCalls: chatState.pendingToolCalls,
      pendingToolResults: chatState.pendingToolResults.length,
      hasError: Boolean(chatState.error),
    },
    settings: {
      apiConfigCount: settingsState.apiConfigs.length,
      activeConfigId: settingsState.activeConfigId,
      activeProvider: activeConfig?.provider ?? null,
      activeModel: activeConfig?.model ?? null,
      theme: settingsState.theme,
      language: settingsState.language,
      maxToolRounds: settingsState.agentSettings.maxToolRounds,
      hasTelegramToken: Boolean(settingsState.telegramToken),
    },
    ui: {
      currentView: uiState.currentView,
      pendingPermissionCount: uiState.permissionQueue.length,
      permissionLedgerCount: uiState.permissionLedger.length,
      notificationCount: uiState.notifications.length,
      notificationHistoryCount: uiState.notificationHistory.length,
      taskStepCount: uiState.taskProgress.length,
      activeQuestionnaireSessionId: uiState.activeQuestionnaireSessionId,
    },
    browser: {
      cdpStatus: cdpState.status,
      cdpFailureReason: cdpState.attachFailureReason,
      cdpErrorMessage: cdpState.errorMessage,
      lastSyncedAt: cdpState.lastSyncedAt,
      connectionState: cdpState.connectionState,
    },
  });
}

export function serializeReleaseDiagnostics(snapshot: ReleaseDiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
