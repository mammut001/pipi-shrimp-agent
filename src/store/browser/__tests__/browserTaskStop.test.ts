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

describe('browserAgentStore stopTask (R3-05)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
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
  });

  it('stopTask_prevents_next_cdp_action', async () => {
    let resolveTask!: (value: string) => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    executeCdpTaskMock.mockImplementationOnce(async () => taskPromise);

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await waitUntilTaskIsRunning();

    useBrowserAgentStore.getState().stopTask();
    resolveTask('late-result');
    await runPromise;

    expect(executeCdpTaskMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('idle');
    expect(useBrowserAgentStore.getState().lastTaskResult).toBeNull();
  });

  it('stopTask_ignores_late_cdp_result', async () => {
    let resolveTask!: (value: string) => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    executeCdpTaskMock.mockImplementationOnce(async () => taskPromise);

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await waitUntilTaskIsRunning();
    useBrowserAgentStore.getState().stopTask();
    resolveTask('late-result');
    await runPromise;

    expect(useBrowserAgentStore.getState().status).not.toBe('completed');
    expect(useBrowserAgentStore.getState().lastTaskResult).toBeNull();
  });

  it('stopTask_is_idempotent', async () => {
    let resolveTask!: (value: string) => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    executeCdpTaskMock.mockImplementationOnce(async () => taskPromise);

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await waitUntilTaskIsRunning();

    expect(() => useBrowserAgentStore.getState().stopTask()).not.toThrow();
    expect(() => useBrowserAgentStore.getState().stopTask()).not.toThrow();
    resolveTask('late-result');
    await runPromise;

    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('success_path_unchanged', async () => {
    executeCdpTaskMock.mockResolvedValueOnce('checkout complete');

    await useBrowserAgentStore.getState().executeTask('Finish checkout');

    expect(useBrowserAgentStore.getState().status).toBe('completed');
    expect(useBrowserAgentStore.getState().lastTaskResult).toBe('checkout complete');
    expect(useBrowserAgentStore.getState()._abortController).toBeNull();
  });

  it('passes_abort_signal_to_executeCdpTask', async () => {
    let capturedSignal: AbortSignal | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { signal?: AbortSignal }) => {
      capturedSignal = options.signal;
      return 'done';
    });

    await useBrowserAgentStore.getState().executeTask('Finish checkout');

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('passes_approveAction_to_executeCdpTask', async () => {
    let capturedApproveAction: unknown;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: unknown }) => {
      capturedApproveAction = options.approveAction;
      return 'done';
    });

    await useBrowserAgentStore.getState().executeTask('Finish checkout');

    expect(capturedApproveAction).toEqual(expect.any(Function));
  });
});