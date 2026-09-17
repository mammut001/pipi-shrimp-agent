import { describe, expect, it } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DangerWarningDialog, ExecutionModeDropdown } from '../ExecutionModeDropdown';
import { EXECUTION_MODES, getExecutionMode } from '@/services/executionMode';

function render(modeId: string, options: { disabled?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ExecutionModeDropdown, {
      selectedModeId: modeId,
      onSelect: () => undefined,
      disabled: options.disabled,
      testId: 'mode-test',
    }),
  );
}

describe('ExecutionModeDropdown three-mode surface', () => {
  it('registry backing the dropdown contains only Ask, Plan, Danger', () => {
    expect(EXECUTION_MODES.map((mode) => mode.id)).toEqual(['ask', 'plan', 'danger']);
  });

  it('renders Ask as the default selected label', () => {
    const html = render('ask');
    expect(html).toContain('data-testid="mode-test-trigger"');
    expect(html).toContain('executionMode.ask.label');
  });

  it('shows Ask defaults affordance hint (no tools until Danger)', () => {
    const html = render('ask');
    expect(html).toContain('data-testid="execution-mode-affordance-ask"');
    expect(html).toContain('executionMode.affordance.ask');
  });

  it('shows Danger tools-active affordance and keeps risky-approval copy', () => {
    const html = render('danger');
    expect(html).toContain('data-testid="execution-mode-affordance-danger"');
    expect(html).toContain('executionMode.affordance.danger');
  });

  it('renders Danger via i18n instead of the legacy Bypass product name', () => {
    const html = render('danger');
    expect(html).toContain('executionMode.danger.label');
    expect(html).not.toContain('Bypass');
    expect(html).not.toContain('绕过');
  });

  it('normalizes historical Agent selection to Plan', () => {
    expect(getExecutionMode('agent').id).toBe('plan');
    const html = render('agent');
    expect(html).toContain('executionMode.plan.label');
    expect(html).not.toContain('Agent');
  });

  it('normalizes historical Bypass selection to Danger', () => {
    expect(getExecutionMode('bypass').id).toBe('danger');
    const html = render('bypass');
    expect(html).toContain('executionMode.danger.label');
    expect(html).not.toContain('Bypass');
  });

  it('Ask render contains switch-to-danger test id and i18n key', () => {
    const html = render('ask');
    expect(html).toContain('data-testid="mode-test-switch-to-danger"');
    expect(html).toContain('executionMode.affordance.switchToDanger');
  });

  it('Danger render does NOT contain switch-to-danger button', () => {
    const html = render('danger');
    expect(html).not.toContain('mode-test-switch-to-danger');
    expect(html).not.toContain('executionMode.affordance.switchToDanger');
  });

  it('Plan render also shows switch-to-danger button', () => {
    const html = render('plan');
    expect(html).toContain('data-testid="mode-test-switch-to-danger"');
    expect(html).toContain('executionMode.affordance.switchToDanger');
  });

  it('honors disabled state and disables switch-to-danger', () => {
    const html = render('ask', { disabled: true });
    expect(html).toContain('data-testid="mode-test-switch-to-danger"');
    const disabledMatches = html.match(/disabled=""/g);
    expect(disabledMatches?.length).toBe(2);
  });
});

describe('DangerWarningDialog', () => {
  it('explains the full-tool + double-check contract', () => {
    const profile = getExecutionMode('danger');
    const html = renderToStaticMarkup(
      createElement(DangerWarningDialog, {
        profile,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(html).toContain('executionMode.danger.warningTitle');
    expect(html).toContain('executionMode.danger.warningBody');
    expect(html).toContain('executionMode.danger.warningConfirm');
    expect(html).toContain('data-testid="execution-mode-danger-warning-defaults"');
    expect(html).toContain('executionMode.affordance.danger');
    expect(html).not.toContain('Enable Bypass');
    expect(html).not.toContain('启用绕过');
  });
});
