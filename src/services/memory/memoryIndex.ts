/**
 * Memory Index
 *
 * Manages the MEMORY.md entrypoint file.
 * - Build template
 * - Read/parse index entries
 * - Truncate to prevent prompt explosion (200 lines / 25KB)
 * - Add/update index entries
 *
 * Based on Claude Code's src/memdir/memdir.ts
 */

import { invoke } from '@tauri-apps/api/core';

const MAX_ENTRYPOINT_LINES = 200;
const MAX_ENTRYPOINT_BYTES = 25_000;

export interface MemoryIndexEntry {
  filename: string;
  description: string;
  path: string;
}

/**
 * Build the MEMORY.md content template.
 */
export function buildMemoryTemplate(memoryDir: string): string {
  return `# Auto Memory

You have a persistent, file-based memory system at \`${memoryDir}\`. Write to it directly.

## Memory Types

- **Project Info**: Tech stack, architecture, key decisions
- **User Preferences**: Coding style, tool preferences, communication preferences
- **External Context**: API endpoints, deployment info, third-party services
- **Collaboration Rules**: Team conventions, review processes, release cycles

## What NOT to Save

- Information already in source code or config files
- Temporary or session-specific details
- Information that changes frequently
- Sensitive data (API keys, passwords, tokens)

## How to Save Memories

1. Write a new markdown file in \`topic-memories/\` with a descriptive name
2. Add a one-line index entry to this file in the format: \`- [filename](topic-memories/filename.md): brief description\`
3. Keep descriptions concise but informative

## How to Search Past Context

1. Read this file first to see what memories exist
2. Read specific topic files for detailed information
3. Update outdated entries by editing the index line or the topic file

## Current Index

`;
}

/**
 * Read and parse the MEMORY.md index file.
 */
export async function readMemoryIndex(memoryDir: string): Promise<MemoryIndexEntry[]> {
  const entrypointPath = `${memoryDir}/MEMORY.md`;

  try {
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    const content = result.content;

    // Parse index entries from the "## Current Index" section
    const entries: MemoryIndexEntry[] = [];
    const indexSection = content.split('## Current Index')[1];
    if (!indexSection) return entries;

    const lines = indexSection.split('\n').filter(Boolean);
    for (const line of lines) {
      // Parse: - [filename.md](topic-memories/filename.md): description
      const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\):\s*(.+)$/);
      if (match) {
        entries.push({
          filename: match[1],
          path: match[2],
          description: match[3].trim(),
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Truncate entrypoint content to prevent prompt explosion.
 */
export function truncateEntrypointContent(content: string): {
  content: string;
  lineCount: number;
  byteCount: number;
  wasTruncated: boolean;
} {
  const lines = content.split('\n');
  let byteCount = 0;
  const truncatedLines: string[] = [];

  for (let i = 0; i < Math.min(lines.length, MAX_ENTRYPOINT_LINES); i++) {
    const line = lines[i] + (i < lines.length - 1 ? '\n' : '');
    if (byteCount + line.length > MAX_ENTRYPOINT_BYTES) {
      break;
    }
    truncatedLines.push(lines[i]);
    byteCount += line.length;
  }

  return {
    content: truncatedLines.join('\n'),
    lineCount: truncatedLines.length,
    byteCount,
    wasTruncated: lines.length > MAX_ENTRYPOINT_LINES || byteCount >= MAX_ENTRYPOINT_BYTES,
  };
}

/**
 * Add a new entry to the MEMORY.md index.
 */
export async function addMemoryIndexEntry(
  memoryDir: string,
  filename: string,
  description: string,
): Promise<void> {
  const entrypointPath = `${memoryDir}/MEMORY.md`;
  const newEntry = `- [${filename}](topic-memories/${filename}): ${description}`;

  try {
    // Read existing content
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    let content = result.content;

    // If file doesn't exist or is empty, create with template
    if (!content || !content.includes('## Current Index')) {
      content = buildMemoryTemplate(memoryDir);
    }

    // Check if entry already exists
    if (content.includes(`[${filename}]`)) {
      // Update existing entry
      const regex = new RegExp(`^- \\[${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\): .+$`, 'm');
      content = content.replace(regex, newEntry);
    } else {
      // Append new entry
      content = content.trimEnd() + '\n' + newEntry + '\n';
    }

    // Write back
    await invoke('write_file', { path: entrypointPath, content });
  } catch (e) {
    console.error('Failed to update memory index:', e);
  }
}

/**
 * Read the full MEMORY.md content (truncated).
 */
export async function readMemoryEntrypoint(memoryDir: string): Promise<string> {
  const entrypointPath = `${memoryDir}/MEMORY.md`;

  try {
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    const truncated = truncateEntrypointContent(result.content);
    return truncated.content;
  } catch {
    return '';
  }
}
