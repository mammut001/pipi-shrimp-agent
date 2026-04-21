import { invoke } from '@tauri-apps/api/core';

const AUTORESEARCH_SESSION_FILE = 'session.md';
const AUTORESEARCH_LOG_FILE = 'experiment_log.md';

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function getParentDirectory(path: string): string | null {
  const normalized = path.trim();
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx > 0 ? normalized.slice(0, idx) : null;
}

function joinPath(base: string, leaf: string): string {
  return `${trimTrailingSlash(base)}/${leaf}`;
}

export async function getAutoResearchBaseDir(): Promise<string> {
  return invoke<string>('get_app_autoresearch_dir');
}

export async function getDefaultAutoResearchSessionFilePath(): Promise<string> {
  return joinPath(await getAutoResearchBaseDir(), AUTORESEARCH_SESSION_FILE);
}

export async function getDefaultAutoResearchLogPath(): Promise<string> {
  return joinPath(await getAutoResearchBaseDir(), AUTORESEARCH_LOG_FILE);
}

export function getAutoResearchLogPathFromSessionFile(sessionFilePath: string): string | null {
  const parentDir = getParentDirectory(sessionFilePath);
  return parentDir ? joinPath(parentDir, AUTORESEARCH_LOG_FILE) : null;
}

export function getAutoResearchParentDir(path: string): string | null {
  return getParentDirectory(path);
}