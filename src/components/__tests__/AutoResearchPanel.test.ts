/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import { useAutoResearchStore } from '@/store/autoresearchStore';

const capturedDetailProps: Array<Record<string, unknown>> = [];

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/services/autoresearch', () => ({
  stopExperimentLoop: jest.fn(),
  pauseExperimentLoop: jest.fn(),
  resumeExperimentLoop: jest.fn(),
}));

jest.mock('@/services/docService', () => ({
  openFileExternal: jest.fn(),
}));

jest.mock('../autoresearch/AutoResearchRunDetailDocument', () => ({
  AutoResearchRunDetailDocument: (props: Record<string, unknown>) => {
    capturedDetailProps.push(props);
    return createElement('div', { 'data-testid': 'mock-detail' }, 'Mock detail');
  },
}));

function findButtonByText(container: ParentNode, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | null;
}

let AutoResearchPanel: typeof import('../AutoResearchPanel').AutoResearchPanel;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AutoResearchPanel));
  });

  return { container, root };
}

describe('AutoResearchPanel', () => {
  beforeAll(async () => {
    ({ AutoResearchPanel } = await import('../AutoResearchPanel'));
  });

  beforeEach(() => {
    capturedDetailProps.length = 0;
    useAutoResearchStore.getState().resetSession();
    useAutoResearchStore.setState({ runHistory: [], selectedRunId: null });
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

  it('opens run detail without passing defaultViewMode', async () => {
    const run = {
      ...createAutoResearchDemoRun(),
      id: 'panel-run-1',
    };

    useAutoResearchStore.setState({
      runHistory: [run],
      selectedRunId: run.id,
      loopState: 'idle',
      liveOutput: '',
      selectedExperiment: -1,
      id: '',
      errorMessage: undefined,
      statusMessage: undefined,
    });

    const view = renderPanel();
    const openDetailButton = findButtonByText(view.container, 'Open Detail');
    expect(openDetailButton).not.toBeNull();

    act(() => {
      openDetailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('Mock detail');
    expect(capturedDetailProps).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(capturedDetailProps[0] ?? {}, 'defaultViewMode')).toBe(false);
    expect(capturedDetailProps[0]?.run).toMatchObject({ id: 'panel-run-1' });
  });
});
