import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const executeCdpTaskMock = jest.fn<(...args: unknown[]) => Promise<string>>();
const getCurrentBrowserUrlMock = jest.fn<() => Promise<string>>();

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
    url: 'https://example.com/preview',
    title: 'Preview',
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
  getCurrentBrowserUrl: () => getCurrentBrowserUrlMock(),
}));

jest.mock('../../../utils/nativeBrowserAgent', () => ({
  executeNativeBrowserTask: (...args: unknown[]) => executeCdpTaskMock(...args),
}));

const baseStoreState = {
  status: 'ready_for_agent' as const,
  isWindowOpen: true,
  currentUrl: 'https://example.com/preview',
  pendingTask: {
    id: 'browser-task-1',
    connectorType: 'browser_web' as const,
    siteProfileId: 'manual-browser',
    targetUrl: 'https://example.com/preview',
    userIntent: 'Inspect page',
    executionPrompt: 'Inspect page',
    requiresLogin: false,
    authPolicy: 'none' as const,
    executionMode: 'cdp' as const,
    allowedControlMode: 'agent_controlled' as const,
  },
  authState: 'unknown' as const,
  inspection: {
    url: 'https://example.com/preview',
    title: 'Preview',
    safeForAgent: true,
    authState: 'unknown' as const,
    blockReason: null,
    detectedLoginForm: false,
    detectedCaptcha: false,
  },
  _abortController: null,
  _taskRunToken: 0,
  pendingBrowserActionApproval: null,
};

let useBrowserAgentStore: typeof import('../../browserAgentStore').useBrowserAgentStore;

describe('browserAgentStore surface mismatch gate (R3-04)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    getCurrentBrowserUrlMock.mockReset();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    useBrowserAgentStore.setState(baseStoreState);
  });

  it('cdp_agent_blocks_when_preview_url_differs_from_cdp_url', async () => {
    getCurrentBrowserUrlMock.mockResolvedValueOnce('https://other.example.com/agent');

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(getCurrentBrowserUrlMock).toHaveBeenCalledTimes(1);
    expect(executeCdpTaskMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().status).toBe('error');
    expect(useBrowserAgentStore.getState().status).not.toBe('running');
  });

  it('mismatch_sets_safe_user_message', async () => {
    getCurrentBrowserUrlMock.mockResolvedValueOnce(
      'https://other.example.com/agent?token=super-secret',
    );

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(useBrowserAgentStore.getState().error).toBe('browser.surfaceMismatchBeforeAgent');
    expect(useBrowserAgentStore.getState().error).not.toContain('super-secret');
  });

  it('matching_url_allows_cdp_start', async () => {
    getCurrentBrowserUrlMock.mockResolvedValueOnce('https://example.com/preview/');
    executeCdpTaskMock.mockResolvedValueOnce('done');

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(executeCdpTaskMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('completed');
  });

  it('www_subdomain_variant_allows_cdp_start', async () => {
    getCurrentBrowserUrlMock.mockResolvedValue('https://www.iana.org/');
    useBrowserAgentStore.setState({
      currentUrl: 'https://iana.org/',
      inspection: {
        ...baseStoreState.inspection,
        url: 'https://iana.org/',
      },
      pendingTask: {
        ...baseStoreState.pendingTask,
        targetUrl: 'https://iana.org/',
      },
    });
    executeCdpTaskMock.mockResolvedValueOnce('done');

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(executeCdpTaskMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('completed');
  });

  it('unknown_cdp_url_blocks', async () => {
    getCurrentBrowserUrlMock.mockRejectedValueOnce(new Error('CDP disconnected'));

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(executeCdpTaskMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().error).toBe('browser.surfaceMismatchBeforeAgent');
  });

  it('auth_gate_still_blocks_after_surface_match', async () => {
    getCurrentBrowserUrlMock.mockResolvedValueOnce('https://example.com/preview');
    useBrowserAgentStore.setState({
      authState: 'auth_required',
      inspection: {
        ...baseStoreState.inspection,
        safeForAgent: false,
        authState: 'auth_required',
      },
    });

    await useBrowserAgentStore.getState().executeTask('Inspect page');

    expect(executeCdpTaskMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().error).toBe('browser.authRequiredBeforeAgent');
  });

  it('forceResumeWithoutAuth_does_not_bypass_surface_mismatch', async () => {
    getCurrentBrowserUrlMock.mockResolvedValueOnce('https://other.example.com/agent');
    useBrowserAgentStore.setState({
      status: 'waiting_user_resume',
      waitingForUserResume: true,
      authState: 'auth_required',
    });

    await useBrowserAgentStore.getState().forceResumeWithoutAuth();

    expect(executeCdpTaskMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().error).toBe('browser.surfaceMismatchBeforeAgent');
  });
});