/**
 * @jest-environment jsdom
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@/i18n';
import { SidebarSessionBulkActions } from './SidebarSessionBulkActions';

afterEach(() => {
  cleanup();
});

describe('Sidebar session bulk delete', () => {
  it('opens confirmation, allows cancel, and confirms the selected batch', () => {
    const onConfirmDelete = jest.fn();

    function Harness() {
      const [showConfirmation, setShowConfirmation] = useState(false);
      return (
        <SidebarSessionBulkActions
          isMultiSelectMode
          setIsMultiSelectMode={() => undefined}
          selectedSessions={new Set(['session-a', 'session-b'])}
          setSelectedSessions={() => undefined}
          ungroupedSessions={[]}
          handleSelectAll={() => undefined}
          handleBatchDelete={() => setShowConfirmation(true)}
          showBatchDeleteConfirm={showConfirmation}
          setShowBatchDeleteConfirm={setShowConfirmation}
          handleConfirmBatchDelete={() => {
            onConfirmDelete();
            setShowConfirmation(false);
          }}
          renderSidebarModal={(isOpen, content) => (isOpen ? content : null)}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: t('common.delete') }));
    expect(screen.getByRole('heading', { name: t('sidebar.deleteChats') })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
    expect(screen.queryByRole('heading', { name: t('sidebar.deleteChats') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('common.delete') }));
    const deleteButtons = screen.getAllByRole('button', { name: t('common.delete') });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: t('sidebar.deleteChats') })).toBeNull();
  });
});
