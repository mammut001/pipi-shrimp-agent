/**
 * Native Browser Agent (CDP-backed).
 *
 * Drives the Rust CDP commands directly (via `invoke('browser_*')`) instead of
 * injecting the page-agent IIFE into the WebView. The agent loop here is the
 * single source of truth for "default browser automation" — the page-agent
 * path remains available behind a feature flag for compatibility.
 *
 * Design goals implemented in this rewrite:
 *   - Deterministic, schema-validated JSON actions (see browserAgentActionSchema).
 *   - Tiered observation levels: light / interactive / full / screenshot.
 *   - Per-step timing breakdown (observation_ms, llm_ms, action_ms, etc.).
 *   - Loop detection: same URL + same action + same target repeated N times.
 *   - Compact observation feedback appended to the conversation after each
 *     action so the model gets a structured "what just happened" update.
 *   - Optional safety policy gate via `approveAction` callback.
 */

import { invoke } from '@tauri-apps/api/core';

import { getCurrentBrowserUrl } from './browserPageStateClient';
import { formatBrowserPageStateForPrompt } from './browserPageStateModel';
import { connectBrowserSession, navigateBrowserPage, resyncBrowserPage } from './browserSessionClient';
import { executeBrowserActionEnvelope, renderActionFeedback } from './browserActionExecutor';
import { browserSurfaceUrlsMatch } from '@/store/browser/browserAgentStartGate';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled, getBrowserMaxAgentSteps } from './browserFeatureFlags';
import type { ObservationLevel } from '@/types/browserEngine';
import { parseBrowserActionEnvelopeWithRetry } from './browserAgentActionSchema';
import { evaluateBrowserAction, type BrowserActionPolicyContext } from './browserActionPolicy';
import {
  assertNotAborted,
  buildPrompt,
  cacheKeyEqual,
  chooseObservationLevel,
  computeCacheKey,
  delay,
  loadSemanticTree,
  readString,
  shouldPostWait,
  signatureFor,
} from './nativeBrowserAgentHelpers';
import type { CacheKey, LoopSignature, ObservationSnapshot } from './nativeBrowserAgentHelpers';
import { injectOverlay, removeOverlay } from './nativeBrowserAgentOverlay';
import { NATIVE_BROWSER_AGENT_SYSTEM_PROMPT, resolveNativeAgentStartUrl } from './nativeBrowserAgentPrompt';
import {
  countLoopRepeats,
  emptySummary,
  recordStepTiming,
  resolveIncompleteRunOutcome,
} from './nativeBrowserAgentRunState';
import { captureStepObservation, type NativeObservationState } from './nativeBrowserAgentObservation';
import type {
  NativeAgentOptions,
  NativeAgentRunSummary,
  NativeAgentStepTiming,
} from './nativeBrowserAgentTypes';

export type {
  NativeAgentOptions,
  NativeAgentRunSummary,
  NativeAgentStepTiming,
} from './nativeBrowserAgentTypes';

/** Best-effort CDP page overlay teardown (R3-07). Safe to call from store error paths. */
export async function removeBrowserAgentOverlay(): Promise<void> {
  await removeOverlay();
}

// ─── Public entry point ────────────────────────────────────────────────────

