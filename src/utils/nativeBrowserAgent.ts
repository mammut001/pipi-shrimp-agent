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

import { executeBrowserScript } from './browserActionClient';
import {
  getBrowserPageState,
  getCurrentBrowserUrl,
} from './browserPageStateClient';
import { formatBrowserPageStateForPrompt } from './browserPageStateModel';
import { connectBrowserSession, navigateBrowserPage, resyncBrowserPage } from './browserSessionClient';
import { executeBrowserActionEnvelope, renderActionFeedback } from './browserActionExecutor';
import { browserSurfaceUrlsMatch } from '@/store/browser/browserAgentStartGate';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled, getBrowserMaxAgentSteps } from './browserFeatureFlags';
import type { BrowserPageState } from '@/types/browserPageState';
import type { ObservationLevel } from '@/types/browserEngine';
import {
  parseBrowserActionEnvelopeWithRetry,
  type SupportedActionName,
} from './browserAgentActionSchema';
import {
  evaluateBrowserAction,
  type BrowserActionPolicyContext,
  type BrowserActionPolicyVerdict,
} from './browserActionPolicy';
import {
  assertNotAborted,
  buildPrompt,
  cacheKeyEqual,
  chooseObservationLevel,
  computeCacheKey,
  delay,
  entriesEqual,
  fetchLightObservation,
  isPageReferenceError,
  loadSemanticTree,
  readString,
  shouldPostWait,
  signatureFor,
} from './nativeBrowserAgentHelpers';
import type {
  AgentLogger,
  CacheKey,
  LoopSignature,
  ObservationSnapshot,
} from './nativeBrowserAgentHelpers';

// ─── Agent scanning overlay ────────────────────────────────────────────────
// Injected into the CDP-controlled Chrome page while the agent is running so
// the user has a visual indicator that automation is in progress.

const OVERLAY_INJECT_SCRIPT = `(function(){
  if(document.getElementById('__ppa_overlay__'))return;
  var s=document.createElement('style');
  s.id='__ppa_style__';
  s.textContent=
    '@property --ppa{syntax:"<angle>";initial-value:0deg;inherits:false}' +
    '@keyframes ppa_sweep{to{--ppa:360deg}}' +
    '#__ppa_overlay__{' +
      'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;' +
      'z-index:2147483647;--ppa:0deg;' +
      'animation:ppa_sweep 1.8s linear infinite;' +
      'background:conic-gradient(from var(--ppa),' +
        'rgba(0,220,255,0) 0deg,' +
        'rgba(0,200,255,1) 40deg,' +
        'rgba(120,80,255,1) 70deg,' +
        'rgba(255,60,220,1) 100deg,' +
        'rgba(0,200,255,.3) 140deg,' +
        'rgba(0,220,255,0) 180deg,' +
        'rgba(0,220,255,0) 360deg);' +
      '-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);' +
      '-webkit-mask-composite:xor;mask-composite:exclude;' +
      'padding:10px;' +
      'filter:drop-shadow(0 0 8px rgba(0,200,255,0.9)) drop-shadow(0 0 20px rgba(120,80,255,0.7))}';
  document.head.appendChild(s);
  var d=document.createElement('div');
  d.id='__ppa_overlay__';
  document.body.appendChild(d);
})();`;

const OVERLAY_REMOVE_SCRIPT = `(function(){
  var el=document.getElementById('__ppa_overlay__');if(el)el.remove();
  var s=document.getElementById('__ppa_style__');if(s)s.remove();
})();`;

async function injectOverlay(): Promise<void> {
  try {
    await executeBrowserScript(OVERLAY_INJECT_SCRIPT);
  } catch {
    /* best-effort */
  }
}

async function removeOverlay(): Promise<void> {
  try {
    await executeBrowserScript(OVERLAY_REMOVE_SCRIPT);
  } catch {
    /* best-effort */
  }
}

/** Best-effort CDP page overlay teardown (R3-07). Safe to call from store error paths. */
export async function removeBrowserAgentOverlay(): Promise<void> {
  await removeOverlay();
}

// ─── Agent logging ─────────────────────────────────────────────────────────


// ─── Step timing model ─────────────────────────────────────────────────────

export interface NativeAgentStepTiming {
  step: number;
  engine: 'cdp_native';
  url: string;
  navigationId: string;
  observationLevel: ObservationLevel;
  observationMs: number;
  promptChars: number;
  llmMs: number;
  actionName: SupportedActionName | 'invalid';
  actionMs: number;
  postWaitMs: number;
  screenshotMs: number;
  totalStepMs: number;
  success: boolean;
  errorCode?: string;
  reusedCache: boolean;
}

