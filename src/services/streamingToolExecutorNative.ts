/**
 * Native / legacy registry batch execution for StreamingToolExecutor.
 * Behavior-preserving extract (split-soon PR2 / <500).
 */

import { invoke } from '@tauri-apps/api/core';
import { resolveActiveAgentConfig } from '@/services/agentConfig';
import {
  buildProviderExecutionCapabilities,
  resolveProviderRequestHint,
} from '@/services/llm/capabilities';
import {
  AUTORESEARCH_BOOTSTRAP_TOOL_NAMES,
} from '@/services/tools/autoresearchBootstrap';
import {
  DEFAULT_TOOL_EXECUTION_SOURCE,
  isLegacyChatOnlyTool,
  type ToolExecutionSource,
} from '@/services/tools/toolExecutionPolicy';
import {
  buildStructuredToolError,
  finalizeToolResult,
  type ToolRequest,
  type ToolResult,
} from './streamingToolExecutorHelpers';

const AUTORESEARCH_BOOTSTRAP_TOOL_SET = new Set<string>(AUTORESEARCH_BOOTSTRAP_TOOL_NAMES);

export function getBootstrapProviderContext() {
  const activeConfig = resolveActiveAgentConfig();
  if (!activeConfig) {
    return {
      activeConfig: null,
      provider: null,
      providerCapabilities: null,
    };
  }

  return {
    activeConfig,
    provider: resolveProviderRequestHint(activeConfig.provider, activeConfig.apiFormat),
    providerCapabilities: buildProviderExecutionCapabilities({
      provider: activeConfig.provider,
      apiFormat: activeConfig.apiFormat,
      model: activeConfig.model,
    }),
  };
}

/** Execute chat-scoped legacy tools outside the Rust registry. */
export async function executeLegacyChatTool(
  request: ToolRequest,
  sessionId: string,
  workDir: string | undefined,
  source: ToolExecutionSource,
  executionMode: string | undefined,
  startTime: number,
): Promise<ToolResult> {
  const content = await invoke<string>('execute_tool', {
    toolName: request.name,
    arguments: JSON.stringify(request.arguments),
    workDir: workDir ?? null,
    toolCallId: request.id,
    sessionId,
    approvalToken: request.approvalToken ?? null,
    source,
    executionMode: executionMode ?? null,
  });
  const isError = content.startsWith('Error:');
  return finalizeToolResult(request.name, {
    id: request.id,
    content,
    is_error: isError,
    error_message: isError ? content : undefined,
    execution_time_ms: Date.now() - startTime,
  } satisfies ToolResult);
}

/** Map a raw Rust batch row into a finalized ToolResult. */
export function mapNativeBatchRawResult(
  result: any,
  elapsed: number,
): ToolResult {
  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  return finalizeToolResult(result.name ?? 'unknown', {
    id: result.id,
    content,
    is_error: Boolean(result.is_error),
    status: typeof result.status === 'string' ? result.status : undefined,
    terminal_status: typeof result.terminal_status === 'string'
      ? result.terminal_status
      : undefined,
    error_code: typeof result.error_code === 'string' ? result.error_code : null,
    error_message: result.is_error ? content : undefined,
    execution_time_ms: elapsed,
  } satisfies ToolResult);
}

/** Execute Rust-backed tools via the authoritative batch scheduler. */
export async function executeNativeBatch(
  toolRequests: ToolRequest[],
  sessionId: string,
  onProgress: (toolName: string) => void,
  timeoutMs: number,
  workDir?: string,
  source: ToolExecutionSource = DEFAULT_TOOL_EXECUTION_SOURCE,
  allowedTools?: string[],
  executionMode?: string,
): Promise<{ results: ToolResult[]; errors: ToolResult[] }> {
  if (toolRequests.length === 0) {
    return { results: [], errors: [] };
  }

  const startTime = Date.now();
  const legacyRequests = toolRequests.filter((tool) => isLegacyChatOnlyTool(tool.name));
  const registryRequests = toolRequests.filter((tool) => !isLegacyChatOnlyTool(tool.name));
  const resultsById = new Map<string, ToolResult>();

  try {
    for (const request of legacyRequests) {
      const result = await executeLegacyChatTool(
        request,
        sessionId,
        workDir,
        source,
        executionMode,
        startTime,
      );
      resultsById.set(request.id, result);
      onProgress(request.name);
    }

    if (registryRequests.length > 0) {
      const { activeConfig, provider, providerCapabilities } = registryRequests.some((tool) => AUTORESEARCH_BOOTSTRAP_TOOL_SET.has(tool.name))
        ? getBootstrapProviderContext()
        : { activeConfig: null, provider: null, providerCapabilities: null };

      const rawResults = await Promise.race([
        invoke<any[]>('execute_tool_batch', {
          toolCalls: registryRequests.map((tool) => ({
            id: tool.id,
            name: tool.name,
            arguments: JSON.stringify(tool.arguments),
            workDir: workDir ?? null,
            source,
            allowedTools: allowedTools?.length ? allowedTools : null,
            approvalToken: tool.approvalToken ?? null,
            apiKey: activeConfig?.apiKey ?? null,
            model: activeConfig?.model ?? null,
            baseUrl: activeConfig?.baseUrl || null,
            provider,
            apiFormat: activeConfig?.apiFormat || null,
            providerCapabilities,
            executionMode: executionMode ?? null,
          })),
          sessionId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool batch execution timeout: ${registryRequests.map((tool) => tool.name).join(', ')}`)),
            timeoutMs * Math.max(1, registryRequests.length),
          )
        ),
      ]);

      const elapsed = Date.now() - startTime;
      for (const result of rawResults) {
        resultsById.set(result.id, mapNativeBatchRawResult(result, elapsed));
      }

      for (const request of registryRequests) {
        onProgress(request.name);
      }
    }

    const results = toolRequests.map((request) => resultsById.get(request.id) ?? finalizeToolResult(request.name, {
      id: request.id,
      content: buildStructuredToolError(request.name, request.arguments, new Error(`Missing tool result: ${request.name}`)),
      is_error: true,
      error_message: `Missing tool result: ${request.name}`,
      execution_time_ms: Date.now() - startTime,
    } satisfies ToolResult));

    return {
      errors: results.filter((result) => result.is_error),
      results,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const results = toolRequests.map((request) => {
      if (!resultsById.has(request.id)) {
        onProgress(request.name);
      }
      return resultsById.get(request.id) ?? finalizeToolResult(request.name, {
        id: request.id,
        content: buildStructuredToolError(request.name, request.arguments, error),
        is_error: true,
        error_message: message,
        execution_time_ms: elapsed,
      } satisfies ToolResult);
    });

    return { results, errors: results };
  }
}
