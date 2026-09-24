/**
 * Per-step observation capture for the native CDP browser agent (AG-07 extract).
 *
 * Moved verbatim from `executeNativeBrowserTask` in `nativeBrowserAgent.ts`.
 * `state` carries the loop-scoped `lastUrl` / `lastPageState` that the loop
 * previously held in local `let` bindings; it is mutated in place so the
 * caller observes exactly the same values after each step.
 */

import { getBrowserPageState } from './browserPageStateClient';
import { resyncBrowserPage } from './browserSessionClient';
import type { BrowserPageState } from '@/types/browserPageState';
import type { ObservationLevel } from '@/types/browserEngine';
import { fetchLightObservation, isPageReferenceError } from './nativeBrowserAgentHelpers';
import type { AgentLogger, ObservationSnapshot } from './nativeBrowserAgentHelpers';
import type { NativeAgentRunSummary } from './nativeBrowserAgentTypes';

export interface NativeObservationState {
  lastUrl: string;
  lastPageState: BrowserPageState | null;
}

export async function captureStepObservation(args: {
  desiredLevel: ObservationLevel;
  usePageStateFlow: boolean;
  obsStartedAt: number;
  log: AgentLogger;
  summary: NativeAgentRunSummary;
  state: NativeObservationState;
}): Promise<ObservationSnapshot | null> {
  const { desiredLevel, usePageStateFlow, obsStartedAt, log, summary, state } = args;
  let pageState: BrowserPageState | null = null;
  let observation: ObservationSnapshot | null = null;

  if (desiredLevel === 'light') {
    const light = await fetchLightObservation(log);
    summary.lightObservations += 1;
    state.lastUrl = light.url || state.lastUrl;
    if (light.url) {
      // url changed without us navigating? force an interactive refresh
    }
    observation = {
      pageState: state.lastPageState,
      level: 'light',
      durationMs: Date.now() - obsStartedAt,
      cached: false,
    };
  } else if (usePageStateFlow) {
    try {
      pageState = await getBrowserPageState();
      observation = {
        pageState,
        level: desiredLevel,
        durationMs: Date.now() - obsStartedAt,
        cached: false,
      };
      state.lastPageState = pageState;
      if (desiredLevel === 'full') summary.fullSnapshots += 1;
      else summary.interactiveObservations += 1;
    } catch (error) {
      if (isPageReferenceError(error)) {
        log('info', '[NativeAgent] Re-syncing page reference...');
        try {
          await resyncBrowserPage();
          pageState = await getBrowserPageState();
          observation = {
            pageState,
            level: desiredLevel,
            durationMs: Date.now() - obsStartedAt,
            cached: false,
          };
          state.lastPageState = pageState;
          if (desiredLevel === 'full') summary.fullSnapshots += 1;
          else summary.interactiveObservations += 1;
        } catch (resyncError) {
          log('warning', `[NativeAgent] PageState resync failed: ${resyncError}`);
          observation = {
            pageState: null,
            level: desiredLevel,
            durationMs: Date.now() - obsStartedAt,
            cached: false,
          };
        }
      } else {
        log('warning', `[NativeAgent] PageState fetch failed: ${error}`);
        observation = {
          pageState: null,
          level: desiredLevel,
          durationMs: Date.now() - obsStartedAt,
          cached: false,
        };
      }
    }
  }

  return observation;
}
