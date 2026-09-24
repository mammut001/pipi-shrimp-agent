/**
 * AG-05: behavior + source-guard tests for the inspection / login-handoff action slice
 * extracted from `src/store/browserAgentStore.ts` (`browserAgentInspectionActions.ts`).
 *
 * The behavior tests drive the public store API only, so they pass against both the
 * pre-extract store (main) and the post-extract store.
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as browserAgentStoreModule from '../browserAgentStore';
import { useBrowserAgentStore } from '../browserAgentStore';
import { inspectEmbeddedSurface } from '../../utils/browserCommands';
import { parseInspectionResult } from '../../utils/browserInspection';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

const uiState = {
  addNotification: jest.fn(),
  closeBrowserDock: jest.fn(),
  setBrowserDockMode: jest.fn(),
  expandBrowserToSplit: jest.fn(),
  openBrowserExternal: jest.fn(),
  collapseBrowserToPanel: jest.fn(),
  setAgentPanelTab: jest.fn(),
};

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(async () => jest.fn()),
}));

jest.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: jest.fn(),
  requestPermission: jest.fn(async () => 'granted'),
  isPermissionGranted: jest.fn(async () => true),
}));

jest.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../uiStore', () => ({
  useUIStore: { getState: () => uiState },
}));

jest.mock('../settingsStore', () => ({
  useSettingsStore: { getState: () => ({ getActiveConfig: () => null }) },
}));

jest.mock('../browserObservabilityStore', () => ({
  useBrowserObservabilityStore: { getState: () => ({ setNativeRunStats: jest.fn() }) },
}));

jest.mock('../taskRegistryStore', () => ({
  registerDiagnosticsTask: jest.fn(),
  registerDiagnosticsTaskCancel: jest.fn(),
  updateDiagnosticsTask: jest.fn(),
}));

jest.mock('../../utils/browserCommands', () => ({
  openEmbeddedSurface: jest.fn(async () => undefined),
  closeEmbeddedSurface: jest.fn(async () => undefined),
  executeAgentTask: jest.fn(async () => undefined),
  executeOnEmbeddedSurface: jest.fn(async () => undefined),
  inspectEmbeddedSurface: jest.fn(async () => ({ url: 'https://example.com', title: 'Example' })),
  captureScreenshot: jest.fn(async () => 'ack'),
  setEmbeddedSurfaceVisibility: jest.fn(async () => undefined),
}));

jest.mock('../../utils/browserInspection', () => ({
  parseInspectionResult: jest.fn(),
}));

jest.mock('../../utils/nativeBrowserAgent', () => ({
  executeNativeBrowserTask: jest.fn(async () => ''),
  removeBrowserAgentOverlay: jest.fn(async () => undefined),
}));

const inspectMock = inspectEmbeddedSurface as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const parseMock = parseInspectionResult as unknown as jest.Mock<(...a: unknown[]) => unknown>;
const isGrantedMock = isPermissionGranted as unknown as jest.Mock<() => Promise<boolean>>;
const requestPermMock = requestPermission as unknown as jest.Mock<() => Promise<string>>;
const sendNotificationMock = sendNotification as unknown as jest.Mock<(...a: unknown[]) => void>;

const pristineState = { ...useBrowserAgentStore.getState() };
const executeTaskSpy = jest.fn<(task: string) => Promise<void>>(async () => undefined);

const pendingTask = {
  id: 'browser-task-1',
  connectorType: 'browser_web' as const,
  siteProfileId: 'manual-browser',
  targetUrl: 'https://example.com/login',
  userIntent: 'Do the thing',
  executionPrompt: 'Do the thing prompt',
  requiresLogin: true,
  authPolicy: 'manual_login_required' as const,
  executionMode: 'cdp' as const,
  allowedControlMode: 'agent_controlled' as const,
};

function logMessages() {
  return useBrowserAgentStore.getState().logs.map((l) => `${l.level}:${l.message}`);
}

async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useRealTimers();
  useBrowserAgentStore.setState({ ...pristineState, executeTask: executeTaskSpy }, true);
  executeTaskSpy.mockClear();
  inspectMock.mockReset();
  inspectMock.mockImplementation(async () => ({ url: 'https://example.com', title: 'Example' }));
  parseMock.mockReset();
  isGrantedMock.mockReset();
  isGrantedMock.mockImplementation(async () => true);
  requestPermMock.mockClear();
  sendNotificationMock.mockClear();
  Object.values(uiState).forEach((fn) => fn.mockClear());
});

describe('inspectCurrentPage (extracted slice)', () => {
  it('logs and returns when the window is not open', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: false });
    await useBrowserAgentStore.getState().inspectCurrentPage();
    expect(inspectMock).not.toHaveBeenCalled();
    expect(logMessages()).toEqual(['error:browserAgent.log.windowNotOpen']);
    expect(useBrowserAgentStore.getState().status).toBe('uninitialized');
  });

  it('skips a concurrent inspection while one is in flight', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, _isInspecting: true });
    await useBrowserAgentStore.getState().inspectCurrentPage();
    expect(inspectMock).not.toHaveBeenCalled();
    expect(logMessages()).toEqual(['info:browserAgent.log.checkingDuplicate']);
  });

  it('sets inspecting synchronously, then applies an authenticated result', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, siteProfileId: 'site-a' });
    parseMock.mockReturnValue({
      url: 'https://example.com/home', title: 'Home', authState: 'authenticated',
      safeForAgent: true, matchedSignals: [],
    });
    const p = useBrowserAgentStore.getState().inspectCurrentPage();
    // Synchronous prefix (before the first await) must already have run.
    expect(useBrowserAgentStore.getState().status).toBe('inspecting');
    expect(useBrowserAgentStore.getState()._isInspecting).toBe(true);
    expect(inspectMock).toHaveBeenCalledTimes(1);
    await p;
    const s = useBrowserAgentStore.getState();
    expect(parseMock).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example' }, 'site-a');
    expect(s.status).toBe('ready_for_agent');
    expect(s.authState).toBe('authenticated');
    expect(s.currentUrl).toBe('https://example.com/home');
    expect(s.blockReason).toBeNull();
    expect(s.waitingForUserResume).toBe(false);
    expect(s._isInspecting).toBe(false);
    expect(logMessages()).toEqual([
      'info:browserAgent.log.checkingPageStatus',
      'success:browserAgent.log.pageLoggedIn',
    ]);
  });

  it('moves to waiting_user_resume / manual_handoff on an auth wall', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, mode: 'agent_controlled' });
    parseMock.mockReturnValue({
      url: 'https://example.com/login', title: 'Login', authState: 'auth_required',
      safeForAgent: false, blockReason: 'login_required', matchedSignals: [],
    });
    await useBrowserAgentStore.getState().inspectCurrentPage();
    const s = useBrowserAgentStore.getState();
    expect(s.status).toBe('waiting_user_resume');
    expect(s.mode).toBe('manual_handoff');
    expect(s.blockReason).toBe('login_required');
    expect(s.waitingForUserResume).toBe(true);
    expect(logMessages()).toContain('warning:browserAgent.log.loginRequired');
  });

  it('does not clobber status/authState while a task is active', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, authState: 'authenticated' });
    parseMock.mockReturnValue({
      url: 'https://example.com/x', title: 'X', authState: 'auth_required',
      safeForAgent: false, matchedSignals: [],
    });
    const p = useBrowserAgentStore.getState().inspectCurrentPage();
    useBrowserAgentStore.setState({ status: 'running' });
    await p;
    const s = useBrowserAgentStore.getState();
    expect(s.status).toBe('running');
    expect(s.authState).toBe('authenticated');
    expect(s.waitingForUserResume).toBe(false);
  });

  it('retries once after a timeout (2s delay) and uses the second result', async () => {
    jest.useFakeTimers();
    useBrowserAgentStore.setState({ isWindowOpen: true });
    inspectMock
      .mockImplementationOnce(async () => { throw new Error('Timed out waiting'); })
      .mockImplementationOnce(async () => ({ url: 'https://retry.example', title: 'R' }));
    parseMock.mockReturnValue({
      url: 'https://retry.example', title: 'R', authState: 'unknown', safeForAgent: true, matchedSignals: [],
    });
    const p = useBrowserAgentStore.getState().inspectCurrentPage();
    await flushMicrotasks();
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(logMessages()).toContain('info:browserAgent.log.pageStillLoading');
    await jest.advanceTimersByTimeAsync(2000);
    await p;
    expect(inspectMock).toHaveBeenCalledTimes(2);
    expect(parseMock).toHaveBeenCalledWith({ url: 'https://retry.example', title: 'R' }, undefined);
    expect(useBrowserAgentStore.getState().status).toBe('idle');
  });

  it('falls back to a safe unknown inspection on a non-timeout error', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, currentUrl: 'https://cur.example', error: 'old' });
    inspectMock.mockImplementationOnce(async () => { throw new Error('boom'); });
    await useBrowserAgentStore.getState().inspectCurrentPage();
    const s = useBrowserAgentStore.getState();
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(parseMock).not.toHaveBeenCalled();
    expect(s.status).toBe('idle');
    expect(s.authState).toBe('unknown');
    expect(s.error).toBeNull();
    expect(s._isInspecting).toBe(false);
    expect(s.inspection).toEqual({
      url: 'https://cur.example', title: '', authState: 'unknown', safeForAgent: true, matchedSignals: [],
    });
    expect(logMessages()).toContain('warning:browserAgent.log.pageCheckFailed');
  });
});

describe('requestLogin (extracted slice)', () => {
  it('enters waiting_for_login, shows the mini dock, notifies, and logs', async () => {
    useBrowserAgentStore.setState({ presentationMode: 'hidden', siteProfileId: 'apple' });
    useBrowserAgentStore.getState().requestLogin();
    const s = useBrowserAgentStore.getState();
    expect(s.status).toBe('waiting_user_resume');
    expect(s.mode).toBe('manual_handoff');
    expect(s.waitingForUserResume).toBe(true);
    expect(s.handoffState).toBe('waiting_for_login');
    expect(s.presentationMode).toBe('mini');
    expect(uiState.setBrowserDockMode).toHaveBeenCalledWith('panel');
    // Logs after the fire-and-forget notification IIFE are appended synchronously.
    expect(logMessages().slice(-2)).toEqual([
      'info:browserAgent.log.completeLoginInBrowser',
      'info:browserAgent.log.clickAfterLogin',
    ]);
    expect(sendNotificationMock).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(requestPermMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledWith({
      title: 'browserAgent.log.loginNotificationTitle',
      body: 'browserAgent.log.loginNotificationBody',
    });
  });

  it('requests permission when not yet granted and skips notify on denial', async () => {
    isGrantedMock.mockImplementation(async () => false);
    requestPermMock.mockImplementationOnce(async () => 'denied');
    useBrowserAgentStore.setState({ presentationMode: 'expanded' });
    useBrowserAgentStore.getState().requestLogin();
    await flushMicrotasks();
    expect(requestPermMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(useBrowserAgentStore.getState().presentationMode).toBe('expanded');
  });
});

describe('confirmLoginAndResume / forceResumeWithoutAuth (extracted slice)', () => {
  it('reuses an existing inspection and calls executeTask synchronously (no extra await)', async () => {
    useBrowserAgentStore.setState({
      authState: 'unknown',
      inspection: { url: 'u', title: 't', authState: 'unknown', safeForAgent: true, matchedSignals: [] },
      pendingTask,
    });
    const p = useBrowserAgentStore.getState().confirmLoginAndResume();
    expect(inspectMock).not.toHaveBeenCalled();
    expect(executeTaskSpy).toHaveBeenCalledWith('Do the thing prompt');
    const s = useBrowserAgentStore.getState();
    expect(s.status).toBe('ready_for_agent');
    expect(s.mode).toBe('agent_controlled');
    expect(s.handoffState).toBe('no_handoff');
    await p;
    expect(logMessages()).toEqual([
      'info:browserAgent.log.verifyingLogin',
      'success:browserAgent.log.loginVerified',
      'info:browserAgent.log.resumingTask',
    ]);
  });

  it('keeps waiting when auth is still required', async () => {
    useBrowserAgentStore.setState({
      authState: 'auth_required',
      inspection: { url: 'u', title: 't', authState: 'auth_required', safeForAgent: false, matchedSignals: [] },
      pendingTask,
    });
    await useBrowserAgentStore.getState().confirmLoginAndResume();
    const s = useBrowserAgentStore.getState();
    expect(executeTaskSpy).not.toHaveBeenCalled();
    expect(s.status).toBe('waiting_user_resume');
    expect(s.handoffState).toBe('waiting_for_login');
    expect(logMessages()).toContain('warning:browserAgent.log.loginVerifyFailed');
  });

  it('re-inspects first when there is no inspection yet', async () => {
    useBrowserAgentStore.setState({ isWindowOpen: true, inspection: null, pendingTask: null });
    parseMock.mockReturnValue({
      url: 'https://example.com', title: 'E', authState: 'authenticated', safeForAgent: true, matchedSignals: [],
    });
    await useBrowserAgentStore.getState().confirmLoginAndResume();
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(useBrowserAgentStore.getState().status).toBe('ready_for_agent');
    expect(executeTaskSpy).not.toHaveBeenCalled();
  });

  it('forceResumeWithoutAuth sets unknown auth and runs the pending task synchronously', async () => {
    useBrowserAgentStore.setState({ authState: 'auth_required', pendingTask, waitingForUserResume: true });
    const p = useBrowserAgentStore.getState().forceResumeWithoutAuth();
    expect(executeTaskSpy).toHaveBeenCalledWith('Do the thing prompt');
    const s = useBrowserAgentStore.getState();
    expect(s.authState).toBe('unknown');
    expect(s.status).toBe('ready_for_agent');
    expect(s.waitingForUserResume).toBe(false);
    await p;
    expect(logMessages()).toEqual([
      'info:browserAgent.log.skippingLoginCheck',
      'info:browserAgent.log.executingTask',
    ]);
  });

  it('forceResumeWithoutAuth without a pending task just reports ready', async () => {
    await useBrowserAgentStore.getState().forceResumeWithoutAuth();
    expect(executeTaskSpy).not.toHaveBeenCalled();
    expect(logMessages()).toEqual([
      'info:browserAgent.log.skippingLoginCheck',
      'success:browserAgent.log.readyForTask',
    ]);
  });
});

const EXPECTED_STORE_KEYS = [
  'status', 'isWindowOpen', 'currentUrl', 'error', 'mode', 'authState', 'blockReason',
  'pendingTask', 'inspection', 'siteProfileId', 'connectorType', 'waitingForUserResume',
  'lastCompletedTaskId', 'lastTaskResult', 'logs', 'screenshots', '_abortController',
  '_taskRunToken', '_screenshotInterval', '_isLivePreviewEnabled', '_isInspecting',
  'pendingBrowserActionApproval', 'presentationMode', 'handoffState', 'addLog',
  'setupEventListeners', 'openWindow', 'closeWindow', 'inspectCurrentPage', 'requestLogin',
  'confirmLoginAndResume', 'forceResumeWithoutAuth', 'executeTask', 'executeTaskEnvelope',
  'bindTask', 'clearTask', 'resumePendingTask', 'approveBrowserAction', 'rejectBrowserAction',
  'stopTask', 'switchToManualMode', 'switchToAgentMode', 'handleBlockedState', 'resetToReady',
  'clearLogs', 'setPresentationMode', 'expandBrowser', 'collapseBrowser', 'showMiniBrowser',
  'hideBrowser', 'refreshScreenshot', '_startLivePreview', '_stopLivePreview', '_toggleLivePreview',
];

describe('AG-05 store shape guards', () => {
  it('keeps the exact store key order', () => {
    expect(Object.keys(pristineState)).toEqual(EXPECTED_STORE_KEYS);
  });

  it('keeps the runtime export surface of browserAgentStore', () => {
    expect(Object.keys(browserAgentStoreModule).sort()).toEqual(['useBrowserAgentStore']);
  });
});

const STORE_DIR = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(STORE_DIR, f), 'utf8');
const loc = (f: string) => read(f).split('\n').length - (read(f).endsWith('\n') ? 1 : 0);
const SLICE = 'browserAgentInspectionActions.ts';
const hasSlice = fs.existsSync(path.join(STORE_DIR, SLICE));
const guard = hasSlice ? describe : describe.skip;

guard('AG-05 source guards', () => {
  it('store and slice are under 500 LOC', () => {
    expect(loc('browserAgentStore.ts')).toBeLessThan(500);
    expect(loc(SLICE)).toBeLessThan(500);
  });

  it('uses static imports only (no dynamic import / require)', () => {
    for (const f of ['browserAgentStore.ts', SLICE]) {
      const src = read(f);
      expect(src).not.toMatch(/\bimport\s*\(/);
      expect(src).not.toMatch(/\brequire\s*\(/);
    }
  });

  it('slice has no runtime import of the store (no circular init)', () => {
    const src = read(SLICE);
    expect(src).not.toMatch(/from '\.\/browserAgentStore'/);
    const storeTypeImports = src.match(/^import[^;]*from '\.\/browserAgentStore\.types';/gm) ?? [];
    expect(storeTypeImports.length).toBe(1);
    expect(storeTypeImports[0]).toMatch(/^import type /);
    expect(src).toMatch(/export const createBrowserAgentInspectionActions/);
  });

  it('spreads the slice at the original position (after event actions, before task actions)', () => {
    const src = read('browserAgentStore.ts');
    const ev = src.indexOf('...createBrowserAgentEventActions(set, get),');
    const insp = src.indexOf('...createBrowserAgentInspectionActions(set, get),');
    const task = src.indexOf('...createBrowserAgentTaskActions(set, get),');
    expect(ev).toBeGreaterThan(-1);
    expect(insp).toBeGreaterThan(ev);
    expect(task).toBeGreaterThan(insp);
    for (const moved of ['inspectCurrentPage:', 'requestLogin:', 'confirmLoginAndResume:', 'forceResumeWithoutAuth:']) {
      expect(src).not.toContain(moved);
    }
  });

  it('preserves module evaluation order (slice imported where notification/inspection were)', () => {
    const src = read('browserAgentStore.ts');
    const flags = src.indexOf("from '../utils/browserFeatureFlags';");
    const slice = src.indexOf("from './browserAgentInspectionActions';");
    const events = src.indexOf("from './browserAgentEventActions';");
    expect(flags).toBeGreaterThan(-1);
    expect(slice).toBeGreaterThan(flags);
    expect(events).toBeGreaterThan(slice);
    expect(src).not.toContain('@tauri-apps/plugin-notification');
    expect(src).not.toContain('../utils/browserInspection');
  });

  it('slice keeps the moved actions async/sync exactly as before', () => {
    const src = read(SLICE);
    expect(src).toMatch(/^ {2}inspectCurrentPage: async \(\) => \{/m);
    expect(src).toMatch(/^ {2}requestLogin: \(\) => \{/m);
    expect(src).toMatch(/^ {2}confirmLoginAndResume: async \(\) => \{/m);
    expect(src).toMatch(/^ {2}forceResumeWithoutAuth: async \(\) => \{/m);
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    expect((code.match(/\bawait\b/g) ?? []).length).toBe(8);
  });
});
