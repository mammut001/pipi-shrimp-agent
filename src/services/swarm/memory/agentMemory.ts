/**
 * Agent Memory
 *
 * Template and utilities for agent-level private memory.
 * Each agent has its own memory directory that only it can read/write.
 */

/**
 * Build the MEMORY.md template for agent memory.
 */
export function buildAgentMemoryTemplate(memoryDir: string): string {
  return `# Agent Memory

This is your personal memory. Write here to remember task context, tools, and preferences.

Memory directory: \`${memoryDir}\`

## Memory Types

- **user**: User's role, goals, preferences
- **feedback**: Corrections and confirmations from the team
- **project**: Project-specific state and decisions
- **reference**: External resources and documentation

## What NOT to Save

- Sensitive data (API keys, passwords, tokens)
- Ephemeral task details specific to one session
- Information already saved in team memory

## How to Save Memories

1. Write a new markdown file in \`topic-memories/\` with a descriptive name
2. Add an entry to this file's index: \`- [filename](topic-memories/filename.md): description\`
3. Keep descriptions concise

## Current Index

`;
}
