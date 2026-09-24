/**
 * AG-07: behavior tests for the observation module extracted from
 * `src/utils/nativeBrowserAgent.ts` (`captureStepObservation`) and the
 * `executeNativeBrowserTask` observation await boundary.
 *
 * Pure / prompt / run-state / overlay helper behavior lives in
 * `nativeBrowserAgentExtractHelpers.test.ts`; source guards live in
 * `nativeBrowserAgentExtractGuards.test.ts`.
 */

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

jest.mock('../utils/browserFeatureFlags', () => ({
  isBrowserActionsV2Enabled: jest.fn(() => false),
  isBrowserPageStateV2Enabled: jest.fn(() => false),
  getBrowserMaxAgentSteps: jest.fn(() => 30),
}));

// Pass-through spies so the real implementations run but calls are observable.
jest.mock('../utils/nativeBrowserAgentObservation', () => {
  const actual = jest.requireActual('../utils/nativeBrowserAgentObservation');
  return { ...actual, captureStepObservation: jest.fn(actual.captureStepObservation) };
});
jest.mock('../utils/nativeBrowserAgentHelpers', () => {
  const actual = jest.requireActual('../utils/nativeBrowserAgentHelpers');
  return { ...actual, chooseObservationLevel: jest.fn(actual.chooseObservationLevel) };
});

import { invoke } from '@tauri-apps/api/core';
import type { BrowserPageState } from '@/types/browserPageState';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled } from '@/utils/browserFeatureFlags';
import {
  getBrowserLightObservation,
  getBrowserPageState,
  getBrowserSemanticTree,
} from '@/utils/browserPageStateClient';
import { resyncBrowserPage } from '@/utils/browserSessionClient';
import { chooseObservationLevel } from '@/utils/nativeBrowserAgentHelpers';
import {
  captureStepObservation,
  type NativeObservationState,
} from '@/utils/nativeBrowserAgentObservation';
import { emptySummary } from '@/utils/nativeBrowserAgentRunState';
import {
  executeNativeBrowserTask,
  type NativeAgentRunSummary,
  type NativeAgentStepTiming,
} from '@/utils/nativeBrowserAgent';

const getBrowserPageStateMock = getBrowserPageState as jest.MockedFunction<typeof getBrowserPageState>;
const getBrowserLightObservationMock = getBrowserLightObservation as jest.MockedFunction<typeof getBrowserLightObservation>;
const resyncBrowserPageMock = resyncBrowserPage as jest.MockedFunction<typeof resyncBrowserPage>;
const getBrowserSemanticTreeMock = getBrowserSemanticTree as jest.MockedFunction<typeof getBrowserSemanticTree>;
const invokeMock = invoke as jest.MockedFunction<typeof invoke>;
const actionsFlagMock = isBrowserActionsV2Enabled as jest.MockedFunction<typeof isBrowserActionsV2Enabled>;
const pageStateFlagMock = isBrowserPageStateV2Enabled as jest.MockedFunction<typeof isBrowserPageStateV2Enabled>;
const captureStepObservationMock = captureStepObservation as jest.MockedFunction<typeof captureStepObservation>;
const chooseObservationLevelMock = chooseObservationLevel as jest.MockedFunction<typeof chooseObservationLevel>;
const actualChooseObservationLevel = jest.requireActual('../utils/nativeBrowserAgentHelpers')
  .chooseObservationLevel as typeof chooseObservationLevel;

const makeSummary = (): NativeAgentRunSummary => ({
  startedAt: 0,
  finishedAt: 0,
  totalMs: 0,
  outcome: 'failed',
  finalText: '',
  ...emptySummary(),
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

const noopLog = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
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

describe('executeNativeBrowserTask observation await boundary', () => {
  const doneResponse = {
    content: JSON.stringify({ thought: 't', action: { done: { text: 'ok', success: true } } }),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    invokeMock.mockReset();
    getBrowserPageStateMock.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    actionsFlagMock.mockReturnValue(false);
    pageStateFlagMock.mockReturnValue(false);
  });

  it('non-light + PageState flow off: skips captureStepObservation with no microtask boundary', async () => {
    actionsFlagMock.mockReturnValue(false);
    pageStateFlagMock.mockReturnValue(false);
    const order: string[] = [];
    chooseObservationLevelMock.mockImplementationOnce((args) => {
      const level = actualChooseObservationLevel(args);
      order.push(`choose:${level}`);
      // Queued before the observation section; must run only after the
      // caller has synchronously reached loadSemanticTree (as on main).
      void Promise.resolve().then(() => order.push('microtask'));
      return level;
    });
    getBrowserSemanticTreeMock.mockImplementationOnce(async () => {
      order.push('semanticTree');
      return '[]';
    });
    invokeMock.mockResolvedValueOnce(doneResponse);

    const resultPromise = executeNativeBrowserTask('Just inspect the page', 'k', 'm', {});
    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('ok');
    expect(captureStepObservationMock).not.toHaveBeenCalled();
    expect(getBrowserPageStateMock).not.toHaveBeenCalled();
    expect(order).toEqual(['choose:full', 'semanticTree', 'microtask']);
  });

  it('PageState flow on: awaits captureStepObservation for the non-light level', async () => {
    actionsFlagMock.mockReturnValue(true);
    pageStateFlagMock.mockReturnValue(true);
    getBrowserPageStateMock.mockResolvedValue(pageState);
    invokeMock.mockResolvedValueOnce(doneResponse);

    const resultPromise = executeNativeBrowserTask('Just inspect the page', 'k', 'm', {});
    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('ok');
    expect(captureStepObservationMock).toHaveBeenCalledTimes(1);
    expect(captureStepObservationMock.mock.calls[0]?.[0]).toMatchObject({
      desiredLevel: 'full',
      usePageStateFlow: true,
    });
    expect(getBrowserPageStateMock).toHaveBeenCalledTimes(1);
  });
});
