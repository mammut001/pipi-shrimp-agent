/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  FieldLabel,
  InlineHint,
  PathInputRow,
  ReadinessRow,
  SectionCard,
  SummaryItem,
} from '@/components/autoResearchSetup/AutoResearchSetupModalUi';

jest.mock('@/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'autoresearch.readiness.filled': 'Filled',
      'autoresearch.readiness.check': 'Check',
      'autoresearch.readiness.missing': 'Missing',
    };
    return map[key] ?? key;
  },
}));

describe('AutoResearchSetupModalUi', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders SectionCard title and children', () => {
    act(() => {
      root.render(
        createElement(SectionCard, { title: 'Run target' }, createElement('span', null, 'body')),
      );
    });
    expect(container.textContent).toContain('Run target');
    expect(container.textContent).toContain('body');
  });

  it('marks FieldLabel required with asterisk', () => {
    act(() => {
      root.render(createElement(FieldLabel, { label: 'Host', required: true }));
    });
    expect(container.textContent).toContain('Host');
    expect(container.textContent).toContain('*');
  });

  it('renders InlineHint text', () => {
    act(() => {
      root.render(createElement(InlineHint, null, 'hint text'));
    });
    expect(container.textContent).toContain('hint text');
  });

  it('maps ReadinessRow status labels', () => {
    act(() => {
      root.render(createElement(ReadinessRow, { label: 'Provider', status: 'ok' }));
    });
    expect(container.textContent).toContain('Provider');
    expect(container.textContent).toContain('Filled');

    act(() => {
      root.render(createElement(ReadinessRow, { label: 'SSH', status: 'warn' }));
    });
    expect(container.textContent).toContain('Check');

    act(() => {
      root.render(createElement(ReadinessRow, { label: 'Metric', status: 'error' }));
    });
    expect(container.textContent).toContain('Missing');
  });

  it('renders SummaryItem label and value', () => {
    act(() => {
      root.render(createElement(SummaryItem, { label: 'Target', value: 'local' }));
    });
    expect(container.textContent).toContain('Target');
    expect(container.textContent).toContain('local');
  });

  it('PathInputRow renders value/aria and fires pick button', () => {
    const onPick = jest.fn();
    act(() => {
      root.render(
        createElement(PathInputRow, {
          value: '/tmp/work',
          onChange: () => undefined,
          placeholder: 'workdir',
          ariaLabel: 'workdir-input',
          onPick,
          pickLabel: 'Browse',
        }),
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('/tmp/work');
    expect(input.getAttribute('aria-label')).toBe('workdir-input');
    expect(input.getAttribute('placeholder')).toBe('workdir');

    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'Browse',
    );
    expect(button).toBeTruthy();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('PathInputRow omits pick button when onPick is absent', () => {
    act(() => {
      root.render(
        createElement(PathInputRow, {
          value: '',
          onChange: () => undefined,
          placeholder: 'p',
          ariaLabel: 'a',
          pickLabel: 'Browse',
        }),
      );
    });
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('PathInputRow applies invalid border class when invalid', () => {
    act(() => {
      root.render(
        createElement(PathInputRow, {
          value: '',
          onChange: () => undefined,
          placeholder: 'p',
          ariaLabel: 'a',
          pickLabel: 'Pick',
          invalid: true,
        }),
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.className).toContain('border-rose-300');
  });
});
