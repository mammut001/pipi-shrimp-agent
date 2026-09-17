import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const executeCdpTaskMock = jest.fn<(...args: unknown[]) => Promise<string>>();
const removeBrowserAgentOverlayMock = jest.fn(async () => undefined);

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
      dismissFailureSnapshot: jest.fn(),
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
  getCurrentBrowserUrl: jest.fn(async () => 'https://example.com'),
}));

jest.mock('../../../utils/nativeBrowserAgent', () => ({
  executeNativeBrowserTask: (...args: unknown[]) => executeCdpTaskMock(...args),
  removeBrowserAgentOverlay: (...args: unknown[]) => removeBrowserAgentOverlayMock(...args),
}));

let useBrowserAgentStore: typeof import('../../browserAgentStore').useBrowserAgentStore;

describe('browserAgentStore overlay cleanup (R3-07)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    removeBrowserAgentOverlayMock.mockClear();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    useBrowserAgentStore.setState({
      status: 'ready_for_agent',
      isWindowOpen: true,
      currentUrl: 'https://example.com',
      pendingTask: {
        id: 'browser-task-overlay-1',
        connectorType: 'browser_web',
        siteProfileId: 'manual-browser',
        targetUrl: 'https://example.com',
        userIntent: 'Do something',
        executionPrompt: 'Do something',
        requiresLogin: false,
        authPolicy: 'none',
        executionMode: 'cdp',
        allowedControlMode: 'agent_controlled',
      },
      authState: 'unknown',
      inspection: {
        url: 'https://example.com',
        title: 'Example',
        safeForAgent: true,
        authState: 'unknown',
        blockReason: null,
        detectedLoginForm: false,
        detectedCaptcha: false,
      },
      _abortController: null,
      _taskRunToken: 0,
      error: null,
    });
  });

  it('removes_overlay_when_cdp_task_throws', async () => {
    executeCdpTaskMock.mockRejectedValueOnce(new Error('CDP target closed'));

    await useBrowserAgentStore.getState().executeTask('Do something');

    expect(removeBrowserAgentOverlayMock).toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().status).toBe('error');
    expect(useBrowserAgentStore.getState().error).toContain('CDP target closed');
  });

  it('removes_overlay_when_cdp_task_aborts', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    executeCdpTaskMock.mockRejectedValueOnce(abortError);

    await useBrowserAgentStore.getState().executeTask('Do something');

    expect(removeBrowserAgentOverlayMock).toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('does_not_leave_overlay_call_on_success', async () => {
    executeCdpTaskMock.mockResolvedValueOnce('all good');

    await useBrowserAgentStore.getState().executeTask('Do something');

    // Success path relies on native finally; store does not need a second remove.
    expect(removeBrowserAgentOverlayMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().status).toBe('completed');
  });
});
