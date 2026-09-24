/**
 * AG-07: behavior + source-guard tests for the modules extracted from
 * `src/utils/nativeBrowserAgent.ts`.
 */
import fs from 'fs';
import path from 'path';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('../utils/browserActionClient', () => ({
  executeBrowserScript: jest.fn(async () => 'ok'),
}));

jest.mock('../utils/browserPageStateClient', () => ({
  getBrowserPageState: jest.fn(),
  getBrowserLightObservation: jest.fn(),
  getBrowserSemanticTree: jest.fn().mockResolvedValue('[]'),
  getCurrentBrowserUrl: jest.fn().mockResolvedValue('about:blank'),
}));

jest.mock('../utils/browserSessionClient', () => ({
  connectBrowserSession: jest.fn().mockResolvedValue('connected'),
  navigateBrowserPage: jest.fn().mockResolvedValue('navigated'),
  resyncBrowserPage: jest.fn().mockResolvedValue('resynced'),
}));

import type { BrowserPageState } from '@/types/browserPageState';
import { executeBrowserScript } from '@/utils/browserActionClient';
import { getBrowserLightObservation, getBrowserPageState } from '@/utils/browserPageStateClient';
import { resyncBrowserPage } from '@/utils/browserSessionClient';
import type { LoopSignature } from '@/utils/nativeBrowserAgentHelpers';
import {
  OVERLAY_INJECT_SCRIPT,
  OVERLAY_REMOVE_SCRIPT,
  injectOverlay,
  removeOverlay,
} from '@/utils/nativeBrowserAgentOverlay';
import {
  NATIVE_BROWSER_AGENT_SYSTEM_PROMPT,
  resolveNativeAgentStartUrl,
} from '@/utils/nativeBrowserAgentPrompt';
import {
  countLoopRepeats,
  emptySummary,
  recordStepTiming,
  resolveIncompleteRunOutcome,
} from '@/utils/nativeBrowserAgentRunState';
import {
  captureStepObservation,
  type NativeObservationState,
} from '@/utils/nativeBrowserAgentObservation';
import type { NativeAgentRunSummary, NativeAgentStepTiming } from '@/utils/nativeBrowserAgent';

const executeBrowserScriptMock = executeBrowserScript as jest.MockedFunction<typeof executeBrowserScript>;
const getBrowserPageStateMock = getBrowserPageState as jest.MockedFunction<typeof getBrowserPageState>;
const getBrowserLightObservationMock = getBrowserLightObservation as jest.MockedFunction<typeof getBrowserLightObservation>;
const resyncBrowserPageMock = resyncBrowserPage as jest.MockedFunction<typeof resyncBrowserPage>;

const makeSummary = (): NativeAgentRunSummary => ({
  startedAt: 0,
  finishedAt: 0,
  totalMs: 0,
  outcome: 'failed',
  finalText: '',
  ...emptySummary(),
});

const makeStepTiming = (): NativeAgentStepTiming => ({
  step: 1,
  engine: 'cdp_native',
  url: '',
  navigationId: '',
  observationLevel: 'light',
  observationMs: 0,
  promptChars: 0,
  llmMs: 0,
  actionName: 'invalid',
  actionMs: 0,
  postWaitMs: 0,
  screenshotMs: 0,
  totalStepMs: 0,
  success: false,
  reusedCache: false,
});

const pageState: BrowserPageState = {
  url: 'https://example.com/',
  title: 'Example',
  navigation_id: 'nav-1',
  frame_count: 1,
  warnings: [],
  screenshot: null,
  elements: [],
};

const sig = (overrides: Partial<LoopSignature> = {}): LoopSignature => ({
  url: 'https://a.com',
  navigationId: 'n1',
  actionName: 'click_element',
  target: 'bn:1',
  ...overrides,
});

