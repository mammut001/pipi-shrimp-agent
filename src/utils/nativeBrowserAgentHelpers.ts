import {
  getBrowserLightObservation,
  getBrowserSemanticTree,
} from './browserPageStateClient';
import { resyncBrowserPage } from './browserSessionClient';
import type { BrowserPageState } from '../types/browserPageState';
import type { ObservationLevel } from '../types/browserEngine';
import type {
  ParsedActionEnvelope,
  SupportedActionName,
} from './browserAgentActionSchema';

// ─── Agent logging ─────────────────────────────────────────────────────────

type AgentLogLevel = 'info' | 'success' | 'error' | 'warning';
export type AgentLogger = (level: AgentLogLevel, message: string) => void;

const PAGE_REFERENCE_ERROR_MARKERS = ['receiver is gone', 'send failed', 'No page'];

export const delay = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
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

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Native browser task aborted', 'AbortError');
  }
}

export const isPageReferenceError = (error: unknown): boolean => {
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

export const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
};

// ─── Observation gathering ─────────────────────────────────────────────────

export interface ObservationSnapshot {
  pageState: BrowserPageState | null;
  /** Effective observation level that produced this snapshot. */
  level: ObservationLevel;
  /** Wall time spent in observation (ms). */
  durationMs: number;
  /** True when the snapshot reused a cached PageState. */
  cached: boolean;
}

export interface CacheKey {
  url: string;
  navigationId: string;
  viewportBucket: string;
  elementFingerprint: string;
}

export const computeCacheKey = (pageState: BrowserPageState | null): CacheKey | null => {
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
export async function fetchLightObservation(log: AgentLogger): Promise<{
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
export function chooseObservationLevel(args: {
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

// ─── Loop detection ────────────────────────────────────────────────────────

export interface LoopSignature {
  url: string;
  navigationId: string;
  actionName: SupportedActionName;
  /** backend_node_id when applicable, else action target identifier. */
  target: string;
}

export const signatureFor = (
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

export function buildPrompt(args: PromptArgs): string {
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

export function shouldPostWait(actionName: SupportedActionName): number {
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

export function entriesEqual(a: LoopSignature, b: LoopSignature): boolean {
  return (
    a.actionName === b.actionName &&
    a.target === b.target &&
    a.url === b.url &&
    a.navigationId === b.navigationId
  );
}

export function cacheKeyEqual(a: CacheKey, b: CacheKey): boolean {
  return (
    a.url === b.url &&
    a.navigationId === b.navigationId &&
    a.viewportBucket === b.viewportBucket &&
    a.elementFingerprint === b.elementFingerprint
  );
}

export async function loadSemanticTree(log: AgentLogger): Promise<string> {
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

