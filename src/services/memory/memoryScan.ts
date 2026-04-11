/**
 * Memory Scanner
 *
 * Scans the memory directory for existing files and builds a manifest.
 * Used by autoExtraction to avoid duplicates and enable updates.
 *
 * Based on Claude Code's src/memdir/memoryScan.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { type MemoryFile, parseMemoryFrontmatter } from './memoryTypes';

/**
 * Scan the memory directory and return all memory files with their metadata.
 *
 * Algorithm:
 * 1. List all .md files in memoryDir (excluding MEMORY.md)
 * 2. Read each file and parse its frontmatter
 * 3. Return a MemoryFile[] sorted by created date desc
 */
export async function scanMemoryFiles(memoryDir: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];

  let entries: Array<{ name: string; path: string; is_directory: boolean }>;
  try {
    entries = await invoke<Array<{ name: string; path: string; is_directory: boolean }>>('list_files', { path: memoryDir });
  } catch {
    return [];
  }

  const filenames = entries
    .filter(e => !e.is_directory && e.name.endsWith('.md') && e.name !== 'MEMORY.md')
    .map(e => e.name);

  for (const filename of filenames) {
    const filePath = `${memoryDir}/${filename}`;
    try {
      const result = await invoke<{ content: string }>('read_file', { path: filePath });
      const content = result.content;
      const fm = parseMemoryFrontmatter(content);
      if (!fm) continue;

      // Extract preview: body text after frontmatter, first 300 chars
      const body = content.replace(/^---[\s\S]*?---\n\n?/, '');
      const preview = body.slice(0, 300).replace(/\n+/g, ' ').trim();

      files.push({
        path: filePath,
        filename,
        type: fm.type,
        title: fm.title,
        created: fm.created,
        preview,
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by created date descending (newest first)
  files.sort((a, b) => b.created.localeCompare(a.created));

  return files;
}

/**
 * Format the memory manifest for injection into the extraction prompt.
 *
 * Output example:
 *   - [Senior Go Engineer](user-senior-go-engineer.md) — user
 *   - [No Mock DB](feedback-no-mock-database.md) — feedback
 */
export function formatMemoryManifest(files: MemoryFile[]): string {
  if (files.length === 0) return '';

  return files
    .map(f => `- [${f.title}](${f.filename}) — ${f.type}`)
    .join('\n');
}

/**
 * Check if a path is inside the memory directory.
 * Used for tool permission enforcement.
 */
export function isInsideMemoryDir(candidatePath: string, memoryDir: string): boolean {
  const normalizedMemDir = memoryDir.replace(/\/$/, '');
  const normalizedCandidate = candidatePath.replace(/\/$/, '');
  return (
    normalizedCandidate === normalizedMemDir ||
    normalizedCandidate.startsWith(normalizedMemDir + '/')
  );
}

/**
 * Extract the list of memory file paths written by the LLM in its response.
 * Looks for write_file / read_file patterns in the response text.
 */
export function extractWrittenPaths(responseText: string, memoryDir: string): string[] {
  const written: string[] = [];
  // Match both absolute paths and filenames ending in .md
  const patterns = [
    new RegExp(`(${escapeRegExp(memoryDir)}/[\\w-]+\\.md)`, 'g'),
    /`([\w-]+\.md)`/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let safePattern = new RegExp(pattern.source, pattern.flags);
    while ((match = safePattern.exec(responseText)) !== null) {
      const p = match[1];
      if (!written.includes(p)) {
        written.push(p);
      }
    }
  }
  return written;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