const noopLog = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveNativeAgentStartUrl', () => {
  it('prefers an explicit targetUrl', () => {
    expect(resolveNativeAgentStartUrl('go to https://b.com', 'https://target.dev', 'https://cur.com')).toBe('https://target.dev');
  });

  it('extracts an http(s) url from the task', () => {
    expect(resolveNativeAgentStartUrl('open http://a.com/x?q=1 now', undefined, null)).toBe('http://a.com/x?q=1');
  });

  it('stops the url at Chinese punctuation', () => {
    expect(resolveNativeAgentStartUrl('open https://a.com/x，then read', undefined, null)).toBe('https://a.com/x');
  });

  it('upgrades a bare domain to https', () => {
    expect(resolveNativeAgentStartUrl('search github.com/foo for issues', undefined, null)).toBe('https://github.com/foo');
  });

  it('falls back to the current browser url when it is not about:blank', () => {
    expect(resolveNativeAgentStartUrl('summarize this page', undefined, 'https://cur.com/p')).toBe('https://cur.com/p');
  });

  it('falls back to google for about:blank / null / empty targetUrl', () => {
    expect(resolveNativeAgentStartUrl('summarize this page', undefined, 'about:blank')).toBe('https://www.google.com');
    expect(resolveNativeAgentStartUrl('summarize this page', '', null)).toBe('https://www.google.com');
  });
});

describe('NATIVE_BROWSER_AGENT_SYSTEM_PROMPT', () => {
  it('keeps the action catalogue and header text', () => {
    expect(NATIVE_BROWSER_AGENT_SYSTEM_PROMPT.startsWith('You are a powerful browser automation agent.')).toBe(true);
    expect(NATIVE_BROWSER_AGENT_SYSTEM_PROMPT).toContain('VALID ACTIONS');
    expect(NATIVE_BROWSER_AGENT_SYSTEM_PROMPT).toContain('screenshot_observe');
    expect(NATIVE_BROWSER_AGENT_SYSTEM_PROMPT).toContain('```json ... ```');
    expect(NATIVE_BROWSER_AGENT_SYSTEM_PROMPT.endsWith('use ask_user instead of guessing credentials.')).toBe(true);
  });
});

describe('countLoopRepeats', () => {
  it('counts equal signatures and trims history to the window', () => {
    const history: LoopSignature[] = [];
    expect(countLoopRepeats(history, sig(), 4)).toBe(1);
    expect(countLoopRepeats(history, sig(), 4)).toBe(2);
    expect(countLoopRepeats(history, sig({ target: 'bn:2' }), 4)).toBe(1);
    expect(countLoopRepeats(history, sig(), 4)).toBe(3);
    expect(history).toHaveLength(4);
    // Pushing a 5th entry shifts the oldest matching one out.
    expect(countLoopRepeats(history, sig(), 4)).toBe(3);
    expect(history).toHaveLength(4);
  });

  it('never counts wait / wait_for_selector / refresh_page_state', () => {
    for (const actionName of ['wait', 'wait_for_selector', 'refresh_page_state'] as const) {
      const history: LoopSignature[] = [];
      countLoopRepeats(history, sig({ actionName }), 4);
      countLoopRepeats(history, sig({ actionName }), 4);
      expect(countLoopRepeats(history, sig({ actionName }), 4)).toBe(0);
    }
  });
});

describe('resolveIncompleteRunOutcome', () => {
  it('returns max_steps when steps reached maxSteps', () => {
    const summary = makeSummary();
    summary.steps.push(makeStepTiming(), makeStepTiming());
    summary.loopDetections = 1;
    expect(resolveIncompleteRunOutcome(summary, 2)).toBe('max_steps');
  });

  it('returns loop_detected when loops were detected', () => {
    const summary = makeSummary();
    summary.loopDetections = 1;
    summary.policyDenials = 1;
    expect(resolveIncompleteRunOutcome(summary, 5)).toBe('loop_detected');
  });

  it('returns aborted for policy denials and otherwise', () => {
    const denied = makeSummary();
    denied.policyDenials = 2;
    expect(resolveIncompleteRunOutcome(denied, 5)).toBe('aborted');
    expect(resolveIncompleteRunOutcome(makeSummary(), 5)).toBe('aborted');
  });
});

