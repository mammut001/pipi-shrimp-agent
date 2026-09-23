/**
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionFolderBar } from '../SessionFolderBar';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

describe('SessionFolderBar', () => {
  const onBindProject = jest.fn();
  const onClearProject = jest.fn();
  const onBindOutput = jest.fn();
  const onClearOutput = jest.fn();
  const onToggleTerminal = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when currentSession is null', () => {
    const { container } = render(
      <SessionFolderBar
        currentSession={null}
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders project and output folder chips when currentSession is present', () => {
    render(
      <SessionFolderBar
        currentSession={{ id: 'session-1' }}
        projectDir={null}
        pipiOutputDir={null}
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
        showTerminal={false}
      />,
    );

    expect(screen.getByTestId('session-folder-bar')).toBeTruthy();
    expect(screen.getByTestId('project-folder-empty')).toBeTruthy();
    expect(screen.getByTestId('pipi-output-folder-empty')).toBeTruthy();
    expect(screen.queryByTestId('terminal-toggle-button')).toBeNull();
  });

  it('renders terminal button when showTerminal is true and calls onToggleTerminal on click', () => {
    const { rerender } = render(
      <SessionFolderBar
        currentSession={{ id: 'session-1' }}
        projectDir={null}
        pipiOutputDir={null}
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
        terminalPanelVisible={false}
        onToggleTerminal={onToggleTerminal}
        showTerminal={true}
      />,
    );

    const termBtn = screen.getByTestId('terminal-toggle-button');
    expect(termBtn).toBeTruthy();
    expect(termBtn.getAttribute('title')).toBe('chat.showTerminal');

    fireEvent.click(termBtn);
    expect(onToggleTerminal).toHaveBeenCalledTimes(1);

    rerender(
      <SessionFolderBar
        currentSession={{ id: 'session-1' }}
        projectDir={null}
        pipiOutputDir={null}
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
        terminalPanelVisible={true}
        onToggleTerminal={onToggleTerminal}
        showTerminal={true}
      />,
    );

    expect(screen.getByTestId('terminal-toggle-button').getAttribute('title')).toBe('chat.hideTerminal');
  });

  it('fires bind callbacks for empty chips', () => {
    render(
      <SessionFolderBar
        currentSession={{ id: 'session-1' }}
        projectDir={null}
        pipiOutputDir={null}
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
        showTerminal={false}
      />,
    );

    fireEvent.click(screen.getByTestId('project-folder-empty'));
    expect(onBindProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('pipi-output-folder-empty'));
    expect(onBindOutput).toHaveBeenCalledTimes(1);
  });

  it('renders bound chips and fires bind / clear callbacks', () => {
    render(
      <SessionFolderBar
        currentSession={{ id: 'session-1' }}
        projectDir="/home/user/project"
        pipiOutputDir="/home/user/output"
        onBindProject={onBindProject}
        onClearProject={onClearProject}
        onBindOutput={onBindOutput}
        onClearOutput={onClearOutput}
        showTerminal={false}
      />,
    );

    expect(screen.getByTestId('project-folder-chip')).toBeTruthy();
    expect(screen.getByTestId('pipi-output-folder-chip')).toBeTruthy();

    const clearButtons = screen.getAllByRole('button', { name: 'chat.removeWorkDirectory' });
    expect(clearButtons).toHaveLength(2);

    fireEvent.click(clearButtons[0]);
    expect(onClearProject).toHaveBeenCalledTimes(1);

    fireEvent.click(clearButtons[1]);
    expect(onClearOutput).toHaveBeenCalledTimes(1);

    const changeButtons = screen.getAllByText('common.change');
    expect(changeButtons).toHaveLength(2);

    fireEvent.click(changeButtons[0]);
    expect(onBindProject).toHaveBeenCalledTimes(1);

    fireEvent.click(changeButtons[1]);
    expect(onBindOutput).toHaveBeenCalledTimes(1);
  });
});
