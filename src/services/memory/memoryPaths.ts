/**
 * Memory Paths
 *
 * Calculates the memory directory for a project.
 * Priority: override > settings > default
 *
 * Based on Claude Code's src/memdir/paths.ts
 */

import { invoke } from '@tauri-apps/api/core';

function getLocalStorageItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function trimTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

async function getAppManagedMemoryProjectsDir(): Promise<string> {
  return invoke<string>('get_app_memory_projects_dir');
}

/**
 * Calculate the memory directory for a project.
 *
 * Priority: override > settings > per-session PiPi Output Folder > fallback.
 *
 * Two-folder model: callers should pass the session's **PiPi Output
 * Folder** as `pipiOutputDir` so memory lives under the app-owned root
 * (`{pipiOutputDir}/.pipi-shrimp/memory`) rather than the user's repo.
 * For backwards compatibility with callers that predate the split and
 * still pass a single project root (the legacy `workDir` field), we
 * accept `projectRoot` as a fallback and continue to place memory under
 * `${projectRoot}/.pipi-shrimp/memory`. New code should pass
 * `pipiOutputDir`.
 */
export async function getMemoryDir(
  projectRoot?: string,
  pipiOutputDir?: string,
): Promise<string> {
  // 1. Environment override (browser-safe check)
  const envVars = (globalThis as any).process?.env || {};
  const override = envVars.PIPISHRIMP_MEMORY_PATH;
  if (override) return override;

  // 2. Settings-based custom directory
  const customDir = getLocalStorageItem('pipishrimp-memory-dir');
  if (customDir) return customDir;

  // 3. PiPi Output Folder (two-folder model): prefer this when the
  // caller has explicit access to it. Memory lands in
  // `{pipiOutputDir}/.pipi-shrimp/memory`.
  if (pipiOutputDir?.trim()) {
    return `${trimTrailingSlash(pipiOutputDir)}/.pipi-shrimp/memory`;
  }

  // 4. Legacy fallback: the single-folder project root (pre-v7 callers
  // passed the user's repo here). We keep the layout for backwards
  // compatibility so existing memory survives a downgrade.
  if (projectRoot?.trim()) {
    return `${trimTrailingSlash(projectRoot)}/.pipi-shrimp/memory`;
  }

  // 5. App-managed fallback when no project root is available
  try {
    return `${await getAppManagedMemoryProjectsDir()}/default`;
  } catch {
    // Fallback if home dir can't be determined
    return '/tmp/pipi-shrimp-memory/default';
  }
}

/**
 * Sanitize a project path for use in directory names.
 */
export function sanitizeProjectName(projectPath: string): string {
  return projectPath
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 100);
}

/**
 * Get the MEMORY.md entrypoint path.
 */
export function getMemoryEntrypointPath(memoryDir: string): string {
  return `${memoryDir}/MEMORY.md`;
}

/**
 * Get the topic memories directory path.
 */
export function getTopicMemoriesDir(memoryDir: string): string {
  return `${memoryDir}/topic-memories`;
}

/**
 * Check if auto memory is enabled.
 */
export function isAutoMemoryEnabled(): boolean {
  const envVars = (globalThis as any).process?.env || {};
  const disabled = envVars.PIPISHRIMP_DISABLE_AUTO_MEMORY;
  if (disabled === 'true' || disabled === '1') return false;

  const settings = getLocalStorageItem('pipishrimp-auto-memory-enabled');
  return settings !== 'false';
}

/**
 * Ensure memory directories exist.
 */
export async function ensureMemoryDirs(memoryDir: string): Promise<void> {
  const topicDir = getTopicMemoriesDir(memoryDir);

  try {
    await invoke('create_directory', { path: memoryDir });
  } catch {
    // Directory may already exist
  }

  try {
    await invoke('create_directory', { path: topicDir });
  } catch {
    // Directory may already exist
  }
}
