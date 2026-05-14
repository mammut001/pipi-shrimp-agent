import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';

type DomGlobalKey =
  | 'window'
  | 'document'
  | 'navigator'
  | 'HTMLElement'
  | 'Event'
  | 'MouseEvent'
  | 'KeyboardEvent'
  | 'CustomEvent'
  | 'Node'
  | 'Text'
  | 'getComputedStyle'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'IS_REACT_ACT_ENVIRONMENT';

interface DomHarness {
  window: Window;
  container: HTMLDivElement;
  render: (node: ReactElement) => Promise<void>;
  cleanup: () => Promise<void>;
}

function installGlobal(
  key: DomGlobalKey,
  value: unknown,
  snapshots: Map<DomGlobalKey, PropertyDescriptor | undefined>,
): void {
  snapshots.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

export function createDomHarness(): DomHarness {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  const snapshots = new Map<DomGlobalKey, PropertyDescriptor | undefined>();
  const { window } = dom;

  installGlobal('window', window, snapshots);
  installGlobal('document', window.document, snapshots);
  installGlobal('navigator', window.navigator, snapshots);
  installGlobal('HTMLElement', window.HTMLElement, snapshots);
  installGlobal('Event', window.Event, snapshots);
  installGlobal('MouseEvent', window.MouseEvent, snapshots);
  installGlobal('KeyboardEvent', window.KeyboardEvent, snapshots);
  installGlobal('CustomEvent', window.CustomEvent, snapshots);
  installGlobal('Node', window.Node, snapshots);
  installGlobal('Text', window.Text, snapshots);
  installGlobal('getComputedStyle', window.getComputedStyle.bind(window), snapshots);
  installGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
    snapshots,
  );
  installGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id), snapshots);
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true, snapshots);

  const container = window.document.getElementById('root') as HTMLDivElement;
  const root: Root = createRoot(container);

  return {
    window,
    container,
    render: async (node: ReactElement) => {
      await act(async () => {
        root.render(node);
      });
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });

      for (const [key, descriptor] of snapshots.entries()) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[key];
        }
      }

      dom.window.close();
    },
  };
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function clickElement(element: Element | null, windowRef: Window): Promise<void> {
  if (!element) {
    throw new Error('Expected clickable element, but received null.');
  }

  await act(async () => {
    element.dispatchEvent(new windowRef.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
  });
}

export async function keydownElement(element: Element | null, key: string, windowRef: Window): Promise<void> {
  if (!element) {
    throw new Error('Expected keyboard target element, but received null.');
  }

  await act(async () => {
    element.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
  });
}
