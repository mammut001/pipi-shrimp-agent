/**
 * @jest-environment jsdom
 */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.lowerIsBetter': 'lower is better',
    'autoresearch.higherIsBetter': 'higher is better',
    'autoresearch.detail.autoResearch': 'Auto Research',
    'autoresearch.detail.demo': 'Demo',
    'autoresearch.detail.fullReport': 'Full report',
    'autoresearch.detail.open': 'Open',
    'autoresearch.detail.backToRuns': 'Back to Runs',
    'autoresearch.detail.backToDashboard': 'Back to Dashboard',
    'autoresearch.detail.close': 'Close',
    'autoresearch.detail.demoNotice': 'Demo preview is shown because no AutoResearch run with iterations is selected yet.',
    'autoresearch.detail.metricHistory': 'Metric History',
    'autoresearch.detail.iterationsTitle': 'Iterations',
    'autoresearch.detail.iterationsSubtitle': 'Compact benchmark deltas for each candidate run.',
    'autoresearch.detail.noIterations': 'No iterations recorded yet.',
    'autoresearch.detail.noParsedMetricPoints': 'No parsed metric points yet.',
    'autoresearch.detail.baseline': 'Baseline',
    'autoresearch.detail.best': 'Best',
    'autoresearch.detail.iterationAxis': 'iteration',
    'autoresearch.detail.keepBreakthrough': 'keep / breakthrough',
    'autoresearch.detail.discard': 'discard',
    'autoresearch.detail.failedNoMetric': 'failed/no metric',
  }[key] ?? key),
}));

jest.mock('@/components/document', () => ({
  DocumentContentCard: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DocumentMetadataSidebar: ({ children, sections }: { children?: ReactNode; sections?: Array<{ label: string; content: ReactNode }> }) => createElement(
    'aside',
    null,
    children,
    sections?.map((section) => createElement('section', { key: section.label }, section.content)),
  ),
  MarkdownDocumentPreview: ({ body }: { body: string }) => createElement('div', null, body),
  DocumentDetailShell: ({
    title,
    subtitle,
    onBack,
    backLabel,
    onOpen,
    openLabel,
    onClose,
    headerActions,
    children,
    sidebar,
  }: {
    title: string;
    subtitle?: string | null;
    onBack?: () => void;
    backLabel?: string;
    onOpen?: () => void;
    openLabel?: string;
    onClose?: () => void;
    headerActions?: ReactNode;
    children: ReactNode;
    sidebar?: ReactNode;
  }) => createElement(
    'div',
    null,
    createElement('h1', null, title),
    subtitle ? createElement('p', null, subtitle) : null,
    onBack ? createElement('button', { type: 'button', onClick: onBack }, backLabel ?? 'Back') : null,
    onOpen ? createElement('button', { type: 'button', onClick: onOpen }, openLabel ?? 'Open') : null,
    onClose ? createElement('button', { type: 'button', onClick: onClose }, 'Close') : null,
    headerActions,
    sidebar,
    children,
  ),
}));

function findButtonByText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | null;
}

let AutoResearchRunDetailDocument: typeof import('../AutoResearchRunDetailDocument').AutoResearchRunDetailDocument;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderDetail(props: Parameters<typeof AutoResearchRunDetailDocument>[0]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AutoResearchRunDetailDocument, props));
  });

  return { container, root };
}

describe('AutoResearchRunDetailDocument', () => {
  beforeAll(async () => {
    ({ AutoResearchRunDetailDocument } = await import('../AutoResearchRunDetailDocument'));
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

  it('always renders the dashboard first and falls back to demo content when no run is provided', async () => {
    const onBack = jest.fn();
    const onClose = jest.fn();
    const view = renderDetail({
      run: null,
      onBack,
      onClose,
    });

    expect(view.container.textContent).toContain('Full report');
    expect(view.container.textContent).toContain('Metric History');
    expect(view.container.textContent).toContain('Iterations');
    expect(view.container.textContent).toContain('Demo');
    expect(view.container.textContent).toContain('Benchmark fixture optimization sweep');
    expect(view.container.textContent).toContain('Demo preview is shown because no AutoResearch run with iterations is selected yet.');

    const backButton = findButtonByText(view.container, 'Back to Runs');
    expect(backButton).not.toBeNull();
    act(() => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    const closeButton = findButtonByText(view.container, 'Close');
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches to the full report and returns to the dashboard without closing', async () => {
    const onClose = jest.fn();
    const view = renderDetail({
      run: createAutoResearchDemoRun(),
      onClose,
    });

    const documentButton = findButtonByText(view.container, 'Full report');
    expect(documentButton).not.toBeNull();
    act(() => {
      documentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.container.textContent).toContain('Generated Run Report');
    expect(view.container.textContent).toContain('Back to Dashboard');

    const dashboardButton = findButtonByText(view.container, 'Back to Dashboard');
    expect(dashboardButton).not.toBeNull();
    act(() => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Full report');
    expect(view.container.textContent).toContain('Metric History');
  });

  it('uses the demo fallback when a selected run has no iterations', async () => {
    const run = {
      ...createAutoResearchDemoRun(),
      id: 'real-empty-run',
      title: 'Empty real run',
      iterations: [],
      events: [],
      summary: undefined,
    };

    const view = renderDetail({
      run,
    });

    expect(view.container.textContent).toContain('Demo');
    expect(view.container.textContent).toContain('Benchmark fixture optimization sweep');
  });
});
