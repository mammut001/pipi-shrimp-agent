import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

type DomGlobalKey = 'IS_REACT_ACT_ENVIRONMENT';

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
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('createDomHarness requires the jsdom test environment.');
  }

  const snapshots = new Map<DomGlobalKey, PropertyDescriptor | undefined>();
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true, snapshots);

  let container = document.getElementById('root') as HTMLDivElement | null;
  if (!container) {
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
  }

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