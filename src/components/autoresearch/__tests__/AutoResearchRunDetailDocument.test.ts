import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import { AutoResearchRunDetailDocument } from '../AutoResearchRunDetailDocument';

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

function findButtonByText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | null;
}

describe('AutoResearchRunDetailDocument', () => {
  it('defaults to dashboard mode and allows switching between dashboard and document views', async () => {
    await withDom(async (container, root, dom) => {
      const onBack = jest.fn();

      await act(async () => {
        root.render(React.createElement(AutoResearchRunDetailDocument, {
          run: createAutoResearchDemoRun(),
          onBack,
        }));
      });

      expect(container.textContent).toContain('Document view');
      expect(container.textContent).toContain('Metric History');
      expect(container.textContent).toContain('Iterations');

      const backButton = findButtonByText(container, 'Back to Runs');
      expect(backButton).not.toBeNull();
      await act(async () => {
        backButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
      expect(onBack).toHaveBeenCalledTimes(1);

      const documentButton = findButtonByText(container, 'Document view');
      expect(documentButton).not.toBeNull();
      await act(async () => {
        documentButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Generated Run Report');
      expect(container.textContent).toContain('Dashboard view');

      const dashboardButton = findButtonByText(container, 'Dashboard view');
      expect(dashboardButton).not.toBeNull();
      await act(async () => {
        dashboardButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Document view');
      expect(container.textContent).toContain('Metric History');
    });
  });
});