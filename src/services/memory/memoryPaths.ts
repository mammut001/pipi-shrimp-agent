/**
 * Memory Paths
 *
 * Calculates the memory directory for a project.
 * Priority: override > settings > default
 *
 * Based on Claude Code's src/memdir/paths.ts
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Calculate the memory directory for a project.
 */
export async function getMemoryDir(projectRoot?: string): Promise<string> {
  // 1. Environment override (browser-safe check)
  const envVars = (globalThis as any).process?.env || {};
  const override = envVars.PIPISHRIMP_MEMORY_PATH;
  if (override) return override;

  // 2. Settings-based custom directory
  const customDir = localStorage.getItem('pipishrimp-memory-dir');
  if (customDir) return customDir;

  // 3. Default: ~/.pipi-shrimp/memory/projects/<git-root>/
  try {
    const homeDir = await invoke<string>('get_home_dir');
    const sanitizedRoot = projectRoot
      ? sanitizeProjectName(projectRoot)
      : 'default';

    return `${homeDir}/.pipi-shrimp/memory/projects/${sanitizedRoot}`;
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

  const settings = localStorage.getItem('pipishrimp-auto-memory-enabled');
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
