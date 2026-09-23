/**
 * Pure helpers + shared types for StreamingToolExecutor.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import type { ContentBlock } from '@/services/mcp/types';
import { sanitizeToolExecutionContent } from '@/services/tools/outputSanitizer';
import {
  type PermissionMode,
  type ToolExecutionSource,
} from '@/services/tools/toolExecutionPolicy';

/** Convert MCP ContentBlock array to a plain string for tool output */
export function contentBlocksToString(blocks: ContentBlock[]): string {
  return blocks
    .map(block => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'image') return `[image: ${block.mime_type ?? 'unknown'}]`;
      if (block.type === 'resource') return `[resource: ${block.uri ?? 'unknown'}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Sanitize a string for use in a normalized MCP tool name (must mirror toolNormalizer.ts) */
export const sanitizeMcpServerName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface ToolRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
  approvalToken?: string;
}

export interface ToolResult {
  id: string;
  content: string;
  is_error: boolean;
  /** Authoritative Rust terminal status when present (`success`/`failed`/...). */
  status?: string;
  terminal_status?: string;
  error_code?: string | null;
  error_message?: string;
  execution_time_ms?: number;
  output_truncated?: boolean;
  sanitized?: boolean;
  original_length?: number;
}

export interface ToolExecutionOptions {
  sessionId: string;
  workDir?: string;
  source?: ToolExecutionSource;
  permissionMode?: PermissionMode;
  /**
   * Optional execution mode id. When provided, the preToolUseHooks
   * executionModeGuardCheck enforces the mode registry policy on top of
   * PermissionMode.
   */
  executionMode?: string;
  allowedTools?: string[];
  requestPermission?: (request: {
    id: string;
    name: string;
    arguments: string;
    reason?: string;
    approvalToken?: string;
    source: ToolExecutionSource;
    workDir?: string;
  }) => Promise<boolean>;
  onProgress?: (completed: number, total: number, currentTool?: string) => void;
  concurrencyLimit?: number;
  timeoutMs?: number;
  /** When true, browser mutation tools auto-approve in Agent mode. */
  browserIntent?: boolean;
}

export interface BatchExecutionResult {
  results: ToolResult[];
  totalExecutionTime: number;
  errors: ToolResult[];
}

export interface StructuredToolErrorPayload {
  error: true;
  error_kind: string;
  message: string;
  tool: string;
  path?: string;
  cause: string;
}

export function buildStructuredToolError(
  toolName: string,
  args: Record<string, any>,
  error: unknown,
  fallbackKind = 'transient_failure',
): string {
  const cause = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error);
  const payload: StructuredToolErrorPayload = {
    error: true,
    error_kind: fallbackKind,
    message: cause || `Tool execution failed: ${toolName}`,
    tool: toolName,
    cause: cause || 'Unknown tool execution error',
  };

  if (typeof args.path === 'string' && args.path.trim()) {
    payload.path = args.path;
  }

  return JSON.stringify(payload);
}

export function buildPolicyErrorResult(
  request: ToolRequest,
  message: string,
  errorKind = 'permission_denied',
): ToolResult {
  const content = JSON.stringify({
    error: true,
    error_kind: errorKind,
    message,
    tool: request.name,
    cause: message,
  });
  const sanitized = sanitizeToolExecutionContent(request.name, content);
  return {
    id: request.id,
    content: sanitized.content,
    is_error: true,
    error_message: message,
    execution_time_ms: 0,
    output_truncated: sanitized.outputTruncated,
    sanitized: sanitized.sanitized,
    original_length: sanitized.originalLength,
  };
}

export function finalizeToolResult(
  toolName: string,
  result: ToolResult,
): ToolResult {
  const sanitizedContent = sanitizeToolExecutionContent(toolName, result.content ?? '');
  const sanitizedError = result.error_message
    ? sanitizeToolExecutionContent(toolName, result.error_message)
    : null;
  return {
    ...result,
    content: sanitizedContent.content,
    error_message: sanitizedError?.content ?? result.error_message,
    output_truncated: sanitizedContent.outputTruncated || sanitizedError?.outputTruncated || false,
    sanitized: sanitizedContent.sanitized || sanitizedError?.sanitized || false,
    original_length: sanitizedContent.originalLength,
  };
}

const FRONTEND_ONLY_TOOLS = new Set<string>();

export function isFrontendOnlyTool(toolName: string): boolean {
  return toolName.startsWith('mcp__') || FRONTEND_ONLY_TOOLS.has(toolName);
}
