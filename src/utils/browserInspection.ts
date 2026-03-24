/**
 * Browser Inspection - Parse raw inspection data into structured results
 *
 * Interprets raw page info from backend and produces BrowserInspectionResult
 */

import type {
  RawBrowserInspection,
  BrowserInspectionResult,
  BrowserAuthState,
  BrowserBlockReason,
} from '../types/browser';
import {
  detectLoginRequired,
  detectCaptchaRequired,
  detectMfaRequired,
  detectAuthenticated,
  matchProfileByUrl,
  getProfileById,
} from './browserProfiles';

/**
 * Map auth state to block reason
 */
function getBlockReason(authState: BrowserAuthState): BrowserBlockReason | undefined {
  switch (authState) {
    case 'auth_required':
      return 'login_required';
    case 'captcha_required':
      return 'captcha_required';
    case 'mfa_required':
      return 'mfa_required';
    case 'unauthenticated':
      return 'unknown';
    default:
      return undefined;
  }
}

/**
 * Determine if page is safe for agent automation
 */
function isSafeForAgent(
  authState: BrowserAuthState,
  blockReason?: BrowserBlockReason
): boolean {
  // Safe states
  const safeStates: BrowserAuthState[] = ['authenticated', 'unknown'];
  if (safeStates.includes(authState) && !blockReason) {
    return true;
  }

  return false;
}

/**
 * Extract matched signals from inspection data
 */
function extractMatchedSignals(
  raw: RawBrowserInspection,
  profile: { loginDetectors: string[]; postLoginDetectors: string[]; blockDetectors: string[] }
): string[] {
  const signals: string[] = [];

  // Check login detectors
  for (const detector of profile.loginDetectors) {
    if (detector.startsWith('text:')) {
      const text = detector.slice(5).toLowerCase();
      if (raw.text_markers.some(m => m.toLowerCase().includes(text))) {
        signals.push(`login_detector:${text}`);
      }
    } else if (raw.dom_markers.some(m => m.toLowerCase().includes(detector.toLowerCase()))) {
      signals.push(`login_dom:${detector}`);
    }
  }

  // Check post-login detectors
  for (const detector of profile.postLoginDetectors) {
    if (detector.startsWith('text:')) {
      const text = detector.slice(5).toLowerCase();
      if (raw.text_markers.some(m => m.toLowerCase().includes(text))) {
        signals.push(`postlogin_detector:${text}`);
      }
    } else if (raw.dom_markers.some(m => m.toLowerCase().includes(detector.toLowerCase()))) {
      signals.push(`postlogin_dom:${detector}`);
    }
  }

  // Check block detectors
  for (const detector of profile.blockDetectors) {
    if (detector.startsWith('text:')) {
      const text = detector.slice(5).toLowerCase();
      if (raw.text_markers.some(m => m.toLowerCase().includes(text))) {
        signals.push(`block_detector:${text}`);
      }
    } else if (raw.dom_markers.some(m => m.toLowerCase().includes(detector.toLowerCase()))) {
      signals.push(`block_dom:${detector}`);
    }
  }

  return signals;
}

/**
 * Parse raw inspection data into structured result
 * If existingProfileId is provided, preserve it unless the URL explicitly
 * indicates a different domain (e.g., auth redirects to different domain)
 */
export function parseInspectionResult(
  raw: RawBrowserInspection,
  existingProfileId?: string
): BrowserInspectionResult {
  // Get profile - use existing if provided, otherwise match by URL
  let profile;
  if (existingProfileId) {
    // Check if URL indicates we should switch profiles
    // Only switch if we're on a completely different domain
    const newProfile = matchProfileByUrl(raw.url);

    // If the new profile is generic but we have an existing specific profile, keep existing
    if (newProfile.id === 'generic_authenticated_site' && existingProfileId !== 'generic_authenticated_site') {
      profile = getProfileById(existingProfileId);
    } else if (newProfile.id === existingProfileId) {
      // Same profile, use it
      profile = newProfile;
    } else {
      // Different specific profile - could be auth redirect
      // Keep existing profile for known auth flows
      const existingProfile = getProfileById(existingProfileId);
      const authDomains = ['appleid.apple.com', 'accounts.google.com', 'login.live.com', 'auth0.com'];
      const isAuthRedirect = authDomains.some(domain => raw.url.includes(domain));

      if (isAuthRedirect) {
        // Auth redirect - preserve existing profile
        profile = existingProfile;
      } else {
        // Real profile change - use new profile
        profile = newProfile;
      }
    }
  } else {
    profile = matchProfileByUrl(raw.url);
  }

  const matchedSignals = extractMatchedSignals(raw, profile);

  // Determine auth state
  let authState: BrowserAuthState = 'unknown';

  // Check for captcha first (highest priority)
  if (raw.has_captcha || detectCaptchaRequired(raw.text_markers, raw.dom_markers)) {
    authState = 'captcha_required';
  }
  // Check for MFA
  else if (detectMfaRequired(raw.text_markers)) {
    authState = 'mfa_required';
  }
  // Check for login form
  else if (raw.has_password_input || raw.has_login_form || detectLoginRequired(raw.text_markers, raw.dom_markers)) {
    // Check if also has post-login markers (might be on settings page requiring re-auth)
    if (detectAuthenticated(raw.text_markers, raw.dom_markers)) {
      authState = 'authenticated';
    } else {
      authState = 'auth_required';
    }
  }
  // Check for QR auth (like WhatsApp)
  else if (raw.has_qr_auth) {
    authState = 'auth_required';
  }
  // Check for post-login markers
  else if (detectAuthenticated(raw.text_markers, raw.dom_markers)) {
    authState = 'authenticated';
  }

  const blockReason = getBlockReason(authState);
  const safeForAgent = isSafeForAgent(authState, blockReason);

  return {
    url: raw.url,
    title: raw.title,
    authState,
    blockReason,
    matchedProfileId: profile.id,
    matchedSignals,
    safeForAgent,
  };
}

