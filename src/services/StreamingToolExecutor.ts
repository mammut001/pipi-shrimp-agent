/**
 * Streaming Tool Executor
 * Provides concurrent execution for read-only tools and progress callbacks
 *
 * Based on Claude Code's StreamingToolExecutor.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { useMCPStore } from '@/store/mcpStore';
import { useSettingsStore } from '@/store';
import { parseMCPToolName } from '@/services/mcp/toolNormalizer';
import type { ToolResult as MCPToolResult, ContentBlock } from '@/services/mcp/types';
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
  canAutoApproveTool,
  isLegacyChatOnlyTool,
  type ToolPolicyPreviewResult,
  type PermissionMode,
  type ToolExecutionSource,
} from '@/services/tools/toolExecutionPolicy';
import { runPreToolUseHooks } from '@/services/tools/preToolUseHooks';
import { sanitizeToolExecutionContent } from '@/services/tools/outputSanitizer';
import { withWindowsShellProfileArgs } from '@/utils/windowsShellProfile';
import { BROWSER_TOOL_NAMES } from './browser/browserTools';

/** Convert MCP ContentBlock array to a plain string for tool output */
function contentBlocksToString(blocks: ContentBlock[]): string {
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
const sanitizeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

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
   * Optional 5-mode execution mode id. When provided, the preToolUseHooks
   * executionModeGuardCheck enforces the 5-mode registry policy on top of
   * the PermissionMode.
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

interface StructuredToolErrorPayload {
  error: true;
  error_kind: string;
  message: string;
  tool: string;
  path?: string;
  cause: string;
}

function buildStructuredToolError(
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

function buildPolicyErrorResult(
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

function finalizeToolResult(
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

/**
 * Read-only tools that can be executed concurrently without side effects.
 * Names must match exactly what the Rust execute_tool command accepts.
 */
const READ_ONLY_TOOLS = new Set([
  // Filesystem reads
  'read_file',
  'list_files',
  'path_exists',
  // Search — all read-only scans
  'search_files',
  'glob_search',
  'grep_files',
  // Browser observation (no DOM mutation)
  'browser_get_page',
  'browser_get_text',
  'browser_screenshot',
  'browser_extract_content',
  // Typst rendering (SVG is pure computation, no disk write)
  'render_typst_to_svg',
  // Skill loading is read-only (reads a SKILL.md file, no side effects)
  'Skill',
  'pdf_read',
  'paper_extract_meta',
  'baseline_extract',
  'arxiv_search',
]);

const AUTORESEARCH_BOOTSTRAP_TOOL_SET = new Set<string>(AUTORESEARCH_BOOTSTRAP_TOOL_NAMES);
const FRONTEND_ONLY_TOOLS = new Set<string>();

/**
 * Tools that should never be executed concurrently (explicit deny-list).
 * Unknown tools not in READ_ONLY_TOOLS are already serial by default (fail-closed),
 * so this set is only needed for documentation / extra safety belt.
 */
const SERIAL_ONLY_TOOLS = new Set([
  // Filesystem writes
  'write_file',
  'append_file',
  'create_directory',
  // Code / command execution
  'code_execution',
  // Browser mutations
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_press_key',
  'browser_wait',
]);

/**
 * Check if a tool is read-only (safe for concurrent execution)
 */
export function isReadOnlyTool(toolName: string): boolean {
  // Legacy chat-scoped tools (browser, Typst, Skill) are not in the
  // Rust ToolRegistry and must run through `execute_tool`, not
  // `execute_tool_batch`. They also share browser/font state and must
  // not run concurrently with each other.
  if (isLegacyChatOnlyTool(toolName)) {
    return false;
  }
  return READ_ONLY_TOOLS.has(toolName) && !SERIAL_ONLY_TOOLS.has(toolName);
}

/**
 * Partition tools into concurrent-safe and serial-required groups
 */
export function partitionTools(toolRequests: ToolRequest[]): {
  concurrent: ToolRequest[];
  serial: ToolRequest[];
} {
  const concurrent: ToolRequest[] = [];
  const serial: ToolRequest[] = [];

  for (const request of toolRequests) {
    if (isReadOnlyTool(request.name)) {
      concurrent.push(request);
    } else {
      serial.push(request);
    }
  }

  return { concurrent, serial };
}

function isFrontendOnlyTool(toolName: string): boolean {
  return toolName.startsWith('mcp__') || FRONTEND_ONLY_TOOLS.has(toolName);
}

/**
 * Streaming Tool Executor with concurrency control
 */
export class StreamingToolExecutor {
  private timeoutMs: number;

  constructor(options: { concurrencyLimit?: number; timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000; // 30 seconds
  }

  private getBootstrapProviderContext() {
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

  /**
   * Execute tools with intelligent partitioning and concurrency
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

    // Progress callback helper
    const reportProgress = (currentTool?: string) => {
      completed++;
      onProgress?.(completed, total, currentTool);
    };

    const prevalidatedResults: ToolResult[] = [];
    const executableRequests: ToolRequest[] = [];
    const allowedToolSet = allowedTools ? new Set(allowedTools) : null;

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
          !canAutoApproveTool(permissionMode, request.name, { browserIntent })
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
        // Bypass mode: auto-approve normal project-scoped tools so the
        // frontend doesn't open a permission modal for things like
        // `wc -l src/foo.ts`. SSH / browser / MCP tools still fall
        // through to the confirmation gate because `canAutoApproveTool`
        // returns false for them even in Bypass. Hard safety blocks
        // (dangerous-command / path-validation) have already run via
        // preToolUseHooks upstream, so we know the request isn't
        // destructive.
        if (canAutoApproveTool(permissionMode, request.name, { browserIntent })) {
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

      executableRequests.push(request);
    }

    const frontendOnlyRequests = executableRequests.filter((request) => isFrontendOnlyTool(request.name));
    const nativeRequests = executableRequests.filter((request) => !isFrontendOnlyTool(request.name));

    const nativeResults = await this.executeNativeBatch(
      nativeRequests,
      sessionId,
      reportProgress,
      workDir,
      source,
      allowedTools,
      executionMode,
    );
    const frontendResults = await this.executeFrontendOnlyBatch(frontendOnlyRequests, reportProgress, workDir);

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

  /**
   * Execute frontend-only tools with rate limiting.
   */
  private async executeFrontendOnlyBatch(
    toolRequests: ToolRequest[],
    onProgress: (toolName: string) => void,
    workDir?: string,
  ): Promise<{ results: ToolResult[]; errors: ToolResult[] }> {
    const results: ToolResult[] = [];
    const errors: ToolResult[] = [];

    for (const request of toolRequests) {
      const result = await this.executeFrontendOnlyTool(request, workDir).catch((error) => ({
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

  /**
   * Execute chat-scoped legacy tools (browser, Typst, Skill) that are not
   * registered in the Rust ToolRegistry.
   */
  private async executeLegacyChatTool(
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

  /**
   * Execute Rust-backed tools via the authoritative batch scheduler.
   */
  private async executeNativeBatch(
    toolRequests: ToolRequest[],
    sessionId: string,
    onProgress: (toolName: string) => void,
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
        const result = await this.executeLegacyChatTool(
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
          ? this.getBootstrapProviderContext()
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
              this.timeoutMs * Math.max(1, registryRequests.length),
            )
          ),
        ]);

        const elapsed = Date.now() - startTime;
        for (const result of rawResults) {
          const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          resultsById.set(result.id, finalizeToolResult(result.name ?? 'unknown', {
            id: result.id,
            content,
            is_error: Boolean(result.is_error),
            error_message: result.is_error ? content : undefined,
            execution_time_ms: elapsed,
          } satisfies ToolResult));
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

  /**
   * Execute a single frontend-only tool with timeout.
   */
  private async executeFrontendOnlyTool(
    request: ToolRequest,
    _workDir?: string,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Route MCP tools (mcp__<server>__<tool>) to the MCP backend
    if (request.name.startsWith('mcp__')) {
      return this.executeMCPTool(request, startTime);
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

  /**
   * Execute an MCP tool by resolving the server from store and calling mcp_call_tool.
   * Tool name format: mcp__<serverName>__<toolName>
   */
  private async executeMCPTool(request: ToolRequest, startTime: number): Promise<ToolResult> {
    const parsed = parseMCPToolName(request.name);
    if (!parsed) {
      return {
        id: request.id,
        content: '',
        is_error: true,
        error_message: `Invalid MCP tool name: ${request.name}`,
        execution_time_ms: 0,
      };
    }

    const { runtimes } = useMCPStore.getState();
    // Match by sanitized name to handle servers with special characters
    const runtime = runtimes.find(r => sanitizeName(r.name) === parsed.serverName);

    if (!runtime) {
      return {
        id: request.id,
        content: '',
        is_error: true,
        error_message: `MCP server '${parsed.serverName}' is not connected`,
        execution_time_ms: Date.now() - startTime,
      };
    }

    try {
      const mcpResult = await Promise.race([
        invoke<MCPToolResult>('mcp_call_tool', {
          serverId: runtime.id,
          toolName: parsed.toolName,
          args: request.arguments,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`MCP tool timeout: ${request.name}`)),
            this.timeoutMs,
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
      return {
        id: request.id,
        content: '',
        is_error: true,
        error_message: error instanceof Error ? error.message : 'MCP tool execution failed',
        execution_time_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tools using the legacy batch method (for compatibility)
   */
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

/**
 * Default instance for global use
 */
export const defaultToolExecutor = new StreamingToolExecutor();
