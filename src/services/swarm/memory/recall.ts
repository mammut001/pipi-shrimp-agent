/**
 * Swarm Memory Recall
 *
 * Reads memory indexes and builds prompt sections for injection
 * into agent system prompts.
 *
 * Reuses patterns from memoryIndex.ts (truncation, index parsing).
 */

import { invoke } from '@tauri-apps/api/core';
import { truncateEntrypointContent, type MemoryIndexEntry } from '../../memory/memoryIndex';
import type { AgentMemoryFile, TeamMemoryFile, TeamMemoryType } from '../types';
import { parseMemoryFrontmatter, type MemoryType } from '../../memory/memoryTypes';

// =============================================================================
// Index reading
// =============================================================================

/**
 * Read and parse a MEMORY.md index at a given directory.
 */
async function readMemoryIndexAt(memoryDir: string): Promise<MemoryIndexEntry[]> {
  const entrypointPath = `${memoryDir}/MEMORY.md`;
  try {
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    const content = result.content;
    const entries: MemoryIndexEntry[] = [];
    const indexSection = content.split('## Current Index')[1];
    if (!indexSection) return entries;

    const lines = indexSection.split('\n').filter(Boolean);
    for (const line of lines) {
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
 * Read Team Memory index entries.
 */
export async function readTeamMemoryIndex(teamMemoryDir: string): Promise<TeamMemoryFile[]> {
  const entries = await readMemoryIndexAt(teamMemoryDir);
  const files: TeamMemoryFile[] = [];

  for (const entry of entries) {
    const filePath = `${teamMemoryDir}/topic-memories/${entry.filename}`;
    try {
      const result = await invoke<{ content: string }>('read_file', { path: filePath });
      const fm = parseMemoryFrontmatter(result.content);
      const body = result.content.replace(/^---[\s\S]*?---\n\n?/, '');
      files.push({
        filename: entry.filename,
        type: (fm?.type as TeamMemoryType) || 'context',
        title: fm?.title || entry.filename,
        created: fm?.created || '',
        preview: body.slice(0, 300).replace(/\n+/g, ' ').trim(),
        path: filePath,
      });
    } catch {
      // File may not exist yet; include from index metadata only
      files.push({
        filename: entry.filename,
        type: 'context',
        title: entry.description,
        created: '',
        preview: entry.description,
        path: filePath,
      });
    }
  }

  return files;
}

/**
 * Read Agent Memory index entries.
 */
export async function readAgentMemoryIndex(agentMemoryDir: string): Promise<AgentMemoryFile[]> {
  const entries = await readMemoryIndexAt(agentMemoryDir);
  const files: AgentMemoryFile[] = [];

  for (const entry of entries) {
    const filePath = `${agentMemoryDir}/topic-memories/${entry.filename}`;
    try {
      const result = await invoke<{ content: string }>('read_file', { path: filePath });
      const fm = parseMemoryFrontmatter(result.content);
      const body = result.content.replace(/^---[\s\S]*?---\n\n?/, '');
      files.push({
        filename: entry.filename,
        type: (fm?.type as MemoryType) || 'project',
        title: fm?.title || entry.filename,
        created: fm?.created || '',
        preview: body.slice(0, 300).replace(/\n+/g, ' ').trim(),
        path: filePath,
      });
    } catch {
      files.push({
        filename: entry.filename,
        type: 'project',
        title: entry.description,
        created: '',
        preview: entry.description,
        path: filePath,
      });
    }
  }

  return files;
}

// =============================================================================
// Prompt building
// =============================================================================

/**
 * Build the Agent Memory prompt for injection into an agent's system prompt.
 */
export async function buildAgentMemoryPrompt(agentMemoryDir: string): Promise<string> {
  try {
    const entrypointPath = `${agentMemoryDir}/MEMORY.md`;
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    const truncated = truncateEntrypointContent(result.content);

    if (!truncated.content.trim()) return '';

    return [
      `# Your Memory (${agentMemoryDir})`,
      'You have a persistent, file-based memory system.',
      '',
      '## Memory Types',
      '- **user**: User role, goals, preferences',
      '- **feedback**: Corrections from team',
      '- **project**: Project state and decisions',
      '- **reference**: External resources',
      '',
      '## Current Index',
      extractIndexSection(truncated.content) || '(empty)',
    ].join('\n');
  } catch {
    return '';
  }
}

/**
 * Build the Team Memory prompt for injection into all team agents' system prompts.
 */
export async function buildTeamMemoryPrompt(teamMemoryDir: string): Promise<string> {
  try {
    const entrypointPath = `${teamMemoryDir}/MEMORY.md`;
    const result = await invoke<{ content: string }>('read_file', { path: entrypointPath });
    const truncated = truncateEntrypointContent(result.content);

    if (!truncated.content.trim()) return '';

    return [
      `# Team Memory (${teamMemoryDir})`,
      'This is your team\'s shared memory. All team members can read it.',
      '',
      '## Memory Types',
      '- **goal**: Team objectives and milestones',
      '- **convention**: Coding standards, review processes',
      '- **context**: Shared project context',
      '- **decision**: Architecture and design decisions',
      '',
      '## Current Index',
      extractIndexSection(truncated.content) || '(empty)',
    ].join('\n');
  } catch {
    return '';
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract the "## Current Index" section from MEMORY.md content.
 */
function extractIndexSection(content: string): string {
  const indexSection = content.split('## Current Index')[1];
  if (!indexSection) return '';
  return indexSection.trim();
}
