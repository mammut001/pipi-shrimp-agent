/**
 * chatHelpers - Pure utility functions extracted from chatStore for testability
 *
 * These functions have no side effects and no dependency on Zustand or Tauri,
 * making them easy to unit test.
 */

import type { Session, Message, Project } from '../types/chat';

// ─── Database types ──────────────────────────────────────────────────────────

export interface DbSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string | null;
  project_id: string | null;
  model: string | null;
  work_dir?: string | null;
  working_files?: string | null;
  permission_mode?: string | null;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  attachments: string | null;
  artifacts: string | null;
  tool_calls: string | null;
  token_usage: string | null;
  created_at: number;
}

export interface DbProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  work_dir?: string;
  created_at: number;
  updated_at: number;
}

// ─── Safe JSON parse ─────────────────────────────────────────────────────────

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ─── Think content parsing ───────────────────────────────────────────────────

/**
 * Merge multiple reasoning fragments into a single display string.
 * Keeps arrival order, removes empty entries, and de-dupes identical blocks.
 */
export function mergeReasoningParts(...parts: Array<string | undefined | null>): string | undefined {
  const merged: string[] = [];

  for (const part of parts) {
    const normalized = part?.trim();
    if (!normalized) continue;
    if (!merged.includes(normalized)) {
      merged.push(normalized);
    }
  }

  return merged.length > 0 ? merged.join('\n\n') : undefined;
}

/**
 * Parse <think>...</think> tags from content.
 * Returns { content (without think tags), reasoning (merged think content) }.
 *
 * AUDIT-FIX [audit-1#3] — Tool results are appended to in-memory model context
 * via a `__TOOL_RESULT__:<id>:<body>` sentinel (see core/QueryEngine.ts). The
 * body may legitimately contain user-authored "<think>..." markup. We must not
 * strip it out, because doing so would silently mangle tool output before it
 * reaches the model. Callers that already know the input is a transport-only
 * tool result should pass `isToolResult: true` (we currently accept this via
 * an optional second parameter; the default keeps existing call sites safe).
 */
export function parseThinkContent(
  rawContent: string,
  options: { isToolResult?: boolean } = {},
): { content: string; reasoning?: string } {
  // AUDIT-FIX [audit-1#3] — Pass-through for tool result bodies: nothing in
  // here is a model-emitted <think> block, so leave the content untouched.
  if (options.isToolResult) {
    return { content: rawContent };
  }

  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const thinkingParts: string[] = [];
  let cleanContent = rawContent;

  let match;
  while ((match = thinkRegex.exec(rawContent)) !== null) {
    thinkingParts.push(match[1].trim());
  }

  // Remove all complete <think>...</think> blocks from content
  cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Handle incomplete thinking (still streaming)
  const partialThink = cleanContent.match(/<think>[\s\S]*$/);
  if (partialThink) {
    cleanContent = cleanContent.replace(/<think>[\s\S]*$/, '').trim();
  }

  // Strip orphaned </think> closing tags
  cleanContent = cleanContent.replace(/<\/think>/g, '').trim();

  return {
    content: cleanContent,
    reasoning: mergeReasoningParts(...thinkingParts),
  };
}

// ─── Tool result parsing ─────────────────────────────────────────────────────

export interface ParsedToolResult {
  toolCallId: string;
  result: string;
}

/**
 * Parse a __TOOL_RESULT__:id:content message into structured data.
 *
 * AUDIT-FIX [audit-1#3] — This parses a transport sentinel. The tool_call_id
 * format is a UUID, so we constrain the capture group to non-colon, non-whitespace
 * characters; the body can contain arbitrary text including colons. This is more
 * defensive than the previous `([^:]+)` regex, which would have truncated any
 * tool result whose id contained `:` (none currently do, but the new format
 * should not silently break if the ID scheme changes).
 */
export function parseToolResultMessage(message: Message): ParsedToolResult | null {
  if (message.role !== 'user' || !message.content.startsWith('__TOOL_RESULT__:')) {
    return null;
  }

  const match = message.content.match(/^__TOOL_RESULT__:(\S+?):([\s\S]*)$/);
  if (!match) return null;

  return {
    toolCallId: match[1],
    result: match[2],
  };
}

// ─── Build API messages ──────────────────────────────────────────────────────

