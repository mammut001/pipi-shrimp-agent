/**
 * @jest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@/i18n';
import { SidebarWorkflowBulkActions } from './SidebarWorkflowBulkActions';

afterEach(() => {
  cleanup();
});

describe('Sidebar workflow bulk actions', () => {
  it('delegates selection, batch delete, and selection exit actions', () => {
    const setMultiSelectMode = jest.fn();
    const setSelectedWorkflows = jest.fn();
    const handleSelectAll = jest.fn();
    const handleBatchDelete = jest.fn();

    render(
      <SidebarWorkflowBulkActions
        isWorkflowMultiSelectMode
        setIsWorkflowMultiSelectMode={setMultiSelectMode}
        selectedWorkflows={new Set(['workflow-a'])}
        setSelectedWorkflows={setSelectedWorkflows}
        workflowInstances={[{ id: 'workflow-a' }, { id: 'workflow-b' }]}
        handleWorkflowSelectAll={handleSelectAll}
        handleBatchDeleteWorkflows={handleBatchDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('common.all') }));
    fireEvent.click(screen.getByRole('button', { name: t('common.delete') }));
    fireEvent.click(screen.getByTitle(t('sidebar.exitSelection')));

    expect(handleSelectAll).toHaveBeenCalledTimes(1);
    expect(handleBatchDelete).toHaveBeenCalledTimes(1);
    expect(setMultiSelectMode).toHaveBeenCalledWith(false);
    expect(setSelectedWorkflows).toHaveBeenCalledWith(expect.any(Set));
  });
});
