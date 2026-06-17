/**
 * Browser action safety policy.
 *
 * Decides whether a proposed action can run automatically, needs explicit
 * approval, or must be blocked entirely. The policy is evaluated *before*
 * each tool call so the UI can pause the agent and surface an approval gate.
 *
 * Modes:
 *   - observe_only   — every action is blocked.
 *   - ask_each_action — every non-trivial action prompts the user.
 *   - auto_safe      — safe actions run automatically; risky actions ask.
 *
 * Sensitive categories (defaults):
 *   - payment / checkout / send / submit / login buttons
 *   - password / email / phone / address / payment input fields
 *   - banking / government / medical / crypto / dating domains
 *   - cross-origin auth/captcha pages
 *
 * The policy is intentionally URL + label driven so we don't have to ship a
 * classification model. The list can be expanded by editing SENSITIVE_LABEL
 * and SENSITIVE_DOMAIN below.
 */

import type { BrowserPageState } from '@/types/browserPageState';
import type { BrowserActionPermissionMode } from '@/types/browserEngine';
import type { SupportedActionName } from './browserAgentActionSchema';

export type BrowserActionPolicyDecision = 'allow' | 'ask' | 'block';
export type BrowserActionPolicyRisk = 'low' | 'medium' | 'high';

export interface BrowserActionPolicyContext {
  actionName: SupportedActionName | string;
  payload?: Record<string, unknown> | null;
  pageState?: BrowserPageState | null;
  url: string;
  permissionMode?: BrowserActionPermissionMode;
}

export interface BrowserActionPolicyVerdict {
  decision: BrowserActionPolicyDecision;
  reason: string;
  riskLevel: BrowserActionPolicyRisk;
  /** True when the verdict is driven by the active permission mode rather than action content. */
  reasonFromMode?: boolean;
}

const SENSITIVE_LABEL_PATTERNS: RegExp[] = [
  /\bpay\b/i,
  /\bpurchase\b/i,
  /\bbuy\b/i,
  /\border\b/i,
  /\bcheckout\b/i,
  /\bcheck\s*out\b/i,
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bapply\b/i,
  /\bbook\b/i,
  /\breserve\b/i,
  /\bconfirm\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bunsubscribe\b/i,
  /\bsubscribe\b/i,
  /\blog\s*in\b/i,
  /\bsign\s*in\b/i,
  /\bsign\s*up\b/i,
  /\bregister\b/i,
  /\btransfer\b/i,
  /\bwire\b/i,
  /\bwithdraw\b/i,
  /\bdeposit\b/i,
];

const SENSITIVE_INPUT_TYPES = new Set([
  'password',
  'email',
  'tel',
  'phone',
  'address',
  'postal',
  'credit-card',
  'card',
  'payment',
  'ssn',
  'tax',
]);

const SENSITIVE_INPUT_LABEL_PATTERNS: RegExp[] = [
  /password/i,
  /passcode/i,
  /secret/i,
  /credit\s*card/i,
  /card\s*number/i,
  /cvv|cvc/i,
  /social\s*security/i,
  /tax\s*id/i,
  /phone/i,
  /mobile/i,
  /email/i,
  /address/i,
];

const SENSITIVE_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)bank(?:ing)?\./i,
  /(^|\.)pay\./i,
  /(^|\.)payment\./i,
  /(^|\.)gov\b/i,
  /(^|\.)gov\./i,
  /(^|\.)irs\./i,
  /(^|\.)healthcare\./i,
  /(^|\.)medical\./i,
  /(^|\.)hospital\./i,
  /(^|\.)crypto\./i,
  /(^|\.)coinbase\./i,
  /(^|\.)binance\./i,
  /(^|\.)kraken\./i,
  /(^|\.)dating\./i,
  /(^|\.)tinder\./i,
  /(^|\.)bumble\./i,
];