/**
 * Get human-readable auth state text
 */
export function getAuthStateText(authState: BrowserAuthState): string {
  switch (authState) {
    case 'authenticated':
      return '已登录';
    case 'auth_required':
      return '需要登录';
    case 'mfa_required':
      return '需要二次验证';
    case 'captcha_required':
      return '需要验证码';
    case 'expired':
      return '会话已过期';
    case 'unauthenticated':
      return '未登录';
    case 'unknown':
      return '未知';
    default:
      return '未知';
  }
}

/**
 * Get human-readable block reason text
 */
export function getBlockReasonText(reason: BrowserBlockReason | undefined): string {
  if (!reason) return '';

  switch (reason) {
    case 'login_required':
      return '需要登录才能继续';
    case 'captcha_required':
      return '需要完成验证码';
    case 'mfa_required':
      return '需要完成二次验证';
    case 'manual_confirmation_required':
      return '需要手动确认';
    case 'unsupported_page':
      return '不支持的页面';
    case 'rate_limited':
      return '请求过于频繁，请稍后再试';
    case 'unknown':
      return '未知原因被阻止';
    default:
      return '操作被阻止';
  }
}

/**
 * Get recommendation based on inspection result
 */
export function getRecommendation(result: BrowserInspectionResult): string {
  if (!result.safeForAgent) {
    switch (result.authState) {
      case 'auth_required':
        return '此网站需要登录。请在浏览器窗口中完成登录，然后点击"我已登录"按钮继续。';
      case 'mfa_required':
        return '此网站需要二次验证。请完成验证后继续。';
      case 'captcha_required':
        return '检测到验证码。请在浏览器窗口中完成验证，然后继续。';
      case 'expired':
        return '登录会话已过期。请重新登录后继续。';
      case 'unauthenticated':
        return '当前未登录。请先登录后再继续操作。';
      default:
        return '当前页面状态不适合自动化操作。请检查浏览器窗口。';
    }
  }

  return '页面状态正常，可以开始执行自动化任务。';
}

/**
 * Get status color for UI display
 */
export function getAuthStateColor(authState: BrowserAuthState): string {
  switch (authState) {
    case 'authenticated':
      return 'text-green-500';
    case 'auth_required':
    case 'mfa_required':
    case 'captcha_required':
    case 'expired':
      return 'text-yellow-500';
    case 'unauthenticated':
    case 'unknown':
    default:
      return 'text-gray-500';
  }
}

/**
 * Get status background color for UI display
 */
export function getAuthStateBgColor(authState: BrowserAuthState): string {
  switch (authState) {
    case 'authenticated':
      return 'bg-green-50';
    case 'auth_required':
    case 'mfa_required':
    case 'captcha_required':
    case 'expired':
      return 'bg-yellow-50';
    case 'unauthenticated':
    case 'unknown':
    default:
      return 'bg-gray-50';
  }
}

/**
 * Check if status requires user intervention
 */
export function requiresUserIntervention(authState: BrowserAuthState): boolean {
  const interventionStates: BrowserAuthState[] = [
    'auth_required',
    'mfa_required',
    'captcha_required',
    'expired',
    'unauthenticated',
  ];
  return interventionStates.includes(authState);
}

/**
 * Create a default inspection result for fallback
 */
export function createDefaultInspectionResult(url: string): BrowserInspectionResult {
  return {
    url,
    title: '',
    authState: 'unknown',
    matchedProfileId: matchProfileByUrl(url).id,
    matchedSignals: [],
    safeForAgent: false,
  };
}