export async function executeNativeBrowserTask(
  task: string,
  apiKey: string,
  model: string,
  options: NativeAgentOptions = {},
): Promise<string> {
  const log = options.onLog ?? (() => undefined);
  const maxSteps = Math.max(1, options.maxSteps ?? getBrowserMaxAgentSteps());
  const usePageStateFlow = isBrowserPageStateV2Enabled() && isBrowserActionsV2Enabled();
  const captureEveryStep =
    options.captureScreenshotEveryStep ?? false;

  const summary: NativeAgentRunSummary = {
    startedAt: Date.now(),
    finishedAt: 0,
    totalMs: 0,
    outcome: 'failed',
    finalText: '',
    ...emptySummary(),
  };

  assertNotAborted(options.signal);

  log('info', '[NativeAgent] Initializing CDP Connection...');
  try {
    await connectBrowserSession();
    assertNotAborted(options.signal);
    log('success', '[NativeAgent] Browser connected via CDP!');
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw e;
    }
    log('error', `[NativeAgent] Connection failed: ${e}`);
    throw new Error(`Failed to connect to local Chrome (is remote debugging enabled?)\nDetails: ${e}`);
  }

  const systemPrompt = NATIVE_BROWSER_AGENT_SYSTEM_PROMPT;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let isDone = false;
  let finalResult = '';
  let lastNavigationId = '';
  const observationState: NativeObservationState = { lastUrl: '', lastPageState: null };
  let cachedObservationKey: CacheKey | null = null;
  let isPostNavigation = true;
  const loopHistory: LoopSignature[] = [];
  const LOOP_WINDOW = 4;
  const LOOP_TRIGGER = 3;

  log('info', `[NativeAgent] Starting task: ${task}`);
  const currentBrowserUrl = await getCurrentBrowserUrl().catch(() => null);

  const startUrl = resolveNativeAgentStartUrl(task, options.targetUrl, currentBrowserUrl);
  if (currentBrowserUrl && browserSurfaceUrlsMatch(currentBrowserUrl, startUrl)) {
    log('info', `[NativeAgent] Already on target surface (${startUrl}), skipping redundant navigation.`);
  } else {
    log('info', `[NativeAgent] Navigating to: ${startUrl}`);
    try {
      await navigateBrowserPage(startUrl);
      log('success', `[NativeAgent] Page loaded: ${startUrl}`);
    } catch (e) {
      log('warning', `[NativeAgent] Navigation attempted: ${e}`);
    }
  }
  await delay(1200, options.signal);

  try {
  // Inject after the try begins so every exit (success/error/abort) hits finally cleanup (R3-07).
  await injectOverlay();
  for (let step = 0; step < maxSteps && !isDone; step += 1) {
    assertNotAborted(options.signal);
    const stepStartedAt = Date.now();
    const stepTiming: NativeAgentStepTiming = {
      step: step + 1,
      engine: 'cdp_native',
      url: observationState.lastUrl,
      navigationId: lastNavigationId,
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
    };

    try {
      // ── 1. Observation ────────────────────────────────────────────────
      const obsStartedAt = Date.now();
      const effectiveLevel = chooseObservationLevel({
        step,
        isPostNavigation,
        lastNavigationId,
        nextNavigationId: lastNavigationId,
        cacheHit: false,
        pageState: observationState.lastPageState,
      });
      // Pre-compute the cache key for the previous state if we have one.
      const previousCacheKey = cachedObservationKey;
      const desiredLevel: ObservationLevel = effectiveLevel;

      // Same branch boundary as the original inline block: only the light and
      // PageState paths await; otherwise continue synchronously (no microtask).
      let observation: ObservationSnapshot | null = null;
      if (desiredLevel === 'light' || usePageStateFlow) {
        observation = await captureStepObservation({
          desiredLevel,
          usePageStateFlow,
          obsStartedAt,
          log,
          summary,
          state: observationState,
        });
      }

      // Maintain the observation cache. We always recompute it because the
      // model needs the latest URL/title even on light observations.
      const newKey = computeCacheKey(observationState.lastPageState);
      if (newKey && previousCacheKey && cacheKeyEqual(newKey, previousCacheKey)) {
        summary.cacheHits += 1;
        observation && (observation.cached = true);
        stepTiming.reusedCache = true;
      } else {
        summary.cacheMisses += 1;
      }
      cachedObservationKey = newKey;

      stepTiming.observationLevel = observation?.level ?? 'light';
      stepTiming.observationMs = Date.now() - obsStartedAt;
      stepTiming.url = observation?.pageState?.url ?? observationState.lastUrl;
      stepTiming.navigationId = observation?.pageState?.navigation_id ?? lastNavigationId;
      lastNavigationId = stepTiming.navigationId;
      observationState.lastUrl = stepTiming.url || observationState.lastUrl;

      assertNotAborted(options.signal);

      // ── 2. Build prompt + call LLM ─────────────────────────────────────
      const pageContextBody = observation?.pageState
        ? formatBrowserPageStateForPrompt(observation.pageState)
        : await loadSemanticTree(log);

      const promptText = buildPrompt({
        task,
        currentUrl: stepTiming.url || observationState.lastUrl,
        step,
        maxSteps,
        pageContextBody,
        observationLevel: stepTiming.observationLevel,
        elementsCount: observation?.pageState?.elements.length ?? 0,
      });
      stepTiming.promptChars = promptText.length;
      messages.push({ role: 'user', content: promptText });

      const llmStartedAt = Date.now();
      let responseText = '';
      let llmFailed = false;
      try {
        const response: any = await invoke('send_claude_sdk_chat', {
          messages,
          apiKey,
          model,
          baseUrl: options.baseUrl || null,
          systemPrompt,
        });
        assertNotAborted(options.signal);
        responseText = response.content;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        llmFailed = true;
        log('error', `[NativeAgent] LLM error: ${error}`);
        throw error;
      }
      stepTiming.llmMs = Date.now() - llmStartedAt;

      messages.push({ role: 'assistant', content: responseText });

      // ── 3. Parse the action ────────────────────────────────────────────
      const parsedResult = parseBrowserActionEnvelopeWithRetry(responseText, summary.malformedResponses);
      if (!parsedResult.ok) {
        summary.malformedResponses += 1;
        stepTiming.actionName = 'invalid';
        stepTiming.errorCode = 'malformed_json';
        log('error', `[NativeAgent] JSON parse error: ${parsedResult.error}`);
        if (parsedResult.fatal) {
          log('error', '[NativeAgent] Repeated malformed response — stopping.');
          stepTiming.success = false;
          recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
          break;
        }
        messages.push({
          role: 'user',
          content: `Your previous response was not valid JSON. ${parsedResult.error ?? ''}\nRespond with a single JSON object that matches the schema.`,
        });
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        continue;
      }

      const envelope = parsedResult.envelope!;
      stepTiming.actionName = envelope.actionName;
      if (envelope.thought) {
        log('info', `[NativeAgent] 💭 ${envelope.thought}`);
      }
      log('success', `[NativeAgent] Action: ${envelope.actionName} ${JSON.stringify(envelope.payload)}`);

      // ── 4. Loop detection ──────────────────────────────────────────────
      const signature = signatureFor(stepTiming.url, stepTiming.navigationId, envelope);
      const sameLoop = countLoopRepeats(loopHistory, signature, LOOP_WINDOW);
      if (sameLoop >= LOOP_TRIGGER) {
        summary.loopDetections += 1;
        log(
          'warning',
          `[NativeAgent] Loop detected: ${signature.actionName} on ${signature.target} repeated ${sameLoop} times. Asking model to break the loop.`,
        );
        messages.push({
          role: 'user',
          content:
            'You appear to be repeating the same action without progress. Try a different target, refresh_page_state with level="full", or call ask_user to clarify the task.',
        });
        stepTiming.errorCode = 'loop_detected';
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        continue;
      }

      // ── 5. Policy gate ─────────────────────────────────────────────────
      const policyContext: BrowserActionPolicyContext = {
        actionName: envelope.actionName,
        payload: envelope.payload,
        pageState: observation?.pageState ?? null,
        url: stepTiming.url || observationState.lastUrl,
        permissionMode: options.permissionMode ?? 'auto_safe',
      };
      const verdict = evaluateBrowserAction(policyContext);
      if (verdict.decision === 'block') {
        summary.policyDenials += 1;
        log('warning', `[NativeAgent] Policy blocked action: ${verdict.reason}`);
        messages.push({
          role: 'user',
          content: `Action blocked by policy: ${verdict.reason}. Use a different approach or call ask_user.`,
        });
        stepTiming.errorCode = 'policy_blocked';
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        continue;
      }
      if (verdict.decision === 'ask') {
        let approved = false;
        try {
          approved = options.approveAction
            ? await options.approveAction(verdict, policyContext)
            : false;
        } catch {
          approved = false;
        }
        if (!approved) {
          summary.policyDenials += 1;
          log('warning', `[NativeAgent] User denied action: ${verdict.reason}`);
          messages.push({
            role: 'user',
            content: `User denied the action: ${verdict.reason}. Pick a different approach or call ask_user.`,
          });
          stepTiming.errorCode = 'policy_denied';
          recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
          continue;
        }
        summary.policyApprovals += 1;
        log('info', `[NativeAgent] User approved action (${verdict.reason}).`);
      }

      // ── 6. Execute ─────────────────────────────────────────────────────
      const execStartedAt = Date.now();
      const feedback = await executeBrowserActionEnvelope({
        envelope,
        pageState: observation?.pageState ?? null,
        log,
      });
      assertNotAborted(options.signal);
      stepTiming.actionMs = Date.now() - execStartedAt;
      stepTiming.success = feedback.success;
      stepTiming.errorCode = feedback.errorCode;
      stepTiming.url = feedback.url || stepTiming.url;
      stepTiming.navigationId = feedback.navigationId || stepTiming.navigationId;
      observationState.lastUrl = stepTiming.url;
      lastNavigationId = stepTiming.navigationId;

      // Optional screenshot per step (off by default to keep memory low).
      if (captureEveryStep) {
        const ssStartedAt = Date.now();
        try {
          await invoke<string>('browser_screenshot');
          summary.screenshots += 1;
          stepTiming.screenshotMs = Date.now() - ssStartedAt;
        } catch {
          stepTiming.screenshotMs = Date.now() - ssStartedAt;
        }
      }

      // ── 7. Post-action wait + feedback ─────────────────────────────────
      const waitStartedAt = Date.now();
      const postWait = shouldPostWait(envelope.actionName);
      if (postWait > 0) {
        await delay(postWait, options.signal);
      }
      stepTiming.postWaitMs = Date.now() - waitStartedAt;

      isPostNavigation = envelope.actionName === 'navigate' || envelope.actionName === 'click_element' || envelope.actionName === 'press_key';

      // done / ask_user terminate the loop.
      if (envelope.actionName === 'done') {
        isDone = true;
        finalResult = readString(envelope.payload.text, 'Task completed');
        await removeOverlay();
        log('success', `[NativeAgent] ✅ ${finalResult}`);
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        break;
      }
      if (envelope.actionName === 'ask_user') {
        await removeOverlay();
        finalResult = `Agent needs your input: ${readString(envelope.payload.question, 'I need your help')}`;
        isDone = true;
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        break;
      }

      // Refresh the page reference when navigation or popup likely happened.
      if (envelope.actionName === 'navigate' || envelope.actionName === 'click_element') {
        try {
          await resyncBrowserPage();
        } catch {
          /* ok */
        }
      }

      // Append compact feedback so the model has structured grounding for the
      // next step without re-reading the whole PageState.
      messages.push({
        role: 'user',
        content: renderActionFeedback({
          ...feedback,
          elementCount: observation?.pageState?.elements.length ?? 0,
        }),
      });

      recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        stepTiming.success = false;
        stepTiming.errorCode = 'aborted';
        recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
        await removeOverlay();
        summary.outcome = 'aborted';
        summary.finishedAt = Date.now();
        summary.totalMs = summary.finishedAt - summary.startedAt;
        options.onRunSummary?.(summary);
        throw error;
      }
      stepTiming.success = false;
      stepTiming.errorCode = 'exception';
      recordStepTiming(stepTiming, stepStartedAt, summary, options.onStep);
      throw error;
    }
  }

  if (!isDone) {
    await removeOverlay();
    summary.outcome = resolveIncompleteRunOutcome(summary, maxSteps);
    if (!finalResult) {
      finalResult = 'NativeAgent stopped without producing a final answer.';
    }
  } else {
    summary.outcome = finalResult ? 'completed' : 'failed';
  }

  summary.finishedAt = Date.now();
  summary.totalMs = summary.finishedAt - summary.startedAt;
  summary.finalText = finalResult;

  log(
    summary.outcome === 'completed' ? 'success' : 'warning',
    `[NativeAgent] Run finished: ${summary.outcome} (${summary.steps.length} steps, ${summary.totalMs}ms total, ${summary.cacheHits} cache hits, ${summary.lightObservations} light / ${summary.interactiveObservations} interactive / ${summary.fullSnapshots} full).`,
  );

  options.onRunSummary?.(summary);

  return finalResult;
  } finally {
    await removeOverlay();
  }
}
