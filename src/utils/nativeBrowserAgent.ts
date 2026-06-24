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

import {
  clickBrowserElement,
  executeBrowserScript,
  pressBrowserKey,
  scrollBrowser,
  typeIntoBrowserElement,
  waitForBrowser,
} from './browserActionClient';
import {
  getBrowserLightObservation,
  getBrowserPageState,
  getBrowserSemanticTree,
  getBrowserText,
  getCurrentBrowserUrl,
} from './browserPageStateClient';
import {
  describeBrowserActionTarget,
  formatBrowserPageStateForPrompt,
  resolveBrowserActionTarget,
} from './browserPageStateModel';
import { connectBrowserSession, navigateBrowserPage, resyncBrowserPage } from './browserSessionClient';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled, getBrowserMaxAgentSteps } from './browserFeatureFlags';
import type { BrowserPageState } from '@/types/browserPageState';
import type { ObservationLevel } from '@/types/browserEngine';
import {
  parseBrowserActionEnvelopeWithRetry,
  type ParsedActionEnvelope,
  type SupportedActionName,
} from './browserAgentActionSchema';
import {
  evaluateBrowserAction,
  type BrowserActionPolicyContext,
  type BrowserActionPolicyVerdict,
} from './browserActionPolicy';

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

// ─── Agent logging ─────────────────────────────────────────────────────────

type AgentLogLevel = 'info' | 'success' | 'error' | 'warning';
type AgentLogger = (level: AgentLogLevel, message: string) => void;

const PAGE_REFERENCE_ERROR_MARKERS = ['receiver is gone', 'send failed', 'No page'];

const delay = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Native browser task aborted', 'AbortError'));
    return;
  }

  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);

  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException('Native browser task aborted', 'AbortError'));
  };

  signal?.addEventListener('abort', onAbort, { once: true });
});

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Native browser task aborted', 'AbortError');
  }
}

const isPageReferenceError = (error: unknown): boolean => {
  const message = String(error);
  return PAGE_REFERENCE_ERROR_MARKERS.some((marker) => message.includes(marker));
};

const readNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
};

// ─── Observation gathering ─────────────────────────────────────────────────

interface ObservationSnapshot {
  pageState: BrowserPageState | null;
  /** Effective observation level that produced this snapshot. */
  level: ObservationLevel;
  /** Wall time spent in observation (ms). */
  durationMs: number;
  /** True when the snapshot reused a cached PageState. */
  cached: boolean;
}

interface CacheKey {
  url: string;
  navigationId: string;
  viewportBucket: string;
  elementFingerprint: string;
}

const computeCacheKey = (pageState: BrowserPageState | null): CacheKey | null => {
  if (!pageState) {
    return null;
  }
  const viewport = pageState.viewport;
  const viewportBucket = viewport
    ? `${Math.round(viewport.width / 100)}x${Math.round(viewport.height / 100)}@${Math.round(viewport.page_x)},${Math.round(viewport.page_y)}`
    : 'none';
  const fingerprintSource = pageState.elements
    .slice(0, 32)
    .map((element) => `${element.backend_node_id}:${element.is_visible ? 1 : 0}:${element.is_clickable ? 1 : 0}:${element.is_editable ? 1 : 0}`)
    .join('|');
  return {
    url: pageState.url,
    navigationId: pageState.navigation_id,
    viewportBucket,
    elementFingerprint: fingerprintSource,
  };
};

/**
 * Lightweight PageState used by ObservationLevel.light. Calls the dedicated
 * Rust `get_page_observation_light` command which runs a single JS expression
 * via CDP — dramatically cheaper than a full DOMSnapshot + AX tree capture.
 */
async function fetchLightObservation(log: AgentLogger): Promise<{
  url: string;
  title: string;
  readyState: string;
  textExcerpt: string;
  activeElement: string;
  navigationId: string;
}> {
  try {
    const obs = await getBrowserLightObservation();
    return {
      url: obs.url,
      title: obs.title,
      readyState: obs.ready_state,
      textExcerpt: obs.text_excerpt,
      activeElement: obs.active_element,
      navigationId: obs.navigation_id,
    };
  } catch (error) {
    log('warning', `[NativeAgent] Light observation failed: ${error}`);
    return {
      url: '',
      title: '',
      readyState: 'unknown',
      textExcerpt: '',
      activeElement: '',
      navigationId: '',
    };
  }
}

