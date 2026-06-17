/**
 * Vision fallback tests.
 *
 * Cover the Phase 9 acceptance criteria:
 *   - decision returns allow-by-default when DOM is healthy
 *   - decision triggers on canvas/shadow warnings
 *   - decision triggers on repeated empty PageState
 *   - decision triggers on missed click target
 *   - dispatch routes through the registered mock provider
 */

import {
  decideVisionFallback,
  dispatchVisionFallback,
} from '@/utils/browserVisionFallback';
import { defaultVisionProvider, listVisionProviders } from '../utils/visionBrowserProvider';

jest.mock('@/utils/browserFeatureFlags', () => ({
  isBrowserVisionFallbackEnabled: jest.fn(() => false),
}));

const pageStateWithWarning = {
  url: 'https://example.com',
  title: '',
  navigation_id: 'n1',
  frame_count: 1,
  warnings: ['canvas content not exposed'],
  elements: [],
};

const emptyState = {
  url: 'https://example.com',
  title: '',
  navigation_id: 'n1',
  frame_count: 1,
  warnings: [],
  elements: [],
};

describe('browserVisionFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes a registered mock provider', () => {
    const provider = defaultVisionProvider();
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('mock');
    expect(listVisionProviders().length).toBeGreaterThan(0);
  });

  it('declines to attempt fallback on a healthy DOM by default', () => {
    const decision = decideVisionFallback({
      url: 'https://example.com',
      pageState: emptyState,
      emptyStateStreak: 0,
      lastClickTargetMiss: false,
    });
    expect(decision.shouldAttempt).toBe(false);
    expect(decision.providerReady).toBe(true);
  });

  it('triggers fallback when canvas/shadow warnings are present', () => {
    const decision = decideVisionFallback({
      url: 'https://example.com',
      pageState: pageStateWithWarning,
      emptyStateStreak: 0,
      lastClickTargetMiss: false,
    });
    expect(decision.shouldAttempt).toBe(true);
    expect(decision.reason).toContain('DOM is partial');
  });

  it('triggers fallback when PageState is empty twice in a row', () => {
    const decision = decideVisionFallback({
      url: 'https://example.com',
      pageState: emptyState,
      emptyStateStreak: 2,
      lastClickTargetMiss: false,
    });
    expect(decision.shouldAttempt).toBe(true);
    expect(decision.reason).toContain('Empty PageState');
  });

  it('triggers fallback when the previous click target missed', () => {
    const decision = decideVisionFallback({
      url: 'https://example.com',
      pageState: emptyState,
      emptyStateStreak: 0,
      lastClickTargetMiss: true,
    });
    expect(decision.shouldAttempt).toBe(true);
    expect(decision.reason).toContain('target could not be resolved');
  });

  it('respects an explicit forceEnabled flag', () => {
    const decision = decideVisionFallback({
      url: 'https://example.com',
      pageState: emptyState,
      emptyStateStreak: 0,
      lastClickTargetMiss: false,
      forceEnabled: true,
    });
    expect(decision.shouldAttempt).toBe(true);
    expect(decision.reason).toContain('enabled');
  });
});

describe('dispatchVisionFallback', () => {
  it('returns null when the provider is not ready', async () => {
    const action = await dispatchVisionFallback({
      task: 'noop',
      screenshotRef: null,
      viewport: { width: 1280, height: 720 },
      history: [],
      pageMeta: { url: '', title: '', navigationId: '' },
    });
    expect(action).toBeNull();
  });

  it('dispatches to the mock provider and returns a left_click action', async () => {
    const action = await dispatchVisionFallback({
      task: 'click the centre button',
      screenshotRef: { kind: 'base64_png', value: 'fake' },
      viewport: { width: 1280, height: 720 },
      history: [],
      pageMeta: { url: 'https://example.com', title: 'Example', navigationId: 'n1' },
    });
    expect(action).not.toBeNull();
    expect(action?.action).toBe('left_click');
    if (action?.action === 'left_click') {
      expect(action.coordinate[0]).toBe(640);
      expect(action.coordinate[1]).toBe(360);
    }
  });
});
