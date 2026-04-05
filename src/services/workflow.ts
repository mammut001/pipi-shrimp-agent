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
  /** Create an isolated run directory, returns the absolute path */
  createRunDirectory: (runId: string) =>
    invoke<string>('create_workflow_run_directory', { runId }),

  /** List files (and dirs) under a path. Uses the existing `list_files` command. */
  listDirectory: (path: string) =>
    invoke<FileInfo[]>('list_files', { path, pattern: null, workDir: null }),

  /** Read a text file, returns { content, path } */
  readFile: (path: string) =>
    invoke<{ content: string; path: string }>('read_file', { path, workDir: null }),

  /** Write a text file, returns the resolved path */
  writeFile: (path: string, content: string) =>
    invoke<string>('write_file', { path, content, workDir: null }),
};
