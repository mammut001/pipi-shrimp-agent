/**
 * Project Folder bind UX — dialog title / busy helpers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import enUS from '@/i18n/locales/en-US';
import {
  FOLDER_DIALOG_BUSY_ERROR,
  FOLDER_DIALOG_TITLE,
  folderDialogTitle,
  isFolderDialogBusyError,
} from '../folderDialog';

describe('folderDialog helpers', () => {
  it('exposes distinct titles for project vs output pickers', () => {
    expect(folderDialogTitle('project')).toBe('Select Project Folder');
    expect(folderDialogTitle('output')).toBe('Select PiPi Output Folder');
    expect(FOLDER_DIALOG_TITLE.project).not.toBe(FOLDER_DIALOG_TITLE.output);
  });

  it('keeps English i18n dialog titles aligned with native picker titles', () => {
    expect(enUS['chat.selectProjectFolderDialog']).toBe(FOLDER_DIALOG_TITLE.project);
    expect(enUS['chat.selectPipiOutputFolderDialog']).toBe(FOLDER_DIALOG_TITLE.output);
  });

  it('detects folder_dialog_busy from string or Error-like objects', () => {
    expect(isFolderDialogBusyError(FOLDER_DIALOG_BUSY_ERROR)).toBe(true);
    expect(isFolderDialogBusyError(`error: ${FOLDER_DIALOG_BUSY_ERROR}`)).toBe(true);
    expect(isFolderDialogBusyError({ message: FOLDER_DIALOG_BUSY_ERROR })).toBe(true);
    expect(isFolderDialogBusyError('cancelled')).toBe(false);
    expect(isFolderDialogBusyError(null)).toBe(false);
  });
});

describe('createChatStore dialog wiring (source contract)', () => {
  it('opens the native picker with titled project/output invokes and busy handling', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../store/createChatStore.ts'),
      'utf8',
    );
    expect(source).toMatch(/open_folder_dialog/);
    expect(source).toMatch(/folderDialogTitle\('project'\)/);
    expect(source).toMatch(/folderDialogTitle\('output'\)/);
    expect(source).toMatch(/isFolderDialogBusyError/);
    expect(source).toMatch(/FOLDER_DIALOG_BUSY_ERROR/);
  });
});
