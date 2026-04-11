/**
 * Team Memory
 *
 * Template and utilities for team-level shared memory.
 * All team agents can read team memory; only the leader can write.
 */

import type { TeamMemoryType } from '../types';

/**
 * Build the MEMORY.md template for team memory.
 */
export function buildTeamMemoryTemplate(memoryDir: string): string {
  return `# Team Memory

You are part of a team. Write to this shared memory to share knowledge with teammates.

Memory directory: \`${memoryDir}\`

## Memory Types

- **goal**: Team objectives and milestones
- **convention**: Team coding standards, review processes
- **context**: Shared project context visible to all agents
- **decision**: Architecture and design decisions

## What NOT to Save

- Sensitive data (API keys, passwords, tokens)
- Ephemeral task details specific to one session
- Information already in source code or config files

## How to Save Memories

1. Write a new markdown file in \`topic-memories/\` with a descriptive name
2. Add an entry to this file's index: \`- [filename](topic-memories/filename.md): description\`
3. Keep descriptions concise

## Current Index

`;
}

/**
 * Descriptions for team memory types (used in extraction prompts).
 */
export const TEAM_MEMORY_TYPE_DESCRIPTIONS: Record<TeamMemoryType, {
  description: string;
  whenToSave: string;
}> = {
  goal: {
    description: 'Team objectives, milestones, and success criteria.',
    whenToSave: 'When the team receives new objectives or adjusts existing goals.',
  },
  convention: {
    description: 'Team coding standards, review processes, and collaboration rules.',
    whenToSave: 'When the team establishes or modifies coding conventions or processes.',
  },
  context: {
    description: 'Shared project context that all agents need to know.',
    whenToSave: 'When important project-wide context is discovered or changes.',
  },
  decision: {
    description: 'Architecture and design decisions made by the team.',
    whenToSave: 'When significant technical decisions are made that affect multiple agents.',
  },
};

/**
 * Slugify a string for use in team memory filenames.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Build a canonical team memory filename.
 * e.g. type="goal", title="MVP Launch Plan" → "goal-mvp-launch-plan.md"
 */
export function buildTeamMemoryFilename(type: TeamMemoryType, title: string): string {
  return `${type}-${slugify(title)}.md`;
}

/**
 * Build frontmatter for a team memory file.
 */
export function buildTeamMemoryFrontmatter(type: TeamMemoryType, title: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `---\ntype: ${type}\ntitle: ${title}\ncreated: ${date}\n---\n\n`;
}
