/**
 * AG-07: behavior tests for the pure / prompt / run-state / overlay modules
 * extracted from `src/utils/nativeBrowserAgent.ts`.
 *
 * Split out of `nativeBrowserAgentExtract.test.ts` (test hygiene, no case
 * changes). Observation + await-boundary behavior stays in
 * `nativeBrowserAgentExtract.test.ts`; source guards live in
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

import { executeBrowserScript } from '@/utils/browserActionClient';
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
import type { NativeAgentRunSummary, NativeAgentStepTiming } from '@/utils/nativeBrowserAgent';

const executeBrowserScriptMock = executeBrowserScript as jest.MockedFunction<typeof executeBrowserScript>;

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

const sig = (overrides: Partial<LoopSignature> = {}): LoopSignature => ({
  url: 'https://a.com',
  navigationId: 'n1',
  actionName: 'click_element',
  target: 'bn:1',
  ...overrides,
});

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
