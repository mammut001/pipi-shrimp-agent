/**
 * @jest-environment jsdom
 */

import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import {
  formatRunStatusLabel,
  formatEventPhaseLabel,
  RunStatusBadge,
  IterationStatusBadge,
  IterationDetail,
  HeaderActionButton,
  RowCopyButton,
  CopyIcon,
} from '../autoResearchPanelUi';

jest.mock('@/i18n', () => ({
  t: (key: string) =>
    ({
      'autoresearch.statusReflectionFailed': 'Reflection failed',
      'autoresearch.reflectionParseFailed': 'Reflection parse failed',
    }[key] ?? key),
}));

describe('autoResearchPanelUi', () => {
  let mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  function render(ui: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(ui);
    });
    return { container, root };
  }

  describe('formatRunStatusLabel', () => {
    it('localizes reflection_failed and spaces other statuses', () => {
      expect(formatRunStatusLabel('reflection_failed')).toBe('Reflection failed');
      expect(formatRunStatusLabel('waiting_rate_limit')).toBe('waiting rate limit');
      expect(formatRunStatusLabel('completed')).toBe('completed');
    });
  });

  describe('formatEventPhaseLabel', () => {
    it('localizes reflection_parse_failed and spaces other phases', () => {
      expect(formatEventPhaseLabel('reflection_parse_failed')).toBe('Reflection parse failed');
      expect(formatEventPhaseLabel('RUN_EXPERIMENT')).toBe('RUN EXPERIMENT');
      expect(formatEventPhaseLabel('agent_execution')).toBe('agent execution');
    });
  });

  describe('RunStatusBadge', () => {
    it('renders localized status text with status-specific class', () => {
      const { container } = render(createElement(RunStatusBadge, { status: 'reflection_failed' }));
      const badge = container.querySelector('span');
      expect(badge?.textContent).toBe('Reflection failed');
      expect(badge?.className).toContain('bg-red-100');
      expect(badge?.className).toContain('text-red-700');
    });
  });

  describe('IterationStatusBadge', () => {
    it('renders raw status text with matching style', () => {
      const { container } = render(createElement(IterationStatusBadge, { status: 'running' }));
      const badge = container.querySelector('span');
      expect(badge?.textContent).toBe('running');
      expect(badge?.className).toContain('bg-blue-100');
    });
  });

  describe('HeaderActionButton / RowCopyButton', () => {
    it('wires label, aria, data-copy-target, and click handler', () => {
      const onHeaderClick = jest.fn();
      const onRowClick = jest.fn();
      const { container } = render(
        createElement(
          'div',
          null,
          createElement(HeaderActionButton, {
            label: 'Copy',
            icon: createElement(CopyIcon),
            onClick: onHeaderClick,
            dataCopyTarget: 'live-output-copy',
            className: 'extra-class',
          }),
          createElement(RowCopyButton, {
            label: 'Copy line',
            onClick: onRowClick,
            dataCopyTarget: 'recent-event-line',
          }),
        ),
      );

      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons).toHaveLength(2);
      expect(buttons[0].getAttribute('aria-label')).toBe('Copy');
      expect(buttons[0].getAttribute('data-copy-target')).toBe('live-output-copy');
      expect(buttons[0].className).toContain('extra-class');
      expect(buttons[0].textContent).toContain('Copy');
      expect(buttons[1].getAttribute('aria-label')).toBe('Copy line');
      expect(buttons[1].getAttribute('data-copy-target')).toBe('recent-event-line');

      act(() => {
        buttons[0].click();
        buttons[1].click();
      });
      expect(onHeaderClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('IterationDetail', () => {
    it('returns null when iteration index is missing', () => {
      const run = createAutoResearchDemoRun();
      const { container } = render(createElement(IterationDetail, { run, index: 99 }));
      expect(container.innerHTML).toBe('');
    });

    it('renders redacted hypothesis/change and metric badge', () => {
      const run = createAutoResearchDemoRun();
      run.iterations[0] = {
        ...run.iterations[0],
        status: 'completed',
        hypothesis: 'Try stronger aug with api_key=sk-SECRETKEY123',
        change: 'lr=0.01',
        reasoning: 'baseline plateaued',
        metricValue: 0.91,
        error: null,
        artifactPaths: ['/tmp/a.png', '/tmp/b.png'],
        startedAt: 't0',
        endedAt: 't1',
      };

      const { container } = render(createElement(IterationDetail, { run, index: 0 }));
      expect(container.textContent).toContain('Hypothesis');
      expect(container.textContent).toContain('Try stronger aug with api_key=[redacted]');
      expect(container.textContent).not.toContain('sk-SECRETKEY123');
      expect(container.textContent).toContain('Change');
      expect(container.textContent).toContain('lr=0.01');
      expect(container.textContent).toContain(`${run.config.metric}=0.91`);
      expect(container.textContent).toContain('Artifacts');
      expect(container.textContent).toContain('/tmp/a.png');
      expect(container.textContent).toContain('t0 → t1');
    });
  });
});
