/**
 * Folder dialog helpers — Project Folder / PiPi Output Folder bind UX.
 *
 * The native picker is `open_folder_dialog` (GTK / OS dialog). Headless
 * / test paths should prefer `setSessionProjectDirFromPath` instead of
 * opening the dialog.
 */

export type FolderDialogKind = 'project' | 'output';

/** Native dialog titles (OS picker chrome; keep concise). */
export const FOLDER_DIALOG_TITLE = {
  project: 'Select Project Folder',
  output: 'Select PiPi Output Folder',
} as const;

/** Rust/tauri error string when a second picker is requested while one is open. */
export const FOLDER_DIALOG_BUSY_ERROR = 'folder_dialog_busy';

export function folderDialogTitle(kind: FolderDialogKind): string {
  return FOLDER_DIALOG_TITLE[kind];
}

export function isFolderDialogBusyError(error: unknown): boolean {
  if (typeof error === 'string') {
    return error.includes(FOLDER_DIALOG_BUSY_ERROR);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message).includes(FOLDER_DIALOG_BUSY_ERROR);
  }
  return false;
}