describe('recordStepTiming / emptySummary', () => {
  it('sets totalStepMs, pushes to summary.steps, then calls onStep', () => {
    const summary = makeSummary();
    const timing = makeStepTiming();
    const onStep = jest.fn((t: NativeAgentStepTiming) => {
      expect(summary.steps).toContain(t);
    });
    recordStepTiming(timing, Date.now() - 5, summary, onStep);
    expect(timing.totalStepMs).toBeGreaterThanOrEqual(5);
    expect(summary.steps).toEqual([timing]);
    expect(onStep).toHaveBeenCalledWith(timing);
  });

  it('tolerates a missing onStep', () => {
    const summary = makeSummary();
    expect(() => recordStepTiming(makeStepTiming(), Date.now(), summary)).not.toThrow();
    expect(summary.steps).toHaveLength(1);
  });

  it('emptySummary returns fresh zeroed counters each call', () => {
    const a = emptySummary();
    const b = emptySummary();
    expect(a).toEqual({
      steps: [],
      policyApprovals: 0,
      policyDenials: 0,
      fullSnapshots: 0,
      lightObservations: 0,
      interactiveObservations: 0,
      screenshots: 0,
      loopDetections: 0,
      malformedResponses: 0,
      llmRetries: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });
    expect(a.steps).not.toBe(b.steps);
  });
});

describe('overlay helpers', () => {
  it('inject/remove run the overlay scripts', async () => {
    await injectOverlay();
    await removeOverlay();
    expect(executeBrowserScriptMock.mock.calls.map(([script]) => script)).toEqual([
      OVERLAY_INJECT_SCRIPT,
      OVERLAY_REMOVE_SCRIPT,
    ]);
    expect(OVERLAY_INJECT_SCRIPT).toContain('__ppa_overlay__');
    expect(OVERLAY_REMOVE_SCRIPT).toContain('remove()');
  });

  it('swallow script failures (best-effort)', async () => {
    executeBrowserScriptMock.mockRejectedValueOnce(new Error('boom'));
    executeBrowserScriptMock.mockRejectedValueOnce(new Error('boom'));
    await expect(injectOverlay()).resolves.toBeUndefined();
    await expect(removeOverlay()).resolves.toBeUndefined();
  });
});

