/**
 * @jest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarSessionList } from '../SidebarSessionList';
import { createProject, createSession } from '@/types/chat';

afterEach(cleanup);

function renderList(overrides: Partial<React.ComponentProps<typeof SidebarSessionList>> = {}) {
  const loose = { ...createSession('Loose chat'), id: 'loose' };
  const project = { ...createProject('Proj'), id: 'proj' };
  const grouped = { ...createSession('Grouped chat', 'proj'), id: 'grouped' };
  const props: React.ComponentProps<typeof SidebarSessionList> = {
    currentSessionId: null,
    searchQuery: '',
    setSearchQuery: jest.fn(),
    filteredSessions: null,
    sessions: [loose, grouped],
    ungroupedSessions: [loose],
    isMultiSelectMode: false,
    selectedSessions: new Set(),
    handleToggleSessionSelection: jest.fn(),
    handleSelectSession: jest.fn(),
    getSessionPreview: () => '',
    renamingSessionId: null,
    renameInput: '',
    setRenameInput: jest.fn(),
    handleConfirmRename: jest.fn(),
    handleCancelRename: jest.fn(),
    handleStartRename: jest.fn(),
    tokenUsageMap: new Map(),
    sessionCostMap: new Map(),
    handleOpenMoveChatModal: jest.fn(),
    handleOpenDeleteConfirm: jest.fn(),
    projects: [project],
    expandedProjects: new Set(['proj']),
    toggleProject: jest.fn(),
    getSessionsByProject: () => [grouped],
    handleContextMenu: jest.fn(),
    setShowNewProjectModal: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<SidebarSessionList {...props} />) };
}

describe('SidebarSessionList', () => {
  it('never nests interactive controls inside a button', () => {
    const { container } = renderList({ renamingSessionId: 'loose', renameInput: 'Loose chat' });
    expect(container.querySelectorAll('button button, button input')).toHaveLength(0);
  });

  it('selects a session by click or keyboard, but not from its action buttons', () => {
    const { props } = renderList();
    const row = screen.getByText('Loose chat').closest('[role="button"]') as HTMLElement;

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(props.handleSelectSession).toHaveBeenCalledTimes(2);

    const [moveButton] = screen.getAllByTitle('sidebar.moveToProjectAction');
    fireEvent.keyDown(moveButton, { key: 'Enter' });
    fireEvent.click(moveButton);
    expect(props.handleSelectSession).toHaveBeenCalledTimes(2);
    expect(props.handleOpenMoveChatModal).toHaveBeenCalledWith('loose');
  });
});
