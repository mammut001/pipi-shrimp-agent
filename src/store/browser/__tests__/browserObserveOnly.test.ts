import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyVerdict,
} from '@/utils/browserActionPolicy';

const executeCdpTaskMock = jest.fn<(...args: unknown[]) => Promise<string>>();
const resolveBrowserActionPermissionModeMock = jest.fn<() => 'observe_only' | 'auto_safe' | 'ask_each_action'>();

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
  resolveBrowserActionPermissionMode: () => resolveBrowserActionPermissionModeMock(),
}));

jest.mock('../../../utils/browserPageStateClient', () => ({
  getCurrentBrowserUrl: jest.fn(async () => 'https://example.com'),
}));

jest.mock('../../../utils/nativeBrowserAgent', () => ({
  executeNativeBrowserTask: (...args: unknown[]) => executeCdpTaskMock(...args),
}));

type ApproveAction = (
  verdict: BrowserActionPolicyVerdict,
  context: BrowserActionPolicyContext,
) => Promise<boolean>;

const sensitiveVerdict: BrowserActionPolicyVerdict = {
  decision: 'ask',
  reason: 'Clicking a sensitive control: "Checkout"',
  riskLevel: 'high',
};

const sensitiveContext: BrowserActionPolicyContext = {
  actionName: 'click_element',
  url: 'https://shop.example/checkout',
  payload: { backend_node_id: 12 },
};

const baseStoreState = {
  status: 'ready_for_agent' as const,
  isWindowOpen: true,
  currentUrl: 'https://example.com',
  pendingTask: {
    id: 'browser-task-1',
    connectorType: 'browser_web' as const,
    siteProfileId: 'manual-browser',
    targetUrl: 'https://example.com',
    userIntent: 'Inspect checkout page',
    executionPrompt: 'Inspect checkout page',
    requiresLogin: false,
    authPolicy: 'none' as const,
    executionMode: 'cdp' as const,
    allowedControlMode: 'agent_controlled' as const,
  },
  authState: 'unknown' as const,
  inspection: {
    url: 'https://example.com',
    title: 'Example',
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

describe('browserAgentStore observe_only (R3-02)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    resolveBrowserActionPermissionModeMock.mockReset();
    resolveBrowserActionPermissionModeMock.mockReturnValue('observe_only');
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    useBrowserAgentStore.setState(baseStoreState);
  });

  it('observe_only_is_passed_to_native_agent', async () => {
    let capturedPermissionMode: string | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { permissionMode?: string }) => {
      capturedPermissionMode = options.permissionMode;
      return 'done';
    });

    await useBrowserAgentStore.getState().executeTask('Inspect checkout page');

    expect(capturedPermissionMode).toBe('observe_only');
  });

  it('observe_only_does_not_create_approval_prompt_during_task_start', async () => {
    executeCdpTaskMock.mockResolvedValueOnce('observed');

    await useBrowserAgentStore.getState().executeTask('Inspect checkout page');

    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).toBeNull();
    expect(useBrowserAgentStore.getState().status).toBe('completed');
  });

  it('ask_mode_still_requests_approval_when_not_observe_only', async () => {
    resolveBrowserActionPermissionModeMock.mockReturnValue('auto_safe');
    let capturedApproveAction: ApproveAction | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      capturedApproveAction = options.approveAction;
      return new Promise<string>(() => undefined);
    });

    void useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    const approvalPromise = capturedApproveAction!(sensitiveVerdict, sensitiveContext);
    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).not.toBeNull();

    useBrowserAgentStore.getState().approveBrowserAction();
    await expect(approvalPromise).resolves.toBe(true);
  });
});