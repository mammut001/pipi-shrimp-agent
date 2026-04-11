/**
 * Topic Memory
 *
 * Manages individual topic memory files in the topic-memories/ directory.
 * - Scan memory files (headers only)
 * - Create new topic memory
 * - Read full topic memory content
 *
 * Based on Claude Code's memory file management
 */

import { invoke } from '@tauri-apps/api/core';

export interface TopicMemory {
  filename: string;
  title: string;
  date: string;
  category: string;
  preview: string;
  path: string;
  mtimeMs: number;
}

/**
 * Scan topic memory files and return their headers.
 * Only reads the first few lines of each file for efficiency.
 */
export async function scanTopicMemories(topicDir: string): Promise<TopicMemory[]> {
  try {
    const result = await invoke<string>('list_files', { path: topicDir });
    const files = result.split('\n').filter(Boolean);

    const memories: TopicMemory[] = [];
    for (const file of files) {
      // Strip emoji prefix if present
      const cleanName = file.replace(/^[\u{1F300}-\u{1F9FF}]\s*/u, '');
      if (!cleanName.endsWith('.md')) continue;

      const filePath = `${topicDir}/${cleanName}`;
      try {
        const contentResult = await invoke<{ content: string }>('read_file', { path: filePath });
        const content = contentResult.content;

        // Parse header (first 500 chars)
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const dateMatch = content.match(/^## Date\s*\n\s*(.+)$/m);
        const categoryMatch = content.match(/^## Category\s*\n\s*(.+)$/m);

        memories.push({
          filename: cleanName,
          title: titleMatch?.[1] || cleanName.replace('.md', ''),
          date: dateMatch?.[1] || 'Unknown',
          category: categoryMatch?.[1] || 'General',
          preview: content.slice(0, 500),
          path: filePath,
          mtimeMs: Date.now(),
        });
      } catch {
        // Skip files that can't be read
      }
    }

    return memories;
  } catch {
    return [];
  }
}

/**
 * Create a new topic memory file.
 */
export async function createTopicMemory(
  topicDir: string,
  filename: string,
  title: string,
  category: string,
  content: string,
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const fileContent = `# ${title}

## Date
${date}

## Category
${category}

## Content

${content}
`;

  const filePath = `${topicDir}/${filename}`;
  await invoke('write_file', { path: filePath, content: fileContent });
}

/**
 * Read a full topic memory file.
 */
export async function readTopicMemory(filePath: string): Promise<string> {
  const result = await invoke<{ content: string }>('read_file', { path: filePath });
  return result.content;
}

/**
 * Update an existing topic memory file.
 */
export async function updateTopicMemory(
  filePath: string,
  newContent: string,
): Promise<void> {
  const existing = await readTopicMemory(filePath);

  // Append new content under a new section
  const date = new Date().toISOString().split('T')[0];
  const updateSection = `\n\n## Update (${date})\n\n${newContent}`;

  await invoke('write_file', { path: filePath, content: existing + updateSection });
}

/**
 * Delete a topic memory file.
 */
export async function deleteTopicMemory(filePath: string): Promise<void> {
  // Note: This would need a delete_file command in Rust
  // For now, we just mark it as outdated in the index
  console.warn('deleteTopicMemory not yet implemented:', filePath);
}
