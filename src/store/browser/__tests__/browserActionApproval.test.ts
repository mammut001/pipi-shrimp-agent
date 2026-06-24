import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyVerdict,
} from '@/utils/browserActionPolicy';

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

type ApproveAction = (
  verdict: BrowserActionPolicyVerdict,
  context: BrowserActionPolicyContext,
) => Promise<boolean>;

const baseStoreState = {
  status: 'ready_for_agent' as const,
  isWindowOpen: true,
  currentUrl: 'https://example.com',
  pendingTask: {
    id: 'browser-task-1',
    connectorType: 'browser_web' as const,
    siteProfileId: 'manual-browser',
    targetUrl: 'https://example.com',
    userIntent: 'Finish checkout',
    executionPrompt: 'Finish checkout',
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

describe('browserAgentStore action approval (R3-01)', () => {
  beforeEach(async () => {
    jest.resetModules();
    executeCdpTaskMock.mockReset();
    ({ useBrowserAgentStore } = await import('../../browserAgentStore'));
    useBrowserAgentStore.setState(baseStoreState);
  });

  it('executeCdpTask_passes_approveAction', async () => {
    let capturedApproveAction: ApproveAction | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      capturedApproveAction = options.approveAction;
      return 'ok';
    });

    await useBrowserAgentStore.getState().executeTask('Finish checkout');

    expect(capturedApproveAction).toEqual(expect.any(Function));
  });

  it('sensitive_action_requests_approval', async () => {
    let capturedApproveAction: ApproveAction | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      capturedApproveAction = options.approveAction;
      return new Promise<string>(() => undefined);
    });

    void useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedApproveAction).toBeDefined();
    const approvalPromise = capturedApproveAction!(sensitiveVerdict, sensitiveContext);

    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).toMatchObject({
      taskId: 'browser-task-1',
      actionType: 'click_element',
      summary: 'Clicking a sensitive control: "Checkout"',
      riskLevel: 'high',
    });

    useBrowserAgentStore.getState().approveBrowserAction();
    await expect(approvalPromise).resolves.toBe(true);
    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).toBeNull();
  });

  it('approved_action_continues', async () => {
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      const approved = await options.approveAction?.(sensitiveVerdict, sensitiveContext);
      return approved ? 'approved-run' : 'denied-run';
    });

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    useBrowserAgentStore.getState().approveBrowserAction();
    await runPromise;

    expect(useBrowserAgentStore.getState().status).toBe('completed');
    expect(useBrowserAgentStore.getState().lastTaskResult).toBe('approved-run');
  });

  it('rejected_action_does_not_execute_sensitive_step', async () => {
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      const approved = await options.approveAction?.(sensitiveVerdict, sensitiveContext);
      return approved ? 'approved-run' : 'denied-run';
    });

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    useBrowserAgentStore.getState().rejectBrowserAction();
    await runPromise;

    expect(useBrowserAgentStore.getState().lastTaskResult).toBe('denied-run');
  });

  it('stop_clears_pending_approval', async () => {
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

    useBrowserAgentStore.getState().stopTask();

    await expect(approvalPromise).resolves.toBe(false);
    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).toBeNull();
    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('late_approval_after_stop_is_ignored', async () => {
    let capturedApproveAction: ApproveAction | undefined;
    let pendingId = '';
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      capturedApproveAction = options.approveAction;
      return new Promise<string>(() => undefined);
    });

    void useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    void capturedApproveAction!(sensitiveVerdict, sensitiveContext);
    pendingId = useBrowserAgentStore.getState().pendingBrowserActionApproval?.id ?? '';
    expect(pendingId).not.toBe('');

    useBrowserAgentStore.getState().stopTask();
    expect(useBrowserAgentStore.getState().approveBrowserAction(pendingId)).toBe(false);
    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('no_approval_ui_fails_closed_when_stopped', async () => {
    let capturedApproveAction: ApproveAction | undefined;
    executeCdpTaskMock.mockImplementationOnce(async (_task, _key, _model, options: { approveAction?: ApproveAction }) => {
      const approved = await options.approveAction?.(sensitiveVerdict, sensitiveContext);
      return approved ? 'approved-run' : 'denied-run';
    });

    const runPromise = useBrowserAgentStore.getState().executeTask('Finish checkout');
    await Promise.resolve();
    await Promise.resolve();

    useBrowserAgentStore.getState().stopTask();
    await runPromise.catch(() => undefined);

    expect(useBrowserAgentStore.getState().lastTaskResult).toBeNull();
    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('success_path_unchanged_for_safe_actions', async () => {
    executeCdpTaskMock.mockResolvedValueOnce('checkout complete');

    await useBrowserAgentStore.getState().executeTask('Finish checkout');

    expect(useBrowserAgentStore.getState().status).toBe('completed');
    expect(useBrowserAgentStore.getState().lastTaskResult).toBe('checkout complete');
    expect(useBrowserAgentStore.getState().pendingBrowserActionApproval).toBeNull();
  });
});