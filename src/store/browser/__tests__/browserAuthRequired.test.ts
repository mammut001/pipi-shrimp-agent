import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const executeCdpTaskMock = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(async () => jest.fn()),
}));

jest.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: jest.fn(),
  requestPermission: jest.fn(async () => 'granted'),
  isPermissionGranted: jest.fn(async () => true),
}));

jest.mock('../../../i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../../../store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: () => ({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-5',
        baseUrl: '',
      }),
    }),
  },
}));

jest.mock('../../../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addNotification: jest.fn() }),
  },
}));

jest.mock('../../../store/browserObservabilityStore', () => ({
  useBrowserObservabilityStore: {
    getState: () => ({
      setNativeRunStats: jest.fn(),
    }),
  },
}));

jest.mock('../../../store/taskRegistryStore', () => ({
  registerDiagnosticsTask: jest.fn(),
  registerDiagnosticsTaskCancel: jest.fn(),
  updateDiagnosticsTask: jest.fn(),
}));

jest.mock('../../../utils/browserCommands', () => ({
  openEmbeddedSurface: jest.fn(async () => undefined),
  closeEmbeddedSurface: jest.fn(async () => undefined),
  executeAgentTask: jest.fn(async () => undefined),
  executeOnEmbeddedSurface: jest.fn(async () => undefined),
  inspectEmbeddedSurface: jest.fn(async () => ({
    url: 'https://example.com',
    title: 'Example',
    safeForAgent: true,
  })),
  captureScreenshot: jest.fn(async () => 'data:image/png;base64,fake'),
  setEmbeddedSurfaceVisibility: jest.fn(async () => undefined),
}));

jest.mock('../../../utils/browserFeatureFlags', () => ({
  isBrowserPageAgentLegacyEnabled: jest.fn(() => false),
  isBrowserVisionFallbackEnabled: jest.fn(() => false),
  getBrowserLivePreviewIntervalMs: jest.fn(() => 2000),
  resolveBrowserActionPermissionMode: jest.fn(() => 'auto_safe'),
}));

jest.mock('../../../utils/browserPageStateClient', () => ({
  getCurrentBrowserUrl: jest.fn(async () => 'https://example.com/login'),
}));

jest.mock('../../../utils/nativeBrowserAgent', () => ({
  executeNativeBrowserTask: (...args: unknown[]) => executeCdpTaskMock(...args),
}));

const baseStoreState = {
  status: 'ready_for_agent' as const,
  isWindowOpen: true,
  currentUrl: 'https://example.com/login',
  pendingTask: {
    id: 'browser-task-1',
    connectorType: 'browser_web' as const,
    siteProfileId: 'manual-browser',
    targetUrl: 'https://example.com/login',
    userIntent: 'Complete login flow',
    executionPrompt: 'Complete login flow',
    requiresLogin: true,
    authPolicy: 'manual_login_required' as const,
    executionMode: 'cdp' as const,
    allowedControlMode: 'agent_controlled' as const,
  },
  authState: 'auth_required' as const,
  inspection: {
    url: 'https://example.com/login',
    title: 'Login',
    safeForAgent: false,
    authState: 'auth_required' as const,
    blockReason: 'login_required' as const,
    detectedLoginForm: true,
    detectedCaptcha: false,
  },
  _abortController: null,
  _taskRunToken: 0,
  pendingBrowserActionApproval: null,
};

let useBrowserAgentStore: typeof import('../../browserAgentStore').useBrowserAgentStore;

describe('browserAgentStore auth_required gate (R3-03)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    useBrowserAgentStore.setState(baseStoreState);
  });

  it('cdp_agent_start_blocks_when_auth_required', async () => {
    await useBrowserAgentStore.getState().executeTask('Complete login flow');

    expect(executeCdpTaskMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().status).toBe('error');
    expect(useBrowserAgentStore.getState().status).not.toBe('running');
  });

  it('blocked_auth_required_sets_safe_status_or_message', async () => {
    await useBrowserAgentStore.getState().executeTask('Complete login flow');

    expect(useBrowserAgentStore.getState().error).toBe('browser.authRequiredBeforeAgent');
    expect(useBrowserAgentStore.getState().error).not.toContain('password');
    expect(useBrowserAgentStore.getState().error).not.toContain('token');
  });

  it('auth_not_required_success_path_unchanged', async () => {
    useBrowserAgentStore.setState({
      authState: 'unknown',
      inspection: {
        ...baseStoreState.inspection,
        safeForAgent: true,
        authState: 'unknown',
      },
    });
    executeCdpTaskMock.mockResolvedValueOnce('done');

    await useBrowserAgentStore.getState().executeTask('Complete login flow');

    expect(executeCdpTaskMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('completed');
  });

  it('force_resume_without_auth_allows_cdp_start', async () => {
    useBrowserAgentStore.setState({
      status: 'waiting_user_resume',
      waitingForUserResume: true,
    });
    executeCdpTaskMock.mockResolvedValueOnce('forced');

    await useBrowserAgentStore.getState().forceResumeWithoutAuth();

    expect(executeCdpTaskMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('completed');
    expect(useBrowserAgentStore.getState().authState).toBe('unknown');
  });
});