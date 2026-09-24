/** @jest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TerminalPanel } from '../TerminalPanel';

jest.mock('@xterm/xterm/css/xterm.css', () => ({}), { virtual: true });
jest.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    open() {}
    write() {}
    focus() {}
    dispose() {}
    clear() {}
    selectAll() {}
    getSelection() { return ''; }
    clearSelection() {}
  },
}));
jest.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() { return { rows: 24, cols: 80 }; }
    fit() {}
  },
}));
jest.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));
jest.mock('@/store', () => ({
  useSettingsStore: (selector: (state: { windowsShellProfile: string }) => unknown) =>
    selector({ windowsShellProfile: 'wsl' }),
}));
jest.mock('@/utils/windowsShellProfile', () => {
  const actual = jest.requireActual('@/utils/windowsShellProfile') as Record<string, unknown>;
  return {
    ...actual,
    resolveWindowsShellProfile: () => ({ isWindows: true, resolved: 'wsl' }),
    formatShellProfileLabel: () => 'WSL',
  };
});

const mockInvoke = jest.mocked(invoke);
const mockListen = jest.mocked(listen);
const patchedDescriptors: Array<[object, PropertyKey, PropertyDescriptor | undefined]> = [];

function patchProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
  patchedDescriptors.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, descriptor);
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((async (command: string) => {
      if (command === 'terminal_create') {
        throw new Error('PTY failed');
      }
      return undefined;
    }) as unknown as typeof invoke);
    mockListen.mockReset();
    mockListen.mockResolvedValue(jest.fn());

    patchedDescriptors.length = 0;
    patchProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    patchProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 320,
    });
    patchProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });
    patchProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    patchProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    });
  });

  afterEach(() => {
    cleanup();
    for (const [target, key, descriptor] of patchedDescriptors.reverse()) {
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      } else {
        Reflect.deleteProperty(target, key);
      }
    }
    patchedDescriptors.length = 0;
  });

  it('shows the resolved WSL profile, mixed-path warning, and PTY error banner', async () => {
    render(
      <TerminalPanel
        cwd={'C:\\workspace\\repo'}
        sessionId="terminal-test"
      />,
    );

    expect(await screen.findByText('Error: PTY failed')).toBeInTheDocument();
    expect(screen.getByText('terminal.shell.activeProfile: WSL')).toBeInTheDocument();
    expect(screen.getByText('terminal.shell.wslMixedPathWarning')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith(
      'terminal_create',
      expect.objectContaining({
        sessionId: 'terminal-test',
        cwd: 'C:\\workspace\\repo',
        shellProfile: 'wsl',
      }),
    );
    expect(mockListen).toHaveBeenCalledWith('terminal-output', expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith('terminal-exit', expect.any(Function));
  });
});
