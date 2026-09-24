/**
 * Streaming Tool Executor
 * Provides policy-gated execution and delegates registry scheduling to Rust.
 *
 * Rust ToolRegistry/ToolScheduler is the concurrency authority. This layer
 * owns frontend integration (hooks, confirmations, MCP and legacy chat tools)
 * but does not maintain a duplicate read-only/serial tool catalog.
 */

import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/store';
import {
  DEFAULT_TOOL_EXECUTION_SOURCE,
  canAutoApproveTool,
  type ToolPolicyPreviewResult,
} from '@/services/tools/toolExecutionPolicy';
import { runPreToolUseHooks } from '@/services/tools/preToolUseHooks';
import { withWindowsShellProfileArgs } from '@/utils/windowsShellProfile';
import { BROWSER_TOOL_NAMES } from './browser/browserTools';
import { loadToolRuntimeMetadata } from '@/services/tools/toolMetadata';
import {
  buildPolicyErrorResult,
  buildStructuredToolError,
  isFrontendOnlyTool,
  type BatchExecutionResult,
  type ToolExecutionOptions,
  type ToolRequest,
  type ToolResult,
} from './streamingToolExecutorHelpers';
import { executeFrontendOnlyBatch } from './streamingToolExecutorFrontend';
import { executeNativeBatch } from './streamingToolExecutorNative';

export type {
  BatchExecutionResult,
  ToolExecutionOptions,
  ToolRequest,
  ToolResult,
} from './streamingToolExecutorHelpers';

/**
 * Streaming Tool Executor with policy/frontend integration.
 * Registry-backed scheduling is delegated to execute_tool_batch in Rust.
 */
export class StreamingToolExecutor {
  private timeoutMs: number;

  constructor(options: { concurrencyLimit?: number; timeoutMs?: number } | number = {}) {
    if (typeof options === 'number') {
      this.timeoutMs = options;
    } else {
      this.timeoutMs = options.timeoutMs ?? 300_000;
    }
  }

