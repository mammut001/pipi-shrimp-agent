/**
 * Default Prompt Template
 *
 * Defines the default 6-layer prompt structure that mirrors
 * Claude Code's system prompt layering.
 */

import type { PromptTemplate, PromptSection } from '../../types/prompt';

export function createDefaultTemplate(): PromptTemplate {
  return {
    id: 'default',
    name: 'Default',
    description: 'Default prompt template with 6 layers',
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sections: [
      // Layer 0: Default (base rules, always cached)
      {
        id: 'default-rules',
        label: 'Base Rules',
        order: 0,
        cacheable: true,
        enabled: true,
        category: 'default',
        description: 'Core system rules: tool declarations, format guidelines',
        content: `You are a powerful AI agent capable of helping users with complex tasks.

## Available Tools

You have access to the following tools:
- read_file: Read file contents
- write_file: Write content to a file
- list_files: List directory contents
- create_directory: Create a new directory
- path_exists: Check if a path exists
- search_files: Search for text patterns using ripgrep
- Skill: Execute a predefined skill (e.g., 'resume' for resume generation)

## Guidelines

1. Always read files before editing them
2. Use absolute paths when possible
3. Be concise and direct in your responses
4. When making changes, explain what you changed and why
5. If a tool fails, try to understand why and suggest alternatives`,
      },

      // Layer 3: Custom (user instructions, cached until user edits)
      {
        id: 'custom-instructions',
        label: 'Custom Instructions',
        order: 30,
        cacheable: true,
        enabled: true,
        category: 'custom',
        description: 'User-defined custom instructions (agentInstructions)',
        content: `{{agentInstructions}}`,
      },

      // Layer 4: Session - Working Directory (cached until workDir changes)
      {
        id: 'session-workdir',
        label: 'Working Directory',
        order: 40,
        cacheable: true,
        enabled: true,
        category: 'session',
        description: 'Session work directory context',
        content: `## Working Directory

Your working directory for this session is: \`{{workDir}}\`
Use this path with \`bash\`, \`read_file\`, \`write_file\`, \`list_files\`, and \`grep\` tools. Resolve all relative paths against this directory.`,
      },

      // Layer 4: Session - Project Core Memory (cached until core.md changes)
      {
        id: 'session-core-md',
        label: 'Project Core Memory',
        order: 41,
        cacheable: true,
        enabled: true,
        category: 'session',
        description: 'Project core memory from .pipi-shrimp/core.md',
        content: `## Project Core Memory (.pipi-shrimp/core.md)

{{coreMdContent}}

**CRITICAL INSTRUCTION**: The user relies on \`.pipi-shrimp/core.md\` to preserve project context between sessions. If the user tells you new persistent information about the project (e.g., what it is, tech stack, architecture, or rules), you MUST use the \`write_file\` tool to update \`.pipi-shrimp/core.md\` immediately so you don't forget it in future sessions. Combine the new knowledge with the existing content gracefully.`,
      },

      // Layer 4: Session - Working Files (cached until files change)
      {
        id: 'session-working-files',
        label: 'Working Files',
        order: 42,
        cacheable: true,
        enabled: true,
        category: 'session',
        description: 'Session-level working files',
        content: `## Working Files

The following files have been added to this session's context:
{{workingFilesList}}

Use \`read_file\` with the exact paths above to read their contents before editing.`,
      },

      // Layer 4: Session - Relevant Memories (cached until memory context changes)
      {
        id: 'session-memory-context',
        label: 'Relevant Memories',
        order: 43,
        cacheable: true,
        enabled: true,
        category: 'session',
        description: 'Relevant project memories recalled for this query',
        content: `{{memoryContext}}`,
      },

      // Layer 4: Session - Document System (cached)
      {
        id: 'session-docs-system',
        label: 'Document System',
        order: 44,
        cacheable: true,
        enabled: true,
        category: 'session',
        description: 'Document management system for organized note-taking',
        content: `## 📄 Document System

This project has a built-in document management system for organizing your work.

**When the user asks you to create documentation, design docs, analysis, or any written material:**

1. **Auto-save to docs**: Save all generated documents to \`.pipi-shrimp/docs/\` with sequential numbering (001, 002, etc.)
2. **Filename format**: \`{number}_{slug}.md\` (e.g., \`003_readme-design.md\`)
3. **Always update INDEX.md**: The index file tracks all documents automatically
4. **Frontmatter**: Include title, created date, tags, and summary in each document

**Example user requests that should trigger document creation:**
- "帮我写一个设计文档" → Create \`.pipi-shrimp/docs/00X_design-document.md\`
- "Analyze the code structure" → Create document in \`.pipi-shrimp/docs/\`
- "整理一下 API 文档" → Create document in \`.pipi-shrimp/docs/00X_api-documentation.md\`
- "帮我写一份简历" → **MUST IMMEDIATELY** use the \`Skill\` tool with \`skill: "resume"\` to learn how to generate a professional resume artifact. **DO NOT ask the user for information first. Call the Skill tool first.**

**Document storage location**: \`{workDir}/.pipi-shrimp/docs/\`

Use the \`write_file\` tool to create documents with this structure:
\`\`\`
---
title: Document Title
created: 2026-04-07T10:00:00Z
tags: [tag1, tag2]
summary: Brief description
---

# Document Title

Content here...
\`\`\``,
      },

      // Layer 5: Append - Browser Result (never cached, dynamic)
      {
        id: 'append-browser-result',
        label: 'Browser Result',
        order: 50,
        cacheable: false,
        enabled: false,
        category: 'append',
        description: 'Dynamic browser result injection (enabled by generateBrowserResultResponse)',
        content: `---
## Browser Agent Task Result

User's question: "{{originalQuery}}"

Browser agent data:
{{browserResult}}

Please answer the user's question directly based on the data above. Do not mention "browser agent" or internal processes. Just give the answer naturally.`,
      },
    ],
  };
}

export const DEFAULT_SECTIONS: PromptSection[] = createDefaultTemplate().sections;
