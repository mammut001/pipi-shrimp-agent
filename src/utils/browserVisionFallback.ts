/**
 * Vision fallback decision + dispatch helper.
 *
 * The native agent loop uses this module to decide whether to ask the vision
 * provider for help on the current step, and (when enabled) to actually
 * dispatch the request. This intentionally does not depend on a real
 * vision runtime — `defaultVisionProvider()` returns the mock unless a real
 * provider was registered at startup.
 *
 * Trigger conditions (matches the Phase 9 spec):
 *   - PageState has 0 useful elements twice in a row.
 *   - Click target could not be resolved (returns null).
 *   - PageState warnings mention canvas / shadow / iframe.
 *   - User explicitly enabled vision fallback via the feature flag.
 */

import type { BrowserPageState } from '@/types/browserPageState';
import type { VisionBrowserAction, VisionBrowserInput } from '@/types/visionBrowserAgent';
import { isBrowserVisionFallbackEnabled } from './browserFeatureFlags';
import { defaultVisionProvider, getVisionProvider } from './visionBrowserProvider';

const TRIGGER_TOKENS = ['canvas', 'shadow', 'iframe', 'webgl', 'cross-origin', 'opaque'];

export interface VisionFallbackDecision {
  /** Whether the fallback should be attempted on this step. */
  shouldAttempt: boolean;
  /** Reason the fallback was (or wasn't) chosen — surfaced in logs and debug panel. */
  reason: string;
  /** Whether the underlying provider is ready to run. */
  providerReady: boolean;
}

export interface VisionFallbackContext {
  url: string;
  pageState: BrowserPageState | null;
  /** Number of consecutive empty PageState observations. */
  emptyStateStreak: number;
  /** True if the most recent click target failed to resolve. */
  lastClickTargetMiss: boolean;
  /** True if the user explicitly opted in via the feature flag. */
  forceEnabled?: boolean;
}

const hasCanvasOrShadowWarning = (pageState: BrowserPageState | null): boolean => {
  if (!pageState) return false;
  return pageState.warnings.some((warning) =>
    TRIGGER_TOKENS.some((token) => warning.toLowerCase().includes(token)),
  );
};

export const decideVisionFallback = (ctx: VisionFallbackContext): VisionFallbackDecision => {
  const provider = defaultVisionProvider();
  const providerReady = Boolean(provider);
  const userEnabled = ctx.forceEnabled ?? isBrowserVisionFallbackEnabled();

  if (!providerReady) {
    return {
      shouldAttempt: false,
      reason: 'No vision provider registered; fallback disabled.',
      providerReady: false,
    };
  }

  if (userEnabled) {
    return {
      shouldAttempt: true,
      reason: 'User enabled vision fallback via feature flag.',
      providerReady: true,
    };
  }

  if (ctx.emptyStateStreak >= 2) {
    return {
      shouldAttempt: true,
      reason: `Empty PageState streak (${ctx.emptyStateStreak}); falling back to vision.`,
      providerReady: true,
    };
  }

  if (ctx.lastClickTargetMiss) {
    return {
      shouldAttempt: true,
      reason: 'Last click target could not be resolved; trying vision.',
      providerReady: true,
    };
  }

  if (hasCanvasOrShadowWarning(ctx.pageState)) {
    return {
      shouldAttempt: true,
      reason: 'Page warnings suggest DOM is partial; trying vision.',
      providerReady: true,
    };
  }

  return {
    shouldAttempt: false,
    reason: 'DOM is healthy; vision fallback not needed.',
    providerReady,
  };
};

export interface DispatchVisionInput {
  task: string;
  screenshotRef: VisionBrowserInput['screenshotRef'];
  viewport: VisionBrowserInput['viewport'];
  history: VisionBrowserInput['history'];
  pageMeta: VisionBrowserInput['pageMeta'];
  providerName?: string;
}

export const dispatchVisionFallback = async (
  input: DispatchVisionInput,
): Promise<VisionBrowserAction | null> => {
  const provider = input.providerName
    ? getVisionProvider(input.providerName)
    : defaultVisionProvider();
  if (!provider) {
    return null;
  }
  if (typeof provider.isReady === 'function' && !provider.isReady(input)) {
    return null;
  }
  return provider.observeAndAct(input);
};
