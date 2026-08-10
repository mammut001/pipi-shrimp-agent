import type { BrowserAuthState, BrowserInspectionResult, BrowserTaskEnvelope } from '@/types/browser';
import { requiresUserIntervention } from '@/utils/browserInspection';

export type BrowserAgentStartBlockReason =
  | 'auth_required'
  | 'page_not_safe'
  | 'surface_mismatch'
  | 'surface_unknown';

export type BrowserAgentStartGateResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: BrowserAgentStartBlockReason;
      messageKey:
        | 'browser.authRequiredBeforeAgent'
        | 'browserAgent.log.pageNotSafe'
        | 'browser.surfaceMismatchBeforeAgent';
      logKey:
        | 'browserAgent.log.authRequiredBeforeAgent'
        | 'browserAgent.log.pageNotSafe'
        | 'browserAgent.log.surfaceMismatchBeforeAgent'
        | 'browserAgent.log.surfaceCdpUrlUnavailable';
      logParams?: { authState: string };
    };

export function normalizeBrowserSurfaceUrl(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'embedded-surface') {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = '';
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname || '/';
    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    const protocol = url.protocol.toLowerCase();
    return `${protocol}//${hostname}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function browserSurfaceUrlsMatch(
  previewUrl: string | null | undefined,
  cdpUrl: string | null | undefined,
): boolean {
  const normalizedPreview = normalizeBrowserSurfaceUrl(previewUrl);
  const normalizedCdp = normalizeBrowserSurfaceUrl(cdpUrl);
  if (!normalizedPreview || !normalizedCdp) {
    return false;
  }
  return normalizedPreview === normalizedCdp;
}

export function resolvePreviewSurfaceUrl(
  inspection: BrowserInspectionResult | null,
  currentUrl: string,
  pendingTask: BrowserTaskEnvelope | null,
): string | null {
  const candidate = inspection?.url?.trim()
    || currentUrl?.trim()
    || pendingTask?.targetUrl?.trim()
    || '';
  if (!candidate || candidate === 'embedded-surface') {
    return null;
  }
  return candidate;
}

export function evaluateCdpSurfaceMatch(
  previewUrl: string | null | undefined,
  cdpUrl: string | null | undefined,
): BrowserAgentStartGateResult {
  const normalizedPreview = normalizeBrowserSurfaceUrl(previewUrl);
  if (!normalizedPreview) {
    return {
      allowed: false,
      reason: 'surface_unknown',
      messageKey: 'browser.surfaceMismatchBeforeAgent',
      logKey: 'browserAgent.log.surfaceMismatchBeforeAgent',
    };
  }

  const normalizedCdp = normalizeBrowserSurfaceUrl(cdpUrl);
  if (!normalizedCdp) {
    return {
      allowed: false,
      reason: 'surface_unknown',
      messageKey: 'browser.surfaceMismatchBeforeAgent',
      logKey: 'browserAgent.log.surfaceCdpUrlUnavailable',
    };
  }

  if (!browserSurfaceUrlsMatch(previewUrl, cdpUrl)) {
    return {
      allowed: false,
      reason: 'surface_mismatch',
      messageKey: 'browser.surfaceMismatchBeforeAgent',
      logKey: 'browserAgent.log.surfaceMismatchBeforeAgent',
    };
  }

  return { allowed: true };
}

export async function evaluateCdpSurfaceMatchGate(
  previewUrl: string | null | undefined,
  readCdpUrl: () => Promise<string>,
): Promise<BrowserAgentStartGateResult> {
  try {
    const cdpUrl = await readCdpUrl();
    return evaluateCdpSurfaceMatch(previewUrl, cdpUrl);
  } catch {
    return {
      allowed: false,
      reason: 'surface_unknown',
      messageKey: 'browser.surfaceMismatchBeforeAgent',
      logKey: 'browserAgent.log.surfaceCdpUrlUnavailable',
    };
  }
}

export function evaluateBrowserAgentStartGate(
  authState: BrowserAuthState,
  inspection: BrowserInspectionResult | null,
): BrowserAgentStartGateResult {
  if (requiresUserIntervention(authState)) {
    return {
      allowed: false,
      reason: 'auth_required',
      messageKey: 'browser.authRequiredBeforeAgent',
      logKey: 'browserAgent.log.authRequiredBeforeAgent',
      logParams: { authState },
    };
  }

  if (inspection && !inspection.safeForAgent && authState !== 'unknown') {
    return {
      allowed: false,
      reason: 'page_not_safe',
      messageKey: 'browserAgent.log.pageNotSafe',
      logKey: 'browserAgent.log.pageNotSafe',
    };
  }

  return { allowed: true };
}