/**
 * Decide the observation level for the upcoming step based on history.
 * The first step after navigation/click needs interactive or full; subsequent
 * steps with the same navigation_id and same target can reuse a cached
 * light observation.
 */
function chooseObservationLevel(args: {
  step: number;
  isPostNavigation: boolean;
  lastNavigationId: string;
  nextNavigationId: string;
  actionName?: SupportedActionName;
  cacheHit: boolean;
  pageState?: BrowserPageState | null;
}): ObservationLevel {
  const {
    step,
    isPostNavigation,
    lastNavigationId,
    nextNavigationId,
    actionName,
    cacheHit,
    pageState,
  } = args;
  // Step 0 always starts with interactive so we can find things to click.
  if (step === 0 || isPostNavigation || lastNavigationId !== nextNavigationId) {
    return pageState && pageState.elements.length > 0 ? 'interactive' : 'full';
  }
  // After click/press we usually settle within ~500-800ms; light is enough.
  if (actionName === 'click_element' || actionName === 'press_key' || actionName === 'navigate') {
    return cacheHit ? 'light' : 'interactive';
  }
  // Scroll benefits from interactive so visible elements are still known.
  if (actionName === 'scroll') {
    return 'interactive';
  }
  // Type is small but can change the active element; interactive keeps the model grounded.
  if (actionName === 'input_text') {
    return 'interactive';
  }
  if (actionName === 'wait') {
    return 'light';
  }
  return 'light';
}

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

// ─── Loop detection ────────────────────────────────────────────────────────

interface LoopSignature {
  url: string;
  navigationId: string;
  actionName: SupportedActionName;
  /** backend_node_id when applicable, else action target identifier. */
  target: string;
}

const signatureFor = (
  url: string,
  navigationId: string,
  envelope: ParsedActionEnvelope | null,
): LoopSignature => {
  if (!envelope) {
    return { url, navigationId, actionName: 'wait', target: 'noop' };
  }
  const { actionName, payload } = envelope;
  let target = 'none';
  if (actionName === 'click_element' || actionName === 'input_text') {
    const id = readNumber(payload.id ?? payload.element_id ?? payload.backend_node_id ?? payload.backendNodeId, 0);
    target = id > 0 ? `bn:${id}` : readString(payload.selector, 'unknown');
  } else if (actionName === 'navigate') {
    target = readString(payload.url, '');
  } else if (actionName === 'press_key') {
    target = readString(payload.key, '');
  } else if (actionName === 'scroll') {
    target = `${readString(payload.direction, '')}:${readNumber(payload.pixels, 0)}`;
  } else if (actionName === 'wait_for_selector') {
    target = readString(payload.selector, '');
  }
  return { url, navigationId, actionName, target };
};

// ─── Action post-execution feedback ────────────────────────────────────────

interface ActionFeedback {
  success: boolean;
  actionName: string;
  targetLabel: string;
  url: string;
  navigationId: string;
  elementCount: number;
  errorCode?: string;
  errorMessage?: string;
}

const buildActionFeedback = (input: {
  actionName: string;
  success: boolean;
  targetLabel?: string;
  url: string;
  navigationId: string;
  elementCount: number;
  errorCode?: string;
  errorMessage?: string;
}): ActionFeedback => ({
  success: input.success,
  actionName: input.actionName,
  targetLabel: input.targetLabel ?? '',
  url: input.url,
  navigationId: input.navigationId,
  elementCount: input.elementCount,
  errorCode: input.errorCode,
  errorMessage: input.errorMessage,
});

