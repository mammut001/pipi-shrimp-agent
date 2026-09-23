/**
 * @jest-environment jsdom
 *
 * AG-15: ChatTerminalDock mount/visibility + height clamp unit tests.
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useUIStore } from '@/store/uiStore';
import {
  ChatTerminalDock,
  clampTerminalPanelHeight,
} from '../ChatTerminalDock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../TerminalPanel', () => ({
  TerminalPanel: ({ cwd, onClose }: { cwd?: string; onClose?: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'terminal-panel-mock', 'data-cwd': cwd ?? '' },
      React.createElement('button', { type: 'button', onClick: onClose }, 'close'),
    ),
}));

jest.mock('../SessionWorkspacePreview', () => ({
  workspacePreviewChrome: {
    terminalDivider: 'terminal-divider',
    terminalDividerThumb: 'terminal-divider-thumb',
  },
}));

describe('clampTerminalPanelHeight', () => {
  it('clamps to the historical 100–600px band', () => {
    expect(clampTerminalPanelHeight(50)).toBe(100);
    expect(clampTerminalPanelHeight(250)).toBe(250);
    expect(clampTerminalPanelHeight(900)).toBe(600);
  });
});

describe('ChatTerminalDock', () => {
  beforeEach(() => {
    act(() => {
      useUIStore.setState({
        terminalPanelVisible: false,
        terminalPanelHeight: 200,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the terminal panel is hidden', () => {
    render(React.createElement(ChatTerminalDock, { cwd: '/tmp/work' }));
    expect(screen.queryByTestId('chat-terminal-dock')).toBeNull();
    expect(screen.queryByTestId('terminal-panel-mock')).toBeNull();
  });

  it('mounts the PTY strip when visible and forwards cwd', () => {
    act(() => {
      useUIStore.setState({ terminalPanelVisible: true, terminalPanelHeight: 220 });
    });
    render(React.createElement(ChatTerminalDock, { cwd: '/tmp/project' }));
    const dock = screen.getByTestId('chat-terminal-dock');
    expect(dock.style.height).toBe('220px');
    expect(screen.getByTestId('terminal-panel-mock').getAttribute('data-cwd')).toBe(
      '/tmp/project',
    );
  });

  it('drag-resize updates height via the UI store (clamped)', () => {
    act(() => {
      useUIStore.setState({ terminalPanelVisible: true, terminalPanelHeight: 200 });
    });
    render(React.createElement(ChatTerminalDock, { cwd: '/tmp' }));
    const divider = screen.getByTestId('chat-terminal-dock-divider');
    fireEvent.mouseDown(divider, { clientY: 400 });
    // Drag up 50px → taller dock
    fireEvent.mouseMove(document, { clientY: 350 });
    expect(useUIStore.getState().terminalPanelHeight).toBe(250);
    fireEvent.mouseUp(document);
  });
});
