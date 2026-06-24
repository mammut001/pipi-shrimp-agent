import { describe, expect, it } from '@jest/globals';

import { evaluateBrowserAgentStartGate } from '../browserAgentStartGate';

describe('browserAgentStartGate (R3-03)', () => {
  it('blocks auth_required before agent start', () => {
    const gate = evaluateBrowserAgentStartGate('auth_required', {
      url: 'https://example.com/login',
      title: 'Login',
      safeForAgent: false,
      authState: 'auth_required',
      blockReason: 'login_required',
      detectedLoginForm: true,
      detectedCaptcha: false,
    });

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toBe('auth_required');
      expect(gate.messageKey).toBe('browser.authRequiredBeforeAgent');
    }
  });

  it('allows unknown auth state for cdp start', () => {
    const gate = evaluateBrowserAgentStartGate('unknown', {
      url: 'https://example.com',
      title: 'Example',
      safeForAgent: true,
      authState: 'unknown',
      blockReason: null,
      detectedLoginForm: false,
      detectedCaptcha: false,
    });

    expect(gate).toEqual({ allowed: true });
  });

  it('blocks unsafe inspection when auth state is known', () => {
    const gate = evaluateBrowserAgentStartGate('authenticated', {
      url: 'https://example.com',
      title: 'Example',
      safeForAgent: false,
      authState: 'authenticated',
      blockReason: 'manual_confirmation_required',
      detectedLoginForm: false,
      detectedCaptcha: false,
    });

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toBe('page_not_safe');
    }
  });
});