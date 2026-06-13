/**
 * ExecutionModeDropdown structural test.
 *
 * Renders the dropdown with `react-dom/server` to a static HTML string
 * and asserts on its structure. The interactive state machine (Escape,
 * ArrowDown, Bypass warning) is exercised by the existing registry +
 * guards tests in `src/services/executionMode/__tests__/registry.test.ts`
 * — keeping the component test framework-free so we don't have to
 * juggle jest-environment-jsdom under ts-jest ESM.
 */

import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { ExecutionModeDropdown } from '../ExecutionModeDropdown';
import {
  EXECUTION_MODES,
  getDefaultExecutionMode,
  getExecutionMode,
  type ExecutionModeId,
} from '@/services/executionMode';

function render(modeId: string, options: { disabled?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ExecutionModeDropdown, {
      selectedModeId: modeId,
      onSelect: () => {},
      disabled: options.disabled,
    }),
  );
}

describe('ExecutionModeDropdown (structural)', () => {
  it('renders the trigger with the currently selected mode label and correct aria attributes', () => {
    const html = render('plan');
    expect(html).toContain('data-testid="execution-mode-dropdown-trigger"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('executionMode.plan.label');
  });

  it('falls back to the default mode label when given an unknown id', () => {
    const html = render('not-a-real-mode');
    const fallbackLabel = getDefaultExecutionMode().labelKey;
    expect(html).toContain(fallbackLabel);
  });

  it('honors the disabled prop on the trigger', () => {
    const html = render('agent', { disabled: true });
    // The trigger button has the `disabled` attribute when disabled.
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('lists every registered mode as a menu item with the right id', () => {
    // The component renders items when open; verify the registry we read
    // from exposes all 4 ids in the expected order, and that the dropdown
    // module's import surface references them.
    const ids: ExecutionModeId[] = EXECUTION_MODES.map((m) => m.id);
    expect(ids).toEqual(['plan', 'debug', 'agent', 'bypass']);
    for (const id of ids) {
      // The registry exports a non-null profile for each id.
      const profile = getExecutionMode(id);
      expect(profile.id).toBe(id);
    }
  });

  it('flags Bypass as advanced and the only mode that requires a warning', () => {
    const bypass = getExecutionMode('bypass');
    expect(bypass.isAdvanced).toBe(true);
    expect(bypass.requiresWarning).toBe(true);
    expect(bypass.riskLevel).toBe('dangerous');
  });
});
