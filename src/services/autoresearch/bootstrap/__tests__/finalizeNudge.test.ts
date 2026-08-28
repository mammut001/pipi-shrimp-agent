import {
  BOOTSTRAP_FINALIZE_HARD_REQUIREMENT,
  BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE,
  buildBootstrapSystemPromptWithFinalizeRequirement,
  shouldRunBootstrapFinalizeNudge,
} from '../finalizeNudge';

describe('bootstrap finalizeNudge helpers', () => {
  it('requires a nudge when readyResult is missing', () => {
    expect(shouldRunBootstrapFinalizeNudge(null)).toBe(true);
    expect(shouldRunBootstrapFinalizeNudge(undefined)).toBe(true);
    expect(shouldRunBootstrapFinalizeNudge({ status: 'needs_user_confirmation' } as any)).toBe(false);
    expect(shouldRunBootstrapFinalizeNudge({ status: 'ready' } as any)).toBe(false);
  });

  it('appends the hard finalize requirement once', () => {
    const base = 'You are the bootstrap planner.';
    const once = buildBootstrapSystemPromptWithFinalizeRequirement(base);
    expect(once).toContain(base);
    expect(once).toContain('HARD REQUIREMENT: bootstrap_finalize');
    expect(once).toContain('bootstrap_finalize');

    const twice = buildBootstrapSystemPromptWithFinalizeRequirement(once);
    expect(twice).toBe(once);
  });

  it('exports a nudge user message that forces finalize tool use', () => {
    expect(BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE).toMatch(/bootstrap_finalize/);
    expect(BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE.toLowerCase()).toMatch(/call/);
    expect(BOOTSTRAP_FINALIZE_HARD_REQUIREMENT).toMatch(/MUST end this bootstrap/i);
  });
});