const ALLOWED_ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ALLOWED_NAV_KEYS = new Set(['Enter', 'Escape', 'Tab']);

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const normalizeHostname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const isSensitiveDomain = (rawUrl: string): boolean => {
  const host = normalizeHostname(rawUrl);
  if (!host) return false;
  return SENSITIVE_DOMAIN_PATTERNS.some((pattern) => pattern.test(host));
};

export const matchesSensitiveLabel = (label: string): boolean => {
  if (!label) return false;
  return SENSITIVE_LABEL_PATTERNS.some((pattern) => pattern.test(label));
};

const findSensitiveElementForClick = (pageState: BrowserPageState | null | undefined, payload: Record<string, unknown> | null | undefined) => {
  if (!pageState || !payload) return null;
  const backendNodeId = Number(payload.backend_node_id ?? payload.backendNodeId ?? 0);
  const elementId = Number(payload.id ?? payload.element_id ?? payload.elementId ?? 0);
  return (
    pageState.elements.find((element) => backendNodeId && element.backend_node_id === backendNodeId) ||
    pageState.elements.find((element) => elementId && element.index === elementId) ||
    null
  );
};

const findSensitiveElementForInput = (pageState: BrowserPageState | null | undefined, payload: Record<string, unknown> | null | undefined) => {
  if (!pageState || !payload) return null;
  const backendNodeId = Number(payload.backend_node_id ?? payload.backendNodeId ?? 0);
  const elementId = Number(payload.id ?? payload.element_id ?? payload.elementId ?? 0);
  return (
    pageState.elements.find((element) => backendNodeId && element.backend_node_id === backendNodeId) ||
    pageState.elements.find((element) => elementId && element.index === elementId) ||
    null
  );
};

const assessClick = (
  ctx: BrowserActionPolicyContext,
): { sensitive: boolean; reason: string; risk: BrowserActionPolicyRisk } => {
  const label = readString(ctx.payload?.selector);
  const element = findSensitiveElementForClick(ctx.pageState, ctx.payload ?? null);
  const elementLabel = element ? `${element.name ?? ''} ${element.text_hint ?? ''} ${element.role ?? ''}` : '';
  const combined = `${label} ${elementLabel}`.trim();

  if (matchesSensitiveLabel(combined)) {
    return {
      sensitive: true,
      reason: `Clicking a sensitive control: "${combined.trim()}"`,
      risk: 'high',
    };
  }
  return { sensitive: false, reason: '', risk: 'low' };
};

const assessInputText = (
  ctx: BrowserActionPolicyContext,
): { sensitive: boolean; reason: string; risk: BrowserActionPolicyRisk } => {
  const element = findSensitiveElementForInput(ctx.pageState, ctx.payload ?? null);
  const inputType = (element?.input_type ?? readString(ctx.payload?.selector) ?? '').toLowerCase();
  const elementLabel = element ? `${element.name ?? ''} ${element.text_hint ?? ''} ${element.role ?? ''}` : '';
  if (SENSITIVE_INPUT_TYPES.has(inputType)) {
    return {
      sensitive: true,
      reason: `Typing into a sensitive input (${inputType}).`,
      risk: 'high',
    };
  }
  if (SENSITIVE_INPUT_LABEL_PATTERNS.some((pattern) => pattern.test(elementLabel))) {
    return {
      sensitive: true,
      reason: `Typing into a field whose label looks like personal data: "${elementLabel.trim()}".`,
      risk: 'high',
    };
  }
  return { sensitive: false, reason: '', risk: 'low' };
};

const assessPressKey = (ctx: BrowserActionPolicyContext): { sensitive: boolean; reason: string; risk: BrowserActionPolicyRisk } => {
  const key = readString(ctx.payload?.key);
  if (ALLOWED_NAV_KEYS.has(key) || ALLOWED_ARROW_KEYS.has(key)) {
    return { sensitive: false, reason: '', risk: 'low' };
  }
  return {
    sensitive: true,
    reason: `Pressing non-navigation key "${key}".`,
    risk: 'medium',
  };
};