export interface NativeAgentRunSummary {
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  steps: NativeAgentStepTiming[];
  outcome: 'completed' | 'failed' | 'aborted' | 'loop_detected' | 'max_steps';
  /** How many times the policy asked the user and was approved. */
  policyApprovals: number;
  /** How many times the policy denied an action. */
  policyDenials: number;
  /** Number of full PageState captures. */
  fullSnapshots: number;
  /** Number of light observations. */
  lightObservations: number;
  /** Number of interactive observations. */
  interactiveObservations: number;
  /** Number of screenshots taken. */
  screenshots: number;
  /** Number of repeated-action loops detected. */
  loopDetections: number;
  /** Number of times the model returned malformed JSON. */
  malformedResponses: number;
  /** Number of times the LLM call was retried due to error. */
  llmRetries: number;
  /** Cache hit / miss totals for PageState. */
  cacheHits: number;
  cacheMisses: number;
  /** Final free-form text returned to the caller. */
  finalText: string;
}

const emptySummary = (): Omit<
  NativeAgentRunSummary,
  'startedAt' | 'finishedAt' | 'totalMs' | 'outcome' | 'finalText'
> => ({
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


// ─── Public entry point ────────────────────────────────────────────────────

export interface NativeAgentOptions {
  baseUrl?: string;
  targetUrl?: string;
  onLog?: AgentLogger;
  /** Approve or deny a sensitive action. Returns true to allow, false to deny. */
  approveAction?: (
    verdict: BrowserActionPolicyVerdict,
    context: BrowserActionPolicyContext,
  ) => Promise<boolean> | boolean;
  /** Hint to the policy layer. */
  permissionMode?: 'observe_only' | 'ask_each_action' | 'auto_safe';
  /** Force a screenshot per step regardless of flag. */
  captureScreenshotEveryStep?: boolean;
  /** Maximum number of steps (overrides flag). */
  maxSteps?: number;
  /** Stop early when a run summary callback fires. Used by debug panels. */
  onStep?: (timing: NativeAgentStepTiming) => void;
  /** Called once when the run finishes with the full summary. */
  onRunSummary?: (summary: NativeAgentRunSummary) => void;
  /** Cooperative cancellation for stopTask and diagnostics cancel hooks. */
  signal?: AbortSignal;
}

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

  const systemPrompt = `You are a powerful browser automation agent. You control a real Chrome browser to complete tasks for the user.

OUTPUT FORMAT — Respond with valid JSON only. No conversational text outside JSON. The JSON may optionally be wrapped in a fenced \`\`\`json ... \`\`\` block. Anything before or after the JSON is ignored.
{
  "thought": "Brief explanation of what I see and what I'll do next",
  "action": {
    "<action_name>": { ...payload... }
  }
}

VALID ACTIONS (only these — do NOT invent new ones):
- wait: { "seconds"?: number <=15, "milliseconds"?: number <=15000 }
- wait_for_selector: { "selector": string, "timeout_ms"?: number <=30000 }
- click_element: { "id"?: number, "backend_node_id"?: number, "selector"?: string }
- input_text: { "id"?: number, "backend_node_id"?: number, "text": string, "press_enter"?: boolean, "selector"?: string }
- press_key: { "key": string, "modifiers"?: string[] }
- scroll: { "direction": "up"|"down"|"left"|"right", "pixels"?: number <=10000 }
- navigate: { "url": string, "wait_selector"?: string, "timeout_ms"?: number <=60000 }
- extract_text: { "max_length"?: number <=20000, "selector"?: string }
- done: { "text": string, "success": boolean }
- ask_user: { "question": string, "options"?: string[] }
- refresh_page_state: { "level"?: "light"|"interactive"|"full", "force"?: boolean }
- screenshot_observe: { "max_width"?: number, "format"?: "jpeg"|"png" }

TARGETING RULES:
- For click_element and input_text, prefer backend_node_id when the page state exposes it (more stable on dynamic pages).
- If both id and backend_node_id are listed, either works.
- Selector-based targeting is allowed as a fallback when ids are missing.

OBSERVATION:
- After every action you will receive an "Action result" block summarising the previous tool call.
- If the action failed, treat the error code as a hint to retry with a different target, escalate to refresh_page_state, or call ask_user.
- If you find yourself repeating the same action three times with no progress, STOP and call done with success=false explaining why, OR call ask_user.

TASK EXECUTION STRATEGY:
1. Plan First: think in the "thought" field before emitting JSON.
2. For generic queries, navigate to the best search engine or specialised site.
3. Type in search boxes and press Enter to submit, then read results.
4. Extract data with extract_text when you need raw text, or read the interactive elements directly.
5. Report results in done.text.

KEY RULES:
- After typing in a search box, ALWAYS press_key Enter to submit.
- If the page is loading, prefer wait or wait_for_selector over polling.
- If no interactive elements are visible, call refresh_page_state with level="full".
- If a target click/type fails with element_not_found, refresh the page state and pick a different id.
- For login/auth/captcha pages, use ask_user instead of guessing credentials.`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let isDone = false;
  let finalResult = '';
  let lastNavigationId = '';
  let lastUrl = '';
  let lastPageState: BrowserPageState | null = null;
  let cachedObservationKey: CacheKey | null = null;
  let isPostNavigation = true;
  const loopHistory: LoopSignature[] = [];
  const LOOP_WINDOW = 4;
  const LOOP_TRIGGER = 3;

  log('info', `[NativeAgent] Starting task: ${task}`);
  const currentBrowserUrl = await getCurrentBrowserUrl().catch(() => null);

  const resolveStartUrl = (): string => {
    if (options.targetUrl) return options.targetUrl;
    const urlMatch = task.match(/https?:\/\/[^\s，。！？]+/);
    if (urlMatch) return urlMatch[0];
    const domainMatch = task.match(/(?:^|\s)([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s，。！？]*)?)/);
    if (domainMatch) return `https://${domainMatch[1]}`;
    if (currentBrowserUrl && currentBrowserUrl !== 'about:blank') {
      return currentBrowserUrl;
    }
    return 'https://www.google.com';
  };

  const startUrl = resolveStartUrl();
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
      url: lastUrl,
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
      let pageState: BrowserPageState | null = null;
      let observation: ObservationSnapshot | null = null;
      const effectiveLevel = chooseObservationLevel({
        step,
        isPostNavigation,
        lastNavigationId,
        nextNavigationId: lastNavigationId,
        cacheHit: false,
        pageState: lastPageState,
      });
      // Pre-compute the cache key for the previous state if we have one.
      const previousCacheKey = cachedObservationKey;
      const desiredLevel: ObservationLevel = effectiveLevel;

      if (desiredLevel === 'light') {
        const light = await fetchLightObservation(log);
        summary.lightObservations += 1;
        lastUrl = light.url || lastUrl;
        if (light.url) {
          // url changed without us navigating? force an interactive refresh
        }
        observation = {
          pageState: lastPageState,
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
          lastPageState = pageState;
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
              lastPageState = pageState;
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

      // Maintain the observation cache. We always recompute it because the
      // model needs the latest URL/title even on light observations.
      const newKey = computeCacheKey(lastPageState);
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
      stepTiming.url = observation?.pageState?.url ?? lastUrl;
      stepTiming.navigationId = observation?.pageState?.navigation_id ?? lastNavigationId;
      lastNavigationId = stepTiming.navigationId;
      lastUrl = stepTiming.url || lastUrl;

      assertNotAborted(options.signal);

      // ── 2. Build prompt + call LLM ─────────────────────────────────────
      const pageContextBody = observation?.pageState
        ? formatBrowserPageStateForPrompt(observation.pageState)
        : await loadSemanticTree(log);

      const promptText = buildPrompt({
        task,
        currentUrl: stepTiming.url || lastUrl,
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
          stepTiming.totalStepMs = Date.now() - stepStartedAt;
          stepTiming.success = false;
          summary.steps.push(stepTiming);
          options.onStep?.(stepTiming);
          break;
        }
        messages.push({
          role: 'user',
          content: `Your previous response was not valid JSON. ${parsedResult.error ?? ''}\nRespond with a single JSON object that matches the schema.`,
        });
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
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
      loopHistory.push(signature);
      if (loopHistory.length > LOOP_WINDOW) loopHistory.shift();
      const sameLoop = loopHistory.filter((entry) =>
        entriesEqual(entry, signature) &&
        entry.actionName !== 'wait' &&
        entry.actionName !== 'wait_for_selector' &&
        entry.actionName !== 'refresh_page_state',
      ).length;
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
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
        continue;
      }

      // ── 5. Policy gate ─────────────────────────────────────────────────
      const policyContext: BrowserActionPolicyContext = {
        actionName: envelope.actionName,
        payload: envelope.payload,
        pageState: observation?.pageState ?? null,
        url: stepTiming.url || lastUrl,
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
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
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
          stepTiming.totalStepMs = Date.now() - stepStartedAt;
          summary.steps.push(stepTiming);
          options.onStep?.(stepTiming);
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
      lastUrl = stepTiming.url;
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
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
        break;
      }
      if (envelope.actionName === 'ask_user') {
        await removeOverlay();
        finalResult = `Agent needs your input: ${readString(envelope.payload.question, 'I need your help')}`;
        isDone = true;
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
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

      stepTiming.totalStepMs = Date.now() - stepStartedAt;
      summary.steps.push(stepTiming);
      options.onStep?.(stepTiming);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        stepTiming.success = false;
        stepTiming.errorCode = 'aborted';
        stepTiming.totalStepMs = Date.now() - stepStartedAt;
        summary.steps.push(stepTiming);
        options.onStep?.(stepTiming);
        await removeOverlay();
        summary.outcome = 'aborted';
        summary.finishedAt = Date.now();
        summary.totalMs = summary.finishedAt - summary.startedAt;
        options.onRunSummary?.(summary);
        throw error;
      }
      stepTiming.success = false;
      stepTiming.errorCode = 'exception';
      stepTiming.totalStepMs = Date.now() - stepStartedAt;
      summary.steps.push(stepTiming);
      options.onStep?.(stepTiming);
      throw error;
    }
  }

  if (!isDone) {
    await removeOverlay();
    if (summary.steps.length >= maxSteps) {
      summary.outcome = 'max_steps';
    } else if (summary.loopDetections > 0) {
      summary.outcome = 'loop_detected';
    } else if (summary.policyDenials > 0) {
      summary.outcome = 'aborted';
    } else {
      summary.outcome = 'aborted';
    }
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
