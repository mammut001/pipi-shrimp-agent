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

  it('honors disabled state', () => {
    const html = render('ask', { disabled: true });
    expect(html).toContain('disabled=""');
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
    expect(html).not.toContain('Enable Bypass');
    expect(html).not.toContain('启用绕过');
  });
});
