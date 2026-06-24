import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const executeCdpTaskMock = jest.fn<(...args: unknown[]) => Promise<string>>();
const closeEmbeddedSurfaceMock = jest.fn(async () => undefined);

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
  closeEmbeddedSurface: (...args: unknown[]) => closeEmbeddedSurfaceMock(...args),
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
}));

let useBrowserAgentStore: typeof import('../../browserAgentStore').useBrowserAgentStore;

async function waitUntilTaskIsRunning(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
    if (useBrowserAgentStore.getState()._abortController) {
      return;
    }
  }
  throw new Error('executeTask did not reach running state');
}

function seedRunningBrowserState(): void {
  useBrowserAgentStore.setState({
    status: 'ready_for_agent',
    isWindowOpen: true,
    currentUrl: 'https://example.com',
    pendingTask: {
      id: 'browser-task-1',
      connectorType: 'browser_web',
      siteProfileId: 'manual-browser',
      targetUrl: 'https://example.com',
      userIntent: 'Finish checkout',
      executionPrompt: 'Finish checkout',
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
  });
}

describe('browserAgentStore closeWindow (R3-08)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    closeEmbeddedSurfaceMock.mockClear();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    seedRunningBrowserState();
  });

  it('closeWindow_while_running_calls_stopTask', async () => {
    let resolveTask!: (value: string) => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    executeCdpTaskMock.mockImplementationOnce(async () => taskPromise);

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await waitUntilTaskIsRunning();
    expect(useBrowserAgentStore.getState()._abortController).not.toBeNull();

    await useBrowserAgentStore.getState().closeWindow();
    resolveTask('late-result');
    await runPromise;

    expect(useBrowserAgentStore.getState().status).toBe('uninitialized');
    expect(useBrowserAgentStore.getState().isWindowOpen).toBe(false);
    expect(useBrowserAgentStore.getState()._abortController).toBeNull();
    expect(closeEmbeddedSurfaceMock).toHaveBeenCalledTimes(1);
  });

  it('closeWindow_prevents_late_completion', async () => {
    let resolveTask!: (value: string) => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    executeCdpTaskMock.mockImplementationOnce(async () => taskPromise);

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await waitUntilTaskIsRunning();
    await useBrowserAgentStore.getState().closeWindow();
    resolveTask('late-result');
    await runPromise;

    expect(useBrowserAgentStore.getState().lastTaskResult).toBeNull();
    expect(useBrowserAgentStore.getState().status).not.toBe('completed');
  });

  it('closeWindow_idle_path_unchanged', async () => {
    useBrowserAgentStore.setState({
      status: 'uninitialized',
      isWindowOpen: true,
      _abortController: null,
    });

    await useBrowserAgentStore.getState().closeWindow();

    expect(useBrowserAgentStore.getState().isWindowOpen).toBe(false);
    expect(closeEmbeddedSurfaceMock).toHaveBeenCalledTimes(1);
  });
});