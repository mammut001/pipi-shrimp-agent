/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.detail.iterationsTitle': 'Iterations',
    'autoresearch.detail.iterationsSubtitle': 'Compact benchmark deltas for each candidate run.',
    'autoresearch.detail.noIterations': 'No iterations recorded yet.',
  }[key] ?? key),
}));

function findButtonRow(container: HTMLElement, rowIndex: number): HTMLTableRowElement | null {
  return container.querySelectorAll('tbody tr').item(rowIndex) as HTMLTableRowElement | null;
}

let AutoResearchDashboardTable: typeof import('../AutoResearchDashboardTable').AutoResearchDashboardTable;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderDashboardTable(props: Parameters<typeof AutoResearchDashboardTable>[0]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AutoResearchDashboardTable, props));
  });

  return { container, root };
}

describe('AutoResearchDashboardTable', () => {
  beforeAll(async () => {
    ({ AutoResearchDashboardTable } = await import('../AutoResearchDashboardTable'));
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

  it('renders compact rows and forwards row selection', async () => {
    const onSelectIteration = jest.fn();
    const view = renderDashboardTable({
      run: createAutoResearchDemoRun(),
      onSelectIteration,
    });

    const text = view.container.textContent || '';

    expect(text).toContain('Iterations');
    expect(text).toContain('Cache transformed benchmark fixtures');
    expect(text).toContain('+0.5%');
    expect(text).toContain('keep');
    expect(text).not.toContain('abs');
    expect(text).not.toContain('./artifacts/autoresearch/demo/iter-1-report.md');

    const row = findButtonRow(view.container, 1);
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectIteration).toHaveBeenCalledWith(1);
  });
});
