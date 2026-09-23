/**
 * Frontend-only / MCP batch execution for StreamingToolExecutor.
 * Behavior-preserving extract (split-soon PR2 / <500).
 */

import { invoke } from '@tauri-apps/api/core';
import { useMCPStore } from '@/store/mcpStore';
import { parseMCPToolName } from '@/services/mcp/toolNormalizer';
import type { ToolResult as MCPToolResult } from '@/services/mcp/types';
import {
  DEFAULT_TOOL_EXECUTION_SOURCE,
  type ToolExecutionSource,
} from '@/services/tools/toolExecutionPolicy';
import {
  buildStructuredToolError,
  contentBlocksToString,
  finalizeToolResult,
  sanitizeMcpServerName,
  type ToolRequest,
  type ToolResult,
} from './streamingToolExecutorHelpers';

/** Execute frontend-only tools serially. */
export async function executeFrontendOnlyBatch(
  toolRequests: ToolRequest[],
  onProgress: (toolName: string) => void,
  timeoutMs: number,
  workDir?: string,
  sessionId?: string,
  source: ToolExecutionSource = DEFAULT_TOOL_EXECUTION_SOURCE,
  executionMode?: string,
): Promise<{ results: ToolResult[]; errors: ToolResult[] }> {
  const results: ToolResult[] = [];
  const errors: ToolResult[] = [];

  for (const request of toolRequests) {
    const result = await executeFrontendOnlyTool(
      request,
      timeoutMs,
      workDir,
      sessionId,
      source,
      executionMode,
    ).catch((error) => ({
      id: request.id,
      content: '',
      is_error: true,
      error_message: error instanceof Error ? error.message : 'Unknown error',
      execution_time_ms: 0,
    } satisfies ToolResult));
    onProgress(request.name);
    const finalized = finalizeToolResult(request.name, result);
    results.push(finalized);
    if (finalized.is_error) {
      errors.push(finalized);
    }
  }

  return { results, errors };
}

/** Execute a single frontend-only tool with timeout. */
export async function executeFrontendOnlyTool(
  request: ToolRequest,
  timeoutMs: number,
  _workDir?: string,
  sessionId?: string,
  source: ToolExecutionSource = DEFAULT_TOOL_EXECUTION_SOURCE,
  executionMode?: string,
): Promise<ToolResult> {
  const startTime = Date.now();

  if (request.name.startsWith('mcp__')) {
    return executeMCPTool(request, startTime, timeoutMs, sessionId, source, executionMode);
  }

  try {
    throw new Error(`Frontend-only executor received unsupported tool: ${request.name}`);
  } catch (error) {
    const executionTime = Date.now() - startTime;
    return {
      id: request.id,
      content: buildStructuredToolError(request.name, request.arguments, error),
      is_error: true,
      error_message: error instanceof Error ? error.message : undefined,
      execution_time_ms: executionTime,
    };
  }
}

/** Execute an MCP tool by resolving the server from store. */
export async function executeMCPTool(
  request: ToolRequest,
  startTime: number,
  timeoutMs: number,
  sessionId?: string,
  source: ToolExecutionSource = DEFAULT_TOOL_EXECUTION_SOURCE,
  executionMode?: string,
): Promise<ToolResult> {
  const parsed = parseMCPToolName(request.name);
  if (!parsed) {
    const errorMessage = `Invalid MCP tool name: ${request.name}`;
    return {
      id: request.id,
      content: buildStructuredToolError(
        request.name,
        request.arguments,
        new Error(errorMessage),
        'tool_not_found',
      ),
      is_error: true,
      error_message: errorMessage,
      execution_time_ms: 0,
    };
  }

  const { runtimes } = useMCPStore.getState();
  const runtime = runtimes.find(r => sanitizeMcpServerName(r.name) === parsed.serverName);

  if (!runtime) {
    const errorMessage = `MCP server '${parsed.serverName}' is not connected`;
    return {
      id: request.id,
      content: buildStructuredToolError(
        request.name,
        request.arguments,
        new Error(errorMessage),
        'transient_failure',
      ),
      is_error: true,
      error_message: errorMessage,
      execution_time_ms: Date.now() - startTime,
    };
  }

  try {
    const mcpResult = await Promise.race([
      invoke<MCPToolResult>('mcp_call_tool', {
        serverId: runtime.id,
        toolName: parsed.toolName,
        args: request.arguments,
        sessionId: sessionId ?? null,
        approvalToken: request.approvalToken ?? null,
        source,
        executionMode: executionMode ?? null,
        mcpToolName: request.name,
        toolCallId: request.id,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP tool timeout: ${request.name}`)),
          timeoutMs,
        )
      ),
    ]);

    return {
      id: request.id,
      content: contentBlocksToString(mcpResult.content),
      is_error: mcpResult.is_error,
      execution_time_ms: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'MCP tool execution failed';
    return {
      id: request.id,
      content: buildStructuredToolError(
        request.name,
        request.arguments,
        new Error(errorMessage),
        'transient_failure',
      ),
      is_error: true,
      error_message: errorMessage,
      execution_time_ms: Date.now() - startTime,
    };
  }
}
