/**
 * Browser State Validation Helper
 *
 * Utility functions to validate browser agent state consistency.
 * Use these in manual QA or for debugging browser-related issues.
 */

import { useBrowserAgentStore } from '../store/browserAgentStore';

export interface BrowserStateValidation {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * Validate browser agent store state for consistency.
 * Call this after browser operations to check for state corruption.
 */
export function validateBrowserState(): BrowserStateValidation {
  const state = useBrowserAgentStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check status transitions
  if (state.status === 'needs_login' && state.authState !== 'auth_required' && state.authState !== 'mfa_required' && state.authState !== 'captcha_required') {
    issues.push('Status is needs_login but authState is not auth_required/mfa_required/captcha_required');
    recommendations.push('Set authState to auth_required (or mfa_required/captcha_required) when status becomes needs_login');
  }

  if (state.status === 'ready_for_agent' && state.authState !== 'authenticated') {
    issues.push('Status is ready_for_agent but authState is not authenticated');
    recommendations.push('Ensure auth is complete before marking ready_for_agent');
  }

  // Check window state consistency
  if (state.isWindowOpen && !state.currentUrl) {
    issues.push('Window is open but no current URL set');
    recommendations.push('Set currentUrl when opening browser window');
  }

  if (!state.isWindowOpen && state.currentUrl) {
    issues.push('Window is closed but current URL still set');
    recommendations.push('Clear currentUrl when closing browser window');
  }

  // Check error state
  if (state.error && state.status === 'ready_for_agent') {
    issues.push('Agent is ready but error is present');
    recommendations.push('Clear error when status becomes ready_for_agent');
  }

  // Check task consistency
  if (state.pendingTask && state.status !== 'waiting_user_resume') {
    issues.push('Pending task exists but not in waiting state');
    recommendations.push('Ensure pending tasks only exist during waiting_user_resume');
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Validate browser login handoff flow.
 * Call this during login testing to verify state transitions.
 */
export function validateLoginHandoff(): BrowserStateValidation {
  const state = useBrowserAgentStore.getState();
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check login flow states
  if (state.status === 'needs_login') {
    if (!state.pendingTask) {
      issues.push('In needs_login but no pending task');
      recommendations.push('Store task that triggered login requirement');
    }
    if (state.authState !== 'auth_required' && state.authState !== 'mfa_required' && state.authState !== 'captcha_required') {
      issues.push('In needs_login but authState is not auth_required/mfa_required/captcha_required');
      recommendations.push('Set authState to auth_required when entering needs_login');
    }
  }

  if (state.status === 'waiting_user_resume') {
    if (!state.pendingTask) {
      issues.push('Waiting for resume but no pending task');
      recommendations.push('Preserve task during user resume wait');
    }
  }

  if (state.authState === 'authenticated') {
    if (state.status === 'needs_login') {
      issues.push('Authenticated but still needs login');
      recommendations.push('Transition to ready_for_agent after authentication');
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Log browser state for debugging.
 * Use in console during manual testing.
 */
export function logBrowserState(): void {
  const state = useBrowserAgentStore.getState();
  console.group('Browser State Debug');
  console.log('Status:', state.status);
  console.log('Auth State:', state.authState);
  console.log('Window Open:', state.isWindowOpen);
  console.log('Current URL:', state.currentUrl);
  console.log('Error:', state.error);
  console.log('Pending Task:', state.pendingTask ? 'Yes' : 'No');
  console.log('Mode:', state.mode);
  console.groupEnd();

  const validation = validateBrowserState();
  if (!validation.isValid) {
    console.warn('State Issues:', validation.issues);
    console.info('Recommendations:', validation.recommendations);
  }
}

// Make available globally for console debugging
if (typeof window !== 'undefined') {
  (window as any).validateBrowserState = validateBrowserState;
  (window as any).validateLoginHandoff = validateLoginHandoff;
  (window as any).logBrowserState = logBrowserState;
}