export interface ApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: Message['attachments'];
  tool_calls?: Array<{ tool_call_id: string; name: string; arguments: string }>;
  tool_call_id?: string;
}

/**
 * Build API-safe messages for OpenAI-compatible endpoints.
 *
 * If an assistant message contains tool_calls, it must be followed by matching
 * tool result messages. Malformed blocks are dropped entirely.
 */
export function buildApiMessages(messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const resultMessages: Array<{ message: Message; parsed: ParsedToolResult }> = [];
      let cursor = i + 1;

      while (cursor < messages.length) {
        const parsed = parseToolResultMessage(messages[cursor]);
        if (!parsed) break;
        resultMessages.push({ message: messages[cursor], parsed });
        cursor += 1;
      }

      const resultById = new Map(resultMessages.map(({ parsed }) => [parsed.toolCallId, parsed.result]));
      const expectedIds = msg.tool_calls.map((tc) => tc.id);
      const allExpectedPresent = expectedIds.every((id) => resultById.has(id));
      const noExtraResults = resultMessages.length === expectedIds.length
        && resultMessages.every(({ parsed }) => expectedIds.includes(parsed.toolCallId));

      if (!allExpectedPresent || !noExtraResults) {
        // Drop malformed tool-call block
        i = cursor - 1;
        continue;
      }

      apiMessages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls.map((tc) => ({
          tool_call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });

      for (const toolCall of msg.tool_calls) {
        apiMessages.push({
          role: 'user',
          content: `__TOOL_RESULT__:${toolCall.id}:${resultById.get(toolCall.id) ?? ''}`,
        });
      }

      i = cursor - 1;
      continue;
    }

    const parsedToolResult = parseToolResultMessage(msg);
    if (parsedToolResult) {
      // Skip orphan tool results
      continue;
    }

    apiMessages.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    });
  }

  return apiMessages;
}

// ─── DB ↔ Frontend converters ────────────────────────────────────────────────

export function dbToSession(dbSession: DbSession, dbMessages: DbMessage[]): Session {
  return {
    id: dbSession.id,
    title: dbSession.title,
    createdAt: dbSession.created_at,
    updatedAt: dbSession.updated_at,
    cwd: dbSession.cwd || undefined,
    projectId: dbSession.project_id || undefined,
    model: dbSession.model || undefined,
    workDir: dbSession.work_dir || undefined,
    workingFiles: safeJsonParse(dbSession.working_files, undefined),
    permissionMode: (dbSession.permission_mode as Session['permissionMode']) || undefined,
    messages: dbMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      reasoning: m.reasoning || undefined,
      timestamp: m.created_at,
      attachments: safeJsonParse(m.attachments, undefined),
      artifacts: safeJsonParse(m.artifacts, undefined),
      tool_calls: safeJsonParse(m.tool_calls, undefined),
      token_usage: safeJsonParse(m.token_usage, undefined),
    })),
  };
}

export function sessionToDb(session: Session): DbSession {
  return {
    id: session.id,
    title: session.title,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    cwd: session.cwd || null,
    project_id: session.projectId || null,
    model: session.model || null,
    work_dir: session.workDir || null,
    working_files: session.workingFiles ? JSON.stringify(session.workingFiles) : null,
    permission_mode: session.permissionMode || null,
  };
}

export function messageToDb(message: Message, sessionId: string): DbMessage {
  return {
    id: message.id,
    session_id: sessionId,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning || null,
    attachments: message.attachments ? JSON.stringify(message.attachments) : null,
    artifacts: message.artifacts ? JSON.stringify(message.artifacts) : null,
    tool_calls: message.tool_calls ? JSON.stringify(message.tool_calls) : null,
    token_usage: message.token_usage ? JSON.stringify(message.token_usage) : null,
    created_at: message.timestamp,
  };
}

export function dbToProject(dbProject: DbProject): Project {
  return {
    id: dbProject.id,
    name: dbProject.name,
    createdAt: dbProject.created_at,
    updatedAt: dbProject.updated_at,
    workDir: dbProject.work_dir || undefined,
  };
}

export function projectToDb(project: Project): DbProject {
  return {
    id: project.id,
    name: project.name,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    work_dir: project.workDir,
  };
}