const renderActionFeedback = (feedback: ActionFeedback): string => {
  const lines = [
    `Action result: ${feedback.success ? 'OK' : 'FAILED'}`,
    `- action: ${feedback.actionName}`,
    `- target: ${feedback.targetLabel || '(none)'}`,
    `- url: ${feedback.url}`,
    `- navigation_id: ${feedback.navigationId}`,
    `- visible_element_count: ${feedback.elementCount}`,
  ];
  if (!feedback.success) {
    lines.push(`- error_code: ${feedback.errorCode ?? 'unknown'}`);
    if (feedback.errorMessage) {
      lines.push(`- error_message: ${feedback.errorMessage}`);
    }
  }
  return lines.join('\n');
};

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

  const resolveStartUrl = (): string => {
    if (options.targetUrl) return options.targetUrl;
    const urlMatch = task.match(/https?:\/\/[^\s，。！？]+/);
    if (urlMatch) return urlMatch[0];
    const domainMatch = task.match(/(?:^|\s)([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s，。！？]*)?)/);
    if (domainMatch) return `https://${domainMatch[1]}`;
    return 'https://www.google.com';
  };

  log('info', `[NativeAgent] Starting task: ${task}`);
  const startUrl = resolveStartUrl();
  log('info', `[NativeAgent] Navigating to: ${startUrl}`);
  try {
    await navigateBrowserPage(startUrl);
    log('success', `[NativeAgent] Page loaded: ${startUrl}`);
  } catch (e) {
    log('warning', `[NativeAgent] Navigation attempted: ${e}`);
  }
  await delay(1200, options.signal);
  await injectOverlay();

  try {
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
      const feedback = await executeEnvelope({
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

// ─── Helpers ───────────────────────────────────────────────────────────────

interface PromptArgs {
  task: string;
  currentUrl: string;
  step: number;
  maxSteps: number;
  pageContextBody: string;
  observationLevel: ObservationLevel;
  elementsCount: number;
}

function buildPrompt(args: PromptArgs): string {
  const { task, currentUrl, step, maxSteps, pageContextBody, observationLevel, elementsCount } = args;
  return [
    `TASK: ${task}`,
    '',
    `CURRENT URL: ${currentUrl || '(unknown)'}`,
    `OBSERVATION LEVEL: ${observationLevel} (interactive_elements≈${elementsCount})`,
    `STEP: ${step + 1}/${maxSteps}`,
    '',
    pageContextBody,
    '',
    'Decide your next action. Respond with JSON only (fenced ```json is OK).',
  ].join('\n');
}

function shouldPostWait(actionName: SupportedActionName): number {
  switch (actionName) {
    case 'click_element':
      return 600;
    case 'press_key':
      return 400;
    case 'navigate':
      return 800;
    case 'scroll':
      return 300;
    case 'input_text':
      return 250;
    default:
      return 0;
  }
}

function entriesEqual(a: LoopSignature, b: LoopSignature): boolean {
  return (
    a.actionName === b.actionName &&
    a.target === b.target &&
    a.url === b.url &&
    a.navigationId === b.navigationId
  );
}

function cacheKeyEqual(a: CacheKey, b: CacheKey): boolean {
  return (
    a.url === b.url &&
    a.navigationId === b.navigationId &&
    a.viewportBucket === b.viewportBucket &&
    a.elementFingerprint === b.elementFingerprint
  );
}

async function loadSemanticTree(log: AgentLogger): Promise<string> {
  try {
    return await getBrowserSemanticTree();
  } catch (error) {
    log('warning', `[NativeAgent] Tree fetch failed: ${error}`);
    if (!isPageReferenceError(error)) {
      return '[]';
    }
    log('info', '[NativeAgent] Re-syncing page reference...');
    try {
      await resyncBrowserPage();
      return await getBrowserSemanticTree();
    } catch (resyncError) {
      log('warning', `[NativeAgent] Re-sync failed: ${resyncError}`);
      return '[]';
    }
  }
}

async function executeEnvelope(args: {
  envelope: ParsedActionEnvelope;
  pageState: BrowserPageState | null;
  log: AgentLogger;
}): Promise<ActionFeedback> {
  const { envelope, pageState, log } = args;
  const { actionName, payload } = envelope;
  const base = {
    url: pageState?.url ?? '',
    navigationId: pageState?.navigation_id ?? '',
    actionName,
  };
  try {
    switch (actionName) {
      case 'wait': {
        const ms = readNumber(payload.milliseconds, 0) || Math.min(readNumber(payload.seconds, 3) * 1000, 10_000);
        log('info', `[NativeAgent] Waiting ${ms}ms`);
        await waitForBrowser({ seconds: ms / 1000 });
        return { ...base, success: true, targetLabel: `${ms}ms`, elementCount: pageState?.elements.length ?? 0 };
      }
      case 'wait_for_selector': {
        const selector = readString(payload.selector);
        log('info', `[NativeAgent] Waiting for: ${selector}`);
        try {
          await waitForBrowser({ selector });
          return { ...base, success: true, targetLabel: selector, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: selector,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'selector_timeout',
            errorMessage: String(error),
          };
        }
      }
      case 'click_element': {
        const target = resolveBrowserActionTarget(pageState, payload);
        if (!target) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'click payload missing id/backend_node_id',
          };
        }
        const targetLabel = describeBrowserActionTarget(target);
        log('info', `[NativeAgent] Clicking ${targetLabel}`);
        try {
          const result = await clickBrowserElement(target);
          return { ...base, success: true, targetLabel, elementCount: pageState?.elements.length ?? 0, errorMessage: result };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'click_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'input_text': {
        const target = resolveBrowserActionTarget(pageState, payload);
        const text = readString(payload.text);
        if (!target || !text) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'input_text payload missing target or text',
          };
        }
        const targetLabel = describeBrowserActionTarget(target);
        log('info', `[NativeAgent] Typing: "${text.slice(0, 80)}" into ${targetLabel}`);
        try {
          const result = await typeIntoBrowserElement(target, text);
          if (payload.press_enter === true) {
            await pressBrowserKey('Enter');
          }
          return { ...base, success: true, targetLabel, elementCount: pageState?.elements.length ?? 0, errorMessage: result };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'type_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'press_key': {
        const key = readString(payload.key, 'Enter');
        log('info', `[NativeAgent] Pressing key: ${key}`);
        try {
          await pressBrowserKey(key);
          return { ...base, success: true, targetLabel: key, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: key,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'key_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'scroll': {
        const direction = readString(payload.direction, 'down');
        const pixels = readNumber(payload.pixels, 600);
        log('info', `[NativeAgent] Scrolling ${direction} ${pixels}px`);
        try {
          await scrollBrowser(direction, pixels);
          return { ...base, success: true, targetLabel: `${direction} ${pixels}px`, elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: `${direction} ${pixels}px`,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'scroll_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'navigate': {
        const url = readString(payload.url);
        if (!url) {
          return {
            ...base,
            success: false,
            targetLabel: '',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'invalid_input',
            errorMessage: 'navigate payload missing url',
          };
        }
        log('info', `[NativeAgent] Navigating to: ${url}`);
        try {
          await navigateBrowserPage(url);
          return {
            ...base,
            success: true,
            targetLabel: url,
            elementCount: pageState?.elements.length ?? 0,
            url,
          };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: url,
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'navigation_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'extract_text': {
        const maxLength = readNumber(payload.max_length, 3000);
        log('info', '[NativeAgent] Extracting page text');
        try {
          const pageText = await getBrowserText(maxLength);
          return {
            ...base,
            success: true,
            targetLabel: `${pageText.length} chars`,
            elementCount: pageState?.elements.length ?? 0,
            errorMessage: pageText,
          };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'extract_text',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'extract_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'refresh_page_state': {
        log('info', '[NativeAgent] Refreshing page state');
        try {
          await getBrowserPageState();
          return { ...base, success: true, targetLabel: 'refresh_page_state', elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'refresh_page_state',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'refresh_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'screenshot_observe': {
        log('info', '[NativeAgent] Capturing observation screenshot');
        try {
          await invoke<string>('browser_screenshot');
          return { ...base, success: true, targetLabel: 'screenshot_observe', elementCount: pageState?.elements.length ?? 0 };
        } catch (error) {
          return {
            ...base,
            success: false,
            targetLabel: 'screenshot_observe',
            elementCount: pageState?.elements.length ?? 0,
            errorCode: 'screenshot_failed',
            errorMessage: String(error),
          };
        }
      }
      case 'done':
      case 'ask_user': {
        // Handled at the loop level.
        return { ...base, success: true, targetLabel: actionName, elementCount: pageState?.elements.length ?? 0 };
      }
      default: {
        return {
          ...base,
          success: false,
          targetLabel: actionName,
          elementCount: pageState?.elements.length ?? 0,
          errorCode: 'unknown_action',
          errorMessage: `Unknown action ${actionName}`,
        };
      }
    }
  } catch (error) {
    return {
      ...base,
      success: false,
      targetLabel: actionName,
      elementCount: pageState?.elements.length ?? 0,
      errorCode: 'exception',
      errorMessage: String(error),
    };
  }
}
