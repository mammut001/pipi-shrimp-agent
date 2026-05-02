/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DatabaseHealthSection } from '../components/settings/DatabaseHealthSection';

const mockSafeInvoke = jest.fn();
const mockSaveDialog = jest.fn();
const mockAddNotification = jest.fn();
const mockReload = jest.fn();
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

jest.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => mockSaveDialog(...args),
}));

function createDiagnostics() {
  return {
    path: '/tmp/pipi/data.db',
    initialized: true,
    schema_version: 5,
    last_migration_at: 1_714_000_000,
    integrity_check: 'ok',
    file_size_bytes: 4096,
    wal_size_bytes: 512,
    backup_count: 1,
    sessions_count: 2,
    messages_count: 3,
    projects_count: 1,
    token_usage_count: 0,
    telegram_bindings_count: 0,
    telegram_tasks_count: 0,
  };
}

function createBackups() {
  return [
    {
      name: 'db-20260501-120000-v5.sqlite',
      path: '/tmp/pipi/backups/db-20260501-120000-v5.sqlite',
      created_at: 1_714_000_100,
      schema_version: 5,
      size_bytes: 4096,
    },
  ];
}

function renderSection() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(DatabaseHealthSection, { addNotification: mockAddNotification }));
  });

  return { container, root };
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('DatabaseHealthSection', () => {
  beforeEach(() => {
    mockSafeInvoke.mockReset();
    mockSaveDialog.mockReset();
    mockAddNotification.mockReset();
    mockReload.mockReset();
    jest.spyOn(window.location, 'reload').mockImplementation(mockReload);

    mockSafeInvoke.mockImplementation((command: string) => {
      switch (command) {
        case 'db_get_diagnostics':
          return Promise.resolve(createDiagnostics());
        case 'list_backups':
          return Promise.resolve(createBackups());
        case 'export_database_backup':
          return Promise.resolve('/tmp/exported.sqlite');
        case 'open_data_directory':
          return Promise.resolve('/tmp/pipi');
        case 'restore_from_backup':
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    });
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('loads diagnostics and shows the backup list modal', async () => {
    const view = renderSection();
    await flush();

    expect(view.container.textContent).toContain('diagnostics.dbHealth');
    expect(view.container.textContent).toContain('v5');
    expect(view.container.textContent).toContain('/tmp/pipi/data.db');

    act(() => {
      getButton(view.container, 'diagnostics.backupList').click();
    });

    expect(view.container.textContent).toContain('db-20260501-120000-v5.sqlite');
    expect(view.container.textContent).toContain('diagnostics.restoreBackup');
  });

  it('exports the current database backup and opens the data directory', async () => {
    mockSaveDialog.mockResolvedValue('/tmp/exported.sqlite');
    const view = renderSection();
    await flush();

    await act(async () => {
      getButton(view.container, 'diagnostics.exportBackup').click();
      await Promise.resolve();
    });
    act(() => {
      getButton(view.container, 'diagnostics.openDataDirectory').click();
    });
    await flush();

    expect(mockSaveDialog).toHaveBeenCalledTimes(1);
    expect(mockSafeInvoke).toHaveBeenCalledWith('export_database_backup', {
      path: '/tmp/exported.sqlite',
      backupPath: null,
    });
    expect(mockSafeInvoke).toHaveBeenCalledWith('open_data_directory');
  });

  it('requires CONFIRM before restoring a backup', async () => {
    jest.useFakeTimers();
    const view = renderSection();
    await flush();

    act(() => {
      getButton(view.container, 'diagnostics.backupList').click();
    });
    act(() => {
      getButton(view.container, 'diagnostics.restoreBackup').click();
    });

    const confirmButton = getButton(view.container, 'common.confirm');
    expect(confirmButton.disabled).toBe(true);

    const input = view.container.querySelector('input[placeholder="diagnostics.restorePlaceholder"]') as HTMLInputElement;
    act(() => {
      input.value = 'CONFIRM';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(getButton(view.container, 'common.confirm').disabled).toBe(false);

    await act(async () => {
      getButton(view.container, 'common.confirm').click();
      await Promise.resolve();
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith('restore_from_backup', {
      backupPath: '/tmp/pipi/backups/db-20260501-120000-v5.sqlite',
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});