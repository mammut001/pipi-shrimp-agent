/**
 * Memory Types
 *
 * Defines the 4 memory categories used by auto-extraction.
 * Based on Claude Code's src/memdir/memoryTypes.ts
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryFile {
  /** Absolute path to the file */
  path: string;
  /** Filename only, e.g. "user-go-expert.md" */
  filename: string;
  type: MemoryType;
  title: string;
  created: string;
  /** First ~300 chars of body content */
  preview: string;
}

/**
 * A memory extracted from conversation, ready to be persisted.
 */
export interface ExtractedMemory {
  /** e.g. "user-senior-go-engineer.md" */
  filename: string;
  type: MemoryType;
  title: string;
  /** Full markdown body (without frontmatter) */
  content: string;
  /** One-line summary for MEMORY.md index */
  summary: string;
}

/**
 * Result returned by the LLM extraction agent.
 */
export interface ExtractionAgentResult {
  memories: ExtractedMemory[];
}

// ============================================================================
// Type metadata — used for prompts
// ============================================================================

export const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, {
  description: string;
  whenToSave: string;
}> = {
  user: {
    description: "Information about the user's role, goals, responsibilities, knowledge, and preferences.",
    whenToSave: "When you learn details about the user's background, technical level, or preferences.",
  },
  feedback: {
    description: "Corrections and confirmations from the user (what to do / not do).",
    whenToSave: "When the user corrects a mistake or confirms an approach.",
  },
  project: {
    description: "Project-specific state: goals, architecture decisions, key bugs, deadlines.",
    whenToSave: "When you learn important facts about the project that will recur across sessions.",
  },
  reference: {
    description: "Pointers to external systems (Linear, Slack, GitHub, docs URLs, etc.).",
    whenToSave: "When you learn about an external resource that will be referenced repeatedly.",
  },
};

/**
 * Build frontmatter for a memory file.
 */
export function buildMemoryFrontmatter(type: MemoryType, title: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `---\ntype: ${type}\ntitle: ${title}\ncreated: ${date}\n---\n\n`;
}

/**
 * Parse frontmatter from a memory file.
 * Returns null if no frontmatter found.
 */
export function parseMemoryFrontmatter(content: string): {
  type: MemoryType;
  title: string;
  created: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const type = fm.match(/^type:\s*(.+)$/m)?.[1]?.trim() as MemoryType;
  const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const created = fm.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? '';

  if (!type || !MEMORY_TYPE_DESCRIPTIONS[type]) return null;

  return { type, title, created };
}

/**
 * Slugify a string for use in filenames.
 * e.g. "Senior Go Engineer, New to React" → "senior-go-engineer-new-to-react"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Build a canonical memory filename.
 * e.g. type="user", title="Senior Go Engineer" → "user-senior-go-engineer.md"
 */
export function buildMemoryFilename(type: MemoryType, title: string): string {
  return `${type}-${slugify(title)}.md`;
}
