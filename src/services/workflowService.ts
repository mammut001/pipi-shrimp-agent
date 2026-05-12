/**
 * Workflow IPC Service — wraps Tauri invoke calls for the workflow system.
 */

import { invoke } from '@tauri-apps/api/core';

export interface FileInfo {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified: number;
}

export const workflowService = {
  createRunDirectory: (runId: string) =>
    invoke<string>('create_workflow_run_directory', { runId }),

  listDirectory: (path: string) =>
    invoke<FileInfo[]>('list_files', { path, pattern: null, workDir: null }),

  readFile: (path: string) =>
    invoke<{ content: string; path: string }>('read_file', { path, workDir: null }),

  writeFile: (path: string, content: string) =>
    invoke<string>('write_file', { path, content, workDir: null }),
};