describe('captureStepObservation', () => {
  const run = (desiredLevel: 'light' | 'interactive' | 'full', state: NativeObservationState, usePageStateFlow = true) => {
    const summary = makeSummary();
    const promise = captureStepObservation({
      desiredLevel,
      usePageStateFlow,
      obsStartedAt: Date.now(),
      log: noopLog,
      summary,
      state,
    });
    return { summary, promise };
  };

  it('light: counts a light observation, updates lastUrl, keeps cached page state', async () => {
    getBrowserLightObservationMock.mockResolvedValueOnce({
      url: 'https://light.dev/',
      title: 't',
      ready_state: 'complete',
      text_excerpt: '',
      active_element: '',
      navigation_id: 'n',
    } as never);
    const state: NativeObservationState = { lastUrl: 'https://old/', lastPageState: pageState };
    const { summary, promise } = run('light', state);
    const observation = await promise;
    expect(summary.lightObservations).toBe(1);
    expect(state.lastUrl).toBe('https://light.dev/');
    expect(observation).toMatchObject({ pageState, level: 'light', cached: false });
    expect(getBrowserPageStateMock).not.toHaveBeenCalled();
  });

  it('light: keeps previous lastUrl when light observation fails', async () => {
    getBrowserLightObservationMock.mockRejectedValueOnce(new Error('nope'));
    const state: NativeObservationState = { lastUrl: 'https://old/', lastPageState: null };
    const { promise } = run('light', state);
    await promise;
    expect(state.lastUrl).toBe('https://old/');
  });

  it('interactive / full: fetch PageState and bump the right counter', async () => {
    getBrowserPageStateMock.mockResolvedValue(pageState);
    const state: NativeObservationState = { lastUrl: '', lastPageState: null };
    const interactive = run('interactive', state);
    expect(await interactive.promise).toMatchObject({ pageState, level: 'interactive' });
    expect(interactive.summary.interactiveObservations).toBe(1);
    expect(interactive.summary.fullSnapshots).toBe(0);
    expect(state.lastPageState).toBe(pageState);

    const full = run('full', state);
    await full.promise;
    expect(full.summary.fullSnapshots).toBe(1);
    expect(full.summary.interactiveObservations).toBe(0);
  });

  it('page-reference error: resyncs then refetches', async () => {
    getBrowserPageStateMock
      .mockRejectedValueOnce(new Error('receiver is gone'))
      .mockResolvedValueOnce(pageState);
    const state: NativeObservationState = { lastUrl: '', lastPageState: null };
    const { summary, promise } = run('interactive', state);
    const observation = await promise;
    expect(resyncBrowserPageMock).toHaveBeenCalledTimes(1);
    expect(getBrowserPageStateMock).toHaveBeenCalledTimes(2);
    expect(observation?.pageState).toBe(pageState);
    expect(summary.interactiveObservations).toBe(1);
    expect(noopLog).toHaveBeenCalledWith('info', '[NativeAgent] Re-syncing page reference...');
  });

  it('page-reference error + failed resync: null page state with warning', async () => {
    getBrowserPageStateMock.mockRejectedValueOnce(new Error('No page'));
    resyncBrowserPageMock.mockRejectedValueOnce(new Error('still gone'));
    const state: NativeObservationState = { lastUrl: '', lastPageState: pageState };
    const { summary, promise } = run('full', state);
    const observation = await promise;
    expect(observation).toMatchObject({ pageState: null, level: 'full' });
    expect(state.lastPageState).toBe(pageState);
    expect(summary.fullSnapshots).toBe(0);
    expect(noopLog).toHaveBeenCalledWith('warning', '[NativeAgent] PageState resync failed: Error: still gone');
  });

  it('generic error: null page state, no resync', async () => {
    getBrowserPageStateMock.mockRejectedValueOnce(new Error('kaboom'));
    const state: NativeObservationState = { lastUrl: '', lastPageState: null };
    const { promise } = run('interactive', state);
    expect(await promise).toMatchObject({ pageState: null, level: 'interactive' });
    expect(resyncBrowserPageMock).not.toHaveBeenCalled();
    expect(noopLog).toHaveBeenCalledWith('warning', '[NativeAgent] PageState fetch failed: Error: kaboom');
  });

  it('non-light level without the PageState flow returns null', async () => {
    const state: NativeObservationState = { lastUrl: 'x', lastPageState: null };
    const { promise } = run('interactive', state, false);
    expect(await promise).toBeNull();
    expect(getBrowserPageStateMock).not.toHaveBeenCalled();
  });
});

describe('AG-07 source guards', () => {
  const utilsDir = path.join(__dirname, '..', 'utils');
  const read = (file: string) => fs.readFileSync(path.join(utilsDir, file), 'utf8');
  const lineCount = (file: string) => read(file).split('\n').length - 1;
  const newModules = [
    'nativeBrowserAgentOverlay.ts',
    'nativeBrowserAgentPrompt.ts',
    'nativeBrowserAgentRunState.ts',
    'nativeBrowserAgentObservation.ts',
    'nativeBrowserAgentTypes.ts',
  ];

  it('nativeBrowserAgent.ts is under 500 lines', () => {
    expect(lineCount('nativeBrowserAgent.ts')).toBeLessThan(500);
  });

  it.each(['nativeBrowserAgent.ts', ...newModules])('%s is < 500 lines with static imports only', (file) => {
    const source = read(file);
    expect(lineCount(file)).toBeLessThan(500);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('keeps the public API of nativeBrowserAgent.ts', () => {
    const source = read('nativeBrowserAgent.ts');
    expect(source).toContain('export async function executeNativeBrowserTask(');
    expect(source).toContain('export async function removeBrowserAgentOverlay(');
    expect(source).toMatch(
      /export type \{\s*NativeAgentOptions,\s*NativeAgentRunSummary,\s*NativeAgentStepTiming,\s*\} from '\.\/nativeBrowserAgentTypes';/,
    );
  });
});
