import type { BrowserInspectionResult } from '@/types/browser';
import {
  getBrowserPanelPrimaryActionKey,
  getBrowserPanelStatusInfo,
  runBrowserPanelTaskFlow,
} from '@/components/browserPanelModel';

const createInspection = (
  overrides: Partial<BrowserInspectionResult> = {}
): BrowserInspectionResult => ({
  url: 'https://example.com',
  title: 'Example',
  authState: 'authenticated',
  matchedSignals: [],
  safeForAgent: true,
  ...overrides,
});

describe('browserPanelModel', () => {
  it('shows open-window guidance when no page is open', () => {
    expect(
      getBrowserPanelStatusInfo({
        isWindowOpen: false,
        status: 'uninitialized',
      })
    ).toEqual({
      tone: 'amber',
      titleKey: 'browser.guidance.openWindowTitle',
      descriptionKey: 'browser.guidance.openWindowDescription',
    });
  });

  it('changes the primary button label for login and manual-step states', () => {
    expect(getBrowserPanelPrimaryActionKey('waiting_user_resume')).toBe('browser.executeAfterLogin');
    expect(getBrowserPanelPrimaryActionKey('blocked_manual_step')).toBe('browser.executeAfterManualStep');
    expect(getBrowserPanelPrimaryActionKey('blocked_captcha')).toBe('browser.continueCheck');
    expect(getBrowserPanelPrimaryActionKey('ready_for_agent')).toBe('browser.execute');
  });

  it('requires opening a page before execution', async () => {
    const inspectCurrentPage = jest.fn();
    const confirmLoginAndResume = jest.fn();
    const executeTask = jest.fn();

    const result = await runBrowserPanelTaskFlow({
      task: 'extract summary',
      initialState: {
        isWindowOpen: false,
        status: 'uninitialized',
      },
      getState: () => ({
        status: 'uninitialized',
        authState: 'unknown',
        inspection: null,
      }),
      inspectCurrentPage,
      confirmLoginAndResume,
      executeTask,
    });

    expect(result.outcome).toBe('open_window_required');
    expect(inspectCurrentPage).not.toHaveBeenCalled();
    expect(confirmLoginAndResume).not.toHaveBeenCalled();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('auto-inspects and executes when the page becomes ready', async () => {
    let state = {
      status: 'idle' as const,
      authState: 'unknown' as const,
      inspection: null as BrowserInspectionResult | null,
    };
    const inspectCurrentPage = jest.fn(async () => {
      state = {
        status: 'ready_for_agent',
        authState: 'authenticated',
        inspection: createInspection(),
      };
    });
    const confirmLoginAndResume = jest.fn(async () => {});
    const executeTask = jest.fn((task: string) => {
      expect(task).toBe('extract summary');
      state = {
        ...state,
        status: 'running',
      };
      return Promise.resolve();
    });

    const result = await runBrowserPanelTaskFlow({
      task: 'extract summary',
      initialState: {
        isWindowOpen: true,
        status: 'idle',
      },
      getState: () => state,
      inspectCurrentPage,
      confirmLoginAndResume,
      executeTask,
    });

    expect(inspectCurrentPage).toHaveBeenCalledTimes(1);
    expect(confirmLoginAndResume).not.toHaveBeenCalled();
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('executing');
    expect(result.shouldClearTaskInput).toBe(true);
  });

  it('keeps the task when inspection says login is still required', async () => {
    let state = {
      status: 'idle' as const,
      authState: 'unknown' as const,
      inspection: null as BrowserInspectionResult | null,
    };
    const inspectCurrentPage = jest.fn(async () => {
      state = {
        status: 'waiting_user_resume',
        authState: 'auth_required',
        inspection: createInspection({
          authState: 'auth_required',
          safeForAgent: false,
          blockReason: 'login_required',
        }),
      };
    });
    const confirmLoginAndResume = jest.fn(async () => {});
    const executeTask = jest.fn(() => Promise.resolve());

    const result = await runBrowserPanelTaskFlow({
      task: 'extract summary',
      initialState: {
        isWindowOpen: true,
        status: 'idle',
      },
      getState: () => state,
      inspectCurrentPage,
      confirmLoginAndResume,
      executeTask,
    });

    expect(result.outcome).toBe('needs_user_action');
    expect(result.shouldClearTaskInput).toBe(false);
    expect(confirmLoginAndResume).not.toHaveBeenCalled();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('auto-confirms unknown-but-safe pages before executing', async () => {
    let state = {
      status: 'idle' as const,
      authState: 'unknown' as const,
      inspection: null as BrowserInspectionResult | null,
    };
    const inspectCurrentPage = jest.fn(async () => {
      state = {
        status: 'idle',
        authState: 'unknown',
        inspection: createInspection({
          authState: 'unknown',
          safeForAgent: true,
        }),
      };
    });
    const confirmLoginAndResume = jest.fn(async () => {
      state = {
        ...state,
        status: 'ready_for_agent',
      };
    });
    const executeTask = jest.fn(() => {
      state = {
        ...state,
        status: 'running',
      };
      return Promise.resolve();
    });

    const result = await runBrowserPanelTaskFlow({
      task: 'extract summary',
      initialState: {
        isWindowOpen: true,
        status: 'idle',
      },
      getState: () => state,
      inspectCurrentPage,
      confirmLoginAndResume,
      executeTask,
    });

    expect(confirmLoginAndResume).toHaveBeenCalledTimes(1);
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('executing');
    expect(result.shouldClearTaskInput).toBe(true);
  });
});