  /**
   * Execute tools with backend-owned registry scheduling.
   */
  async executeBatch(
    toolRequests: ToolRequest[],
    options: ToolExecutionOptions
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const {
      onProgress,
      workDir,
      sessionId,
      source = DEFAULT_TOOL_EXECUTION_SOURCE,
      permissionMode = 'standard',
      executionMode,
      allowedTools,
      requestPermission,
      browserIntent = false,
    } = options;

    if (toolRequests.length === 0) {
      return { results: [], totalExecutionTime: 0, errors: [] };
    }

    const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
    const normalizedToolRequests = toolRequests.map((request) => ({
      ...request,
      arguments: withWindowsShellProfileArgs(request.name, request.arguments, windowsShellProfile),
    }));

    let completed = 0;
    const total = normalizedToolRequests.length;

    const reportProgress = (currentTool?: string) => {
      completed++;
      onProgress?.(completed, total, currentTool);
    };

    const prevalidatedResults: ToolResult[] = [];
    const executableRequests: ToolRequest[] = [];
    const allowedToolSet = allowedTools ? new Set(allowedTools) : null;

    // Same pattern as chatToolExecution: executionId injection is driven by
    // Rust tool runtime metadata (cancellable), not a hardcoded tool-name list.
    let toolMetadataMap = new Map<string, { cancellable?: boolean }>();
    try {
      toolMetadataMap = await loadToolRuntimeMetadata();
    } catch {
      // Fail closed for cancellation: without metadata, do not inject executionId.
    }

    for (let request of normalizedToolRequests) {
      if (allowedToolSet && !allowedToolSet.has(request.name)) {
        prevalidatedResults.push(buildPolicyErrorResult(
          request,
          `Tool "${request.name}" is not allowed in this execution lane.`,
          'tool_disabled',
        ));
        reportProgress(request.name);
        continue;
      }

      const rawArgs = JSON.stringify(request.arguments);
      const hookResult = await runPreToolUseHooks({
        toolName: request.name,
        toolArgs: rawArgs,
        workDir,
        permissionMode,
        executionMode,
        sessionId,
        allowBrowserTools: allowedTools ? allowedTools.some(t => BROWSER_TOOL_NAMES.includes(t)) : true,
      });

      if (!hookResult.approved) {
        prevalidatedResults.push(buildPolicyErrorResult(
          request,
          hookResult.error || 'Tool execution blocked by policy.',
          hookResult.blockedBy === 'dangerous-command' ? 'dangerous_command' : 'permission_denied',
        ));
        reportProgress(request.name);
        continue;
      }

      if (hookResult.requiresConfirmation) {
        if (
          !canAutoApproveTool(permissionMode, request.name, { browserIntent, source })
          && !requestPermission
        ) {
          prevalidatedResults.push(buildPolicyErrorResult(
            request,
            `Tool "${request.name}" requires confirmation before execution.`,
            'confirmation_required',
          ));
          reportProgress(request.name);
          continue;
        }
      }

      if (hookResult.modifiedArgs) {
        try {
          request = {
            ...request,
            arguments: JSON.parse(hookResult.modifiedArgs) as Record<string, any>,
          };
        } catch {
          prevalidatedResults.push(buildPolicyErrorResult(
            request,
            `Tool "${request.name}" produced invalid modified arguments.`,
            'invalid_arguments',
          ));
          reportProgress(request.name);
          continue;
        }
      }

      // Keep preview/execute argument fingerprints aligned for cancellable
      // tools by assigning executionId before policy preview (same as serial path).
      const existingExecutionId = typeof request.arguments === 'object' && request.arguments
        ? (request.arguments as Record<string, unknown>).executionId
        : undefined;
      const hasExecutionId = typeof existingExecutionId === 'string'
        && existingExecutionId.trim().length > 0;
      if (
        toolMetadataMap.get(request.name)?.cancellable === true
        && typeof request.arguments === 'object'
        && request.arguments
        && !hasExecutionId
      ) {
        request = {
          ...request,
          arguments: {
            ...(request.arguments as Record<string, unknown>),
            executionId: crypto.randomUUID(),
          },
        };
      }

      const preview = await invoke<ToolPolicyPreviewResult>('preview_tool_policy', {
        toolCall: {
          id: request.id,
          name: request.name,
          arguments: JSON.stringify(request.arguments),
          workDir: workDir ?? null,
          source,
          allowedTools: allowedTools?.length ? allowedTools : null,
          approvalToken: null,
          executionMode: executionMode ?? null,
        },
        sessionId,
      });

      if (preview.decision === 'rejected') {
        prevalidatedResults.push(buildPolicyErrorResult(
          request,
          preview.reason || `Tool "${request.name}" was rejected by backend policy.`,
          'permission_denied',
        ));
        reportProgress(request.name);
        continue;
      }

      if (preview.decision === 'awaiting_confirmation') {
        if (canAutoApproveTool(permissionMode, request.name, { browserIntent, source })) {
          executableRequests.push({
            ...request,
            approvalToken: preview.approvalToken,
          });
          continue;
        }

        if (!requestPermission) {
          prevalidatedResults.push(buildPolicyErrorResult(
            request,
            preview.reason || `Tool "${request.name}" requires confirmation before execution.`,
            'confirmation_required',
          ));
          reportProgress(request.name);
          continue;
        }

        const approved = await requestPermission({
          id: request.id,
          name: request.name,
          arguments: JSON.stringify(request.arguments),
          reason: preview.reason,
          approvalToken: preview.approvalToken,
          source,
          workDir,
        });

        if (!approved) {
          prevalidatedResults.push(buildPolicyErrorResult(
            request,
            preview.reason || `Tool "${request.name}" was denied by the user.`,
            'permission_denied',
          ));
          reportProgress(request.name);
          continue;
        }

        executableRequests.push({
          ...request,
          approvalToken: preview.approvalToken,
        });
        continue;
      }

      if (
        hookResult.requiresConfirmation
        && !canAutoApproveTool(permissionMode, request.name, { browserIntent, source })
      ) {
        const approved = await requestPermission?.({
          id: request.id,
          name: request.name,
          arguments: JSON.stringify(request.arguments),
          reason: 'A frontend tool policy requires explicit approval.',
          source,
          workDir,
        });

        if (!approved) {
          prevalidatedResults.push(buildPolicyErrorResult(
            request,
            'Tool execution was denied by the user.',
            'permission_denied',
          ));
          reportProgress(request.name);
          continue;
        }
      }

      executableRequests.push(request);
    }

    const frontendOnlyRequests = executableRequests.filter((request) => isFrontendOnlyTool(request.name));
    const nativeRequests = executableRequests.filter((request) => !isFrontendOnlyTool(request.name));

    const nativeResults = await executeNativeBatch(
      nativeRequests,
      sessionId,
      reportProgress,
      this.timeoutMs,
      workDir,
      source,
      allowedTools,
      executionMode,
    );
    const frontendResults = await executeFrontendOnlyBatch(
      frontendOnlyRequests,
      reportProgress,
      this.timeoutMs,
      workDir,
      sessionId,
      source,
      executionMode,
    );

    const resultsById = new Map<string, ToolResult>();
    for (const result of [...prevalidatedResults, ...nativeResults.results, ...frontendResults.results]) {
      resultsById.set(result.id, result);
    }

    const allResults = normalizedToolRequests.map((request) => resultsById.get(request.id) ?? {
      id: request.id,
      content: buildStructuredToolError(request.name, request.arguments, new Error(`Missing tool result: ${request.name}`)),
      is_error: true,
      error_message: `Missing tool result: ${request.name}`,
      execution_time_ms: 0,
    });

    const errors = allResults.filter((result) => result.is_error);

    return {
      results: allResults,
      totalExecutionTime: Date.now() - startTime,
      errors,
    };
  }

  /** Execute tools using the legacy batch method (for compatibility). */
  async executeLegacyBatch(
    toolRequests: ToolRequest[],
    sessionId: string,
    workDir?: string,
  ): Promise<ToolResult[]> {
    const batch = await this.executeBatch(toolRequests, {
      sessionId,
      workDir,
    });

    return batch.results;
  }
}

export const defaultToolExecutor = new StreamingToolExecutor();