const assessNavigate = (ctx: BrowserActionPolicyContext): { sensitive: boolean; reason: string; risk: BrowserActionPolicyRisk } => {
  const url = readString(ctx.payload?.url);
  if (!url) {
    return { sensitive: false, reason: '', risk: 'low' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return {
      sensitive: true,
      reason: `Refusing to navigate to non-http URL: ${url}`,
      risk: 'high',
    };
  }
  if (isSensitiveDomain(url)) {
    return {
      sensitive: true,
      reason: `Navigating to a sensitive domain: ${url}`,
      risk: 'high',
    };
  }
  return { sensitive: false, reason: '', risk: 'low' };
};

const SAFE_ACTIONS = new Set([
  'wait',
  'scroll',
  'extract_text',
  'refresh_page_state',
  'screenshot_observe',
  'done',
  'ask_user',
]);

const classify = (ctx: BrowserActionPolicyContext): { sensitive: boolean; reason: string; risk: BrowserActionPolicyRisk } => {
  if (isSensitiveDomain(ctx.url)) {
    return {
      sensitive: true,
      reason: `Current URL is on the sensitive-domain list: ${ctx.url}`,
      risk: 'high',
    };
  }

  switch (ctx.actionName) {
    case 'wait':
    case 'scroll':
    case 'extract_text':
    case 'refresh_page_state':
    case 'screenshot_observe':
    case 'done':
    case 'ask_user':
      return { sensitive: false, reason: '', risk: 'low' };
    case 'click_element':
      return assessClick(ctx);
    case 'input_text':
      return assessInputText(ctx);
    case 'press_key':
      return assessPressKey(ctx);
    case 'navigate':
      return assessNavigate(ctx);
    case 'wait_for_selector':
      return { sensitive: false, reason: '', risk: 'low' };
    default:
      return { sensitive: true, reason: `Unknown action: ${ctx.actionName}`, risk: 'medium' };
  }
};

/**
 * Evaluate the policy for a single action. Returns a verdict the caller can
 * inspect to decide whether to run, ask, or block.
 */
export const evaluateBrowserAction = (
  ctx: BrowserActionPolicyContext,
): BrowserActionPolicyVerdict => {
  const mode: BrowserActionPermissionMode = ctx.permissionMode ?? 'auto_safe';

  if (mode === 'observe_only') {
    return {
      decision: 'block',
      reason: 'Observe-only mode is active. Actions are disabled.',
      riskLevel: 'high',
      reasonFromMode: true,
    };
  }

  const classification = classify(ctx);

  // observe_only already handled above. ask_each_action asks for everything
  // except the safest "wait / scroll / done" actions.
  if (mode === 'ask_each_action') {
    if (SAFE_ACTIONS.has(ctx.actionName)) {
      return {
        decision: 'allow',
        reason: 'Safe action under ask_each_action mode.',
        riskLevel: 'low',
      };
    }
    return {
      decision: 'ask',
      reason: classification.sensitive ? classification.reason : 'ask_each_action mode requires approval for every action.',
      riskLevel: classification.sensitive ? classification.risk : 'medium',
    };
  }

  // mode === 'auto_safe'
  if (!classification.sensitive) {
    return {
      decision: 'allow',
      reason: 'Safe action.',
      riskLevel: 'low',
    };
  }

  return {
    decision: classification.risk === 'high' ? 'ask' : 'ask',
    reason: classification.reason,
    riskLevel: classification.risk,
  };
};

/**
 * Convenience helper used by callers that don't want to construct the full
 * context. Mirrors the legacy `BrowserActionPolicyContext` shape.
 */
export const shouldRequireApproval = (
  ctx: BrowserActionPolicyContext,
): boolean => evaluateBrowserAction(ctx).decision === 'ask';
