/**
 * @jest-environment jsdom
 *
 * AG-15 PR2: PreviewWorkspaceShell toolbar + chat/preview columns.
 */

import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PreviewWorkspaceShell } from '../PreviewWorkspaceShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/layout/edgeToggleGutter', () => ({
  MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS: '',
}));

jest.mock('../ChatWorkspaceModeToggle', () => ({
  ChatWorkspaceModeToggle: ({
    mode,
    onChange,
  }: {
    mode: 'chat' | 'preview';
    onChange: (mode: 'chat' | 'preview') => void;
  }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'mode-toggle-mock',
        'data-mode': mode,
        onClick: () => onChange(mode === 'chat' ? 'preview' : 'chat'),
      },
      'toggle',
    ),
}));

jest.mock('../SessionWorkspacePreview', () => ({
  workspacePreviewChrome: {
    shellBg: 'shell-bg',
    toolbar: 'toolbar',
    eyebrow: 'eyebrow',
    secondaryText: 'secondary',
  },
  SessionWorkspacePreviewPane: ({
    workDir,
    selectedFilePath,
  }: {
    workDir: string | null;
    selectedFilePath: string | null;
  }) =>
    React.createElement('div', {
      'data-testid': 'preview-pane-mock',
      'data-workdir': workDir ?? '',
      'data-selected': selectedFilePath ?? '',
    }),
}));

describe('PreviewWorkspaceShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders toolbar, chat column, and forwards preview props', () => {
    const onChange = jest.fn();
    const onReveal = jest.fn(async () => undefined);
    render(
      React.createElement(PreviewWorkspaceShell, {
        workspaceMode: 'preview',
        canPreview: true,
        onWorkspaceModeChange: onChange,
        workDir: '/tmp/proj',
        selectedFilePath: '/tmp/proj/a.md',
        selectedContent: '# hi',
        fileLoading: false,
        fileError: null,
        onRevealPath: onReveal,
        chat: React.createElement('div', { 'data-testid': 'chat-slot' }, 'chat'),
      }),
    );

    expect(screen.getByTestId('preview-workspace-shell')).toBeTruthy();
    expect(screen.getByTestId('preview-workspace-toolbar')).toBeTruthy();
    expect(screen.getByTestId('chat-slot').textContent).toBe('chat');
    const pane = screen.getByTestId('preview-pane-mock');
    expect(pane.getAttribute('data-workdir')).toBe('/tmp/proj');
    expect(pane.getAttribute('data-selected')).toBe('/tmp/proj/a.md');
  });

  it('mode toggle notifies the parent', () => {
    const onChange = jest.fn();
    render(
      React.createElement(PreviewWorkspaceShell, {
        workspaceMode: 'preview',
        canPreview: true,
        onWorkspaceModeChange: onChange,
        workDir: null,
        selectedFilePath: null,
        selectedContent: '',
        fileLoading: false,
        fileError: null,
        onRevealPath: jest.fn(async () => undefined),
        chat: null,
      }),
    );
    fireEvent.click(screen.getByTestId('mode-toggle-mock'));
    expect(onChange).toHaveBeenCalledWith('chat');
  });
});
