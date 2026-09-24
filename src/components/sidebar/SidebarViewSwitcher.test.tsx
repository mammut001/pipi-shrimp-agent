/**
 * @jest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@/i18n';
import { SidebarViewSwitcher } from './SidebarViewSwitcher';

afterEach(() => {
  cleanup();
});

describe('SidebarViewSwitcher', () => {
  it('renders translated view labels without ReferenceError on missing t', () => {
    render(
      <SidebarViewSwitcher
        currentView="chat"
        setCurrentView={jest.fn()}
        sessionCount={1}
        workflowCount={0}
        isMultiSelectMode={false}
        setIsMultiSelectMode={jest.fn()}
        setSelectedSessions={jest.fn()}
        isWorkflowMultiSelectMode={false}
        setIsWorkflowMultiSelectMode={jest.fn()}
        setSelectedWorkflows={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: t('nav.chat') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('nav.workflow') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('nav.diagnostics') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('sidebar.select') })).toBeDefined();
  });
});
