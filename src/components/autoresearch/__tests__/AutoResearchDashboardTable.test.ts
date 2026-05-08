import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import { AutoResearchDashboardTable } from '../AutoResearchDashboardTable';

function findButtonRow(container: HTMLElement, rowIndex: number): HTMLTableRowElement | null {
  return container.querySelectorAll('tbody tr').item(rowIndex) as HTMLTableRowElement | null;
}

async function withDom<T>(callback: (container: HTMLElement, root: Root, dom: JSDOM) => Promise<T> | T): Promise<T> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const globalObject = globalThis as typeof globalThis & {
    window: Window & typeof globalThis;
    document: Document;
    navigator: Navigator;
    HTMLElement: typeof HTMLElement;
    MouseEvent: typeof MouseEvent;
    KeyboardEvent: typeof KeyboardEvent;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  globalObject.window = dom.window as unknown as Window & typeof globalThis;
  globalObject.document = dom.window.document;
  globalObject.navigator = dom.window.navigator;
  globalObject.HTMLElement = dom.window.HTMLElement;
  globalObject.MouseEvent = dom.window.MouseEvent;
  globalObject.KeyboardEvent = dom.window.KeyboardEvent;
  globalObject.IS_REACT_ACT_ENVIRONMENT = true;

  const container = dom.window.document.getElementById('root');
  if (!container) {
    throw new Error('Missing test root');
  }

  const root = createRoot(container);
  try {
    return await callback(container, root, dom);
  } finally {
    act(() => {
      root.unmount();
    });
  }
}

describe('AutoResearchDashboardTable', () => {
  it('renders compact rows and forwards row selection', async () => {
    await withDom(async (container, root, dom) => {
      const onSelectIteration = jest.fn();

      await act(async () => {
        root.render(React.createElement(AutoResearchDashboardTable, {
          run: createAutoResearchDemoRun(),
          onSelectIteration,
        }));
      });

      const text = container.textContent || '';

      expect(text).toContain('Iterations');
      expect(text).toContain('Cache transformed benchmark fixtures');
      expect(text).toContain('+0.5%');
      expect(text).toContain('keep');
      expect(text).not.toContain('abs');
      expect(text).not.toContain('./artifacts/autoresearch/demo/iter-1-report.md');

      const row = findButtonRow(container, 1);
      expect(row).not.toBeNull();

      await act(async () => {
        row?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
      expect(onSelectIteration).toHaveBeenCalledWith(1);
    });
  });
});