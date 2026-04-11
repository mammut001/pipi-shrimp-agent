/**
 * Extraction Prompts
 *
 * Builds the system/user prompts for the memory-extraction mini-agent.
 * Based on Claude Code's src/services/extractMemories/prompts.ts
 */

import { MEMORY_TYPE_DESCRIPTIONS } from './memoryTypes';

// ============================================================================
// Types section (injected into prompt)
// ============================================================================

function buildTypesSection(): string {
  const entries = Object.entries(MEMORY_TYPE_DESCRIPTIONS)
    .map(([name, meta]) =>
      `<type>\n  <name>${name}</name>\n  <description>${meta.description}</description>\n  <when_to_save>${meta.whenToSave}</when_to_save>\n</type>`
    )
    .join('\n');

  return `## Types of memory\n\n<types>\n${entries}\n</types>`;
}

const WHAT_NOT_TO_SAVE = `## What NOT to save

- Code patterns, conventions, architecture — these can be derived from source code
- Git history — git log is authoritative
- Debugging solutions — the fix is in the code
- Ephemeral task details (one-off commands, file paths specific to this session)
- Sensitive data (API keys, passwords, tokens)`;

// ============================================================================
// How to save section
// ============================================================================

function buildHowToSaveSection(memoryDir: string, includeIndex: boolean): string {
  if (!includeIndex) {
    return `## How to save memories

Write each memory to its own file inside \`${memoryDir}/\`.
Use the naming convention: \`{type}-{slug}.md\`, e.g. \`user-senior-go-engineer.md\`.

Each file MUST start with YAML frontmatter:
\`\`\`
---
type: <user|feedback|project|reference>
title: <Short descriptive title>
created: <YYYY-MM-DD>
---
\`\`\`

Followed by markdown content with sections like:
- **## Background** — context
- **## How to use** — when/how this memory applies
- **## Why** — why it matters`;
  }

  return `## How to save memories

Saving a memory is a two-step process.

**Step 1** — Write the memory body to \`${memoryDir}/{type}-{slug}.md\`.
The filename convention is \`{type}-{slug}.md\` where type is one of: user, feedback, project, reference.

Each file MUST start with YAML frontmatter:
\`\`\`
---
type: <user|feedback|project|reference>
title: <Short descriptive title>
created: <YYYY-MM-DD>
---
\`\`\`

Followed by markdown sections like:
- **## Background** — context
- **## How to use** — when/how this memory applies
- **## Why** — why it matters

**Step 2** — Add a line to \`${memoryDir}/MEMORY.md\` under \`## Current Index\`:
\`\`\`
- [Title](filename.md) — one-line description
\`\`\``;
}

// ============================================================================
// Main prompt builder
// ============================================================================

/**
 * Build the extraction prompt for the mini-agent.
 *
 * @param newMessageCount  number of new messages since last extraction
 * @param existingMemories formatted manifest from formatMemoryManifest()
 * @param memoryDir        absolute path to the memory directory
 */
export function buildExtractAutoOnlyPrompt(
  newMessageCount: number,
  existingMemories: string,
  memoryDir: string,
): string {
  const existingSection = existingMemories.length > 0
    ? `\n\n## Existing memory files\n\n${existingMemories}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
    : '';

  const opener = [
    `You are now acting as the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages above and use them to update the persistent memory system.`,
    '',
    `You have a limited turn budget. Efficient strategy: issue all reads in parallel first, then all writes in parallel.`,
    '',
    `ONLY use content from the last ~${newMessageCount} messages. Do not attempt to investigate source code or run external commands.${existingSection}`,
  ].join('\n');

  return [
    opener,
    '',
    'If the user explicitly asked you to remember something, save it immediately.',
    '',
    buildTypesSection(),
    '',
    WHAT_NOT_TO_SAVE,
    '',
    buildHowToSaveSection(memoryDir, true),
  ].join('\n');
}

// ============================================================================
// System prompt for the mini-agent
// ============================================================================

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant.
Your job is to analyse a conversation and persist important long-term facts to the user's memory directory.
Return ONLY valid JSON — no markdown fences, no commentary.

Schema:
{
  "memories": [
    {
      "filename": "user-senior-go-engineer.md",
      "type": "user",
      "title": "Senior Go Engineer, New to React",
      "content": "## Background\\n...",
      "summary": "Senior Go engineer, 10 years experience, new to this React frontend"
    }
  ]
}

If there is nothing worth saving, return: {"memories": []}`;
