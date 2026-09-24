/**
 * @jest-environment jsdom
 */

import { act, createElement, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import {
  AutoResearchPanelEmptyState,
  AutoResearchRunHistorySection,
  AutoResearchSelectedRunSummary,
  AutoResearchIterationList,
  AutoResearchRecentEventsSection,
  AutoResearchLiveOutputSection,
} from '../autoResearchPanelSections';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../autoresearch/AutoResearchRunDetailDocument', () => ({
  AutoResearchRunDetailDocument: () => null,
}));

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  act(() => {
    root.render(element);
  });
  return container;
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByText(container: ParentNode, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label));
}

describe('autoResearchPanelSections', () => {
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

  it('empty state and run history forward setup/select callbacks', () => {
    const run = { ...createAutoResearchDemoRun(), id: 'sections-run-1' };
    const onShowSetup = jest.fn();
    const onSelectRun = jest.fn();

    const empty = render(createElement(AutoResearchPanelEmptyState, { onShowSetup }));
    click(buttonByText(empty, 'Setup & Start'));
    expect(onShowSetup).toHaveBeenCalledTimes(1);

    const history = render(createElement(AutoResearchRunHistorySection, {
      sortedRuns: [run],
      selectedRunId: run.id,
      panelWarning: 'locked warning',
      onShowSetup,
      onSelectRun,
    }));
    expect(history.textContent).toContain('locked warning');
    click(buttonByText(history, 'New Run'));
    expect(onShowSetup).toHaveBeenCalledTimes(2);
    click(buttonByText(history, run.title));
    expect(onSelectRun).toHaveBeenCalledWith(run.id);
  });

  it('selected run summary wires detail + loop controls', () => {
    const run = { ...createAutoResearchDemoRun(), id: 'sections-run-2' };
    const handlers = {
      onOpenDetail: jest.fn(),
      onRecoveryAction: jest.fn(),
      onResumeInterruptedRun: jest.fn(),
      onPause: jest.fn(),
      onResume: jest.fn(),
      onStop: jest.fn(),
      onNewSession: jest.fn(),
    };
    const container = render(createElement(AutoResearchSelectedRunSummary, {
      run,
      recoverySummary: null,
      isSelectedRunActive: true,
      loopState: 'running',
      runReason: null,
      canResumeInterruptedRun: false,
      isResumingInterruptedRun: false,
      ...handlers,
    }));
    click(buttonByText(container, 'Open Detail'));
    click(buttonByText(container, 'autoresearch.pause'));
    click(buttonByText(container, 'autoresearch.stop'));
    expect(handlers.onOpenDetail).toHaveBeenCalledTimes(1);
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(buttonByText(container, 'Resume Run')).toBeUndefined();
  });

  it('iteration list, recent events and live output forward row actions', () => {
    const run = { ...createAutoResearchDemoRun(), id: 'sections-run-3' };
    const onToggleIteration = jest.fn();
    const iterations = render(createElement(AutoResearchIterationList, {
      run,
      iterations: run.iterations,
      selectedIterationIndex: -1,
      onToggleIteration,
    }));
    expect(run.iterations.length).toBeGreaterThan(0);
    click(iterations.querySelector('.divide-y button'));
    expect(onToggleIteration).toHaveBeenCalledWith(0);

    const onCopyAllEvents = jest.fn();
    const onCopyEventLine = jest.fn();
    const recentEvents = run.events.slice(-6).reverse();
    const events = render(createElement(AutoResearchRecentEventsSection, {
      recentEvents,
      onCopyAllEvents,
      onCopyEventLine,
    }));
    click(events.querySelector('[data-copy-target="recent-events-all"]'));
    expect(onCopyAllEvents).toHaveBeenCalledTimes(1);
    expect(recentEvents.length).toBeGreaterThan(0);
    click(events.querySelector('[data-copy-target="recent-event-line"]'));
    expect(onCopyEventLine).toHaveBeenCalledWith(recentEvents[0]);

    const liveHandlers = { onToggleExpanded: jest.fn(), onCopy: jest.fn(), onDownload: jest.fn(), onClear: jest.fn() };
    const liveOutputRef = createRef<HTMLDivElement>();
    const live = render(createElement(AutoResearchLiveOutputSection, {
      liveExpanded: true,
      liveOutputFeedback: 'copied',
      displayedLiveOutput: 'hello live output',
      liveOutputRef,
      ...liveHandlers,
    }));
    expect(live.querySelector('[data-live-output-content]')?.textContent).toBe('hello live output');
    expect(live.querySelector('[data-live-output-feedback="copied"]')).not.toBeNull();
    expect(liveOutputRef.current).not.toBeNull();
    click(live.querySelector('[aria-label="Toggle live output"]'));
    click(live.querySelector('[data-copy-target="live-output-copy"]'));
    click(live.querySelector('[data-copy-target="live-output-download"]'));
    click(live.querySelector('[data-copy-target="live-output-clear"]'));
    expect(liveHandlers.onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(liveHandlers.onCopy).toHaveBeenCalledTimes(1);
    expect(liveHandlers.onDownload).toHaveBeenCalledTimes(1);
    expect(liveHandlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('keeps AutoResearchPanel under the 500 LOC component band with static section imports (source guard)', () => {
    const panelSource = readFileSync(join(process.cwd(), 'src/components/AutoResearchPanel.tsx'), 'utf8');
    expect(panelSource.split('\n').length).toBeLessThan(500);
    expect(panelSource).toMatch(/from '\.\/autoResearchPanelSections'/);
    expect(panelSource).not.toMatch(/await import\(/);
    expect(panelSource).not.toMatch(/React\.lazy|\blazy\(/);
  });
});
