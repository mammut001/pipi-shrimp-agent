/**
 * Streaming Tool Executor
 * Provides concurrent execution for read-only tools and progress callbacks
 *
 * Based on Claude Code's StreamingToolExecutor.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { useMCPStore } from '@/store/mcpStore';
import { parseMCPToolName } from '@/services/mcp/toolNormalizer';
import type { ToolResult as MCPToolResult, ContentBlock } from '@/services/mcp/types';
import { resolveActiveAgentConfig } from '@/services/agentConfig';
import {
  buildProviderExecutionCapabilities,
  resolveProviderRequestHint,
} from '@/services/llm/capabilities';
import { runSshExec, runSshReadFile, runSshUpload } from '@/tools/impl/SshTool';
import {
  AUTORESEARCH_BOOTSTRAP_TOOL_NAMES,
} from '@/services/tools/autoresearchBootstrap';

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
}

export interface ToolResult {
  id: string;
  content: string;
  is_error: boolean;
  error_message?: string;
  execution_time_ms?: number;
}

export interface ToolExecutionOptions {
  sessionId: string;
  workDir?: string;
  onProgress?: (completed: number, total: number, currentTool?: string) => void;
  concurrencyLimit?: number;
  timeoutMs?: number;
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

function isStructuredToolError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed?.error === true || typeof parsed?.error_kind === 'string';
  } catch {
    return false;
  }
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
  'ssh_read_file',
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
const FRONTEND_ONLY_TOOLS = new Set([
  'ssh_exec',
  'ssh_upload_file',
  'ssh_read_file',
]);

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
  private concurrencyLimit: number;
  private timeoutMs: number;

  constructor(options: { concurrencyLimit?: number; timeoutMs?: number } = {}) {
    this.concurrencyLimit = options.concurrencyLimit ?? 5;
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
    const { onProgress, workDir, sessionId } = options;

    if (toolRequests.length === 0) {
      return { results: [], totalExecutionTime: 0, errors: [] };
    }

    let completed = 0;
    const total = toolRequests.length;

    // Progress callback helper
    const reportProgress = (currentTool?: string) => {
      completed++;
      onProgress?.(completed, total, currentTool);
    };

    const frontendOnlyRequests = toolRequests.filter((request) => isFrontendOnlyTool(request.name));
    const nativeRequests = toolRequests.filter((request) => !isFrontendOnlyTool(request.name));

    const [frontendResults, nativeResults] = await Promise.all([
      this.executeFrontendOnlyBatch(frontendOnlyRequests, reportProgress, workDir),
      this.executeNativeBatch(nativeRequests, sessionId, reportProgress, workDir),
    ]);

    const resultsById = new Map<string, ToolResult>();
    for (const result of [...frontendResults.results, ...nativeResults.results]) {
      resultsById.set(result.id, result);
    }

    const allResults = toolRequests.map((request) => resultsById.get(request.id) ?? {
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

    // Process in batches to respect concurrency limit
    for (let i = 0; i < toolRequests.length; i += this.concurrencyLimit) {
      const batch = toolRequests.slice(i, i + this.concurrencyLimit);
      const batchPromises = batch.map(request =>
        this.executeFrontendOnlyTool(request, workDir).then(result => {
          onProgress(request.name);
          return result;
        }).catch(error => {
          onProgress(request.name);
          const errorResult: ToolResult = {
            id: request.id,
            content: '',
            is_error: true,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            execution_time_ms: 0,
          };
          return errorResult;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      for (const result of batchResults) {
        results.push(result);
        if (result.is_error) {
          errors.push(result);
        }
      }
    }

    return { results, errors };
  }

  /**
   * Execute Rust-backed tools via the authoritative batch scheduler.
   */
  private async executeNativeBatch(
    toolRequests: ToolRequest[],
    sessionId: string,
    onProgress: (toolName: string) => void,
    workDir?: string,
  ): Promise<{ results: ToolResult[]; errors: ToolResult[] }> {
    if (toolRequests.length === 0) {
      return { results: [], errors: [] };
    }

    const startTime = Date.now();
    const { activeConfig, provider, providerCapabilities } = toolRequests.some((tool) => AUTORESEARCH_BOOTSTRAP_TOOL_SET.has(tool.name))
      ? this.getBootstrapProviderContext()
      : { activeConfig: null, provider: null, providerCapabilities: null };

    try {
      const rawResults = await Promise.race([
        invoke<any[]>('execute_tool_batch', {
          toolCalls: toolRequests.map((tool) => ({
            id: tool.id,
            name: tool.name,
            arguments: JSON.stringify(tool.arguments),
            workDir: workDir ?? null,
            apiKey: activeConfig?.apiKey ?? null,
            model: activeConfig?.model ?? null,
            baseUrl: activeConfig?.baseUrl || null,
            provider,
            apiFormat: activeConfig?.apiFormat || null,
            providerCapabilities,
          })),
          sessionId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool batch execution timeout: ${toolRequests.map((tool) => tool.name).join(', ')}`)),
            this.timeoutMs * Math.max(1, toolRequests.length),
          )
        ),
      ]);

      const elapsed = Date.now() - startTime;
      const results = rawResults.map((result) => {
        const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        return {
          id: result.id,
          content,
          is_error: Boolean(result.is_error),
          error_message: result.is_error ? content : undefined,
          execution_time_ms: elapsed,
        } satisfies ToolResult;
      });

      for (const request of toolRequests) {
        onProgress(request.name);
      }

      return {
        errors: results.filter((result) => result.is_error),
        results,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const results = toolRequests.map((request) => {
        onProgress(request.name);
        return {
          id: request.id,
          content: buildStructuredToolError(request.name, request.arguments, error),
          is_error: true,
          error_message: message,
          execution_time_ms: elapsed,
        } satisfies ToolResult;
      });

      return { results, errors: results };
    }
  }

  /**
   * Execute a single frontend-only tool with timeout.
   */
  private async executeFrontendOnlyTool(
    request: ToolRequest,
    workDir?: string,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Route MCP tools (mcp__<server>__<tool>) to the MCP backend
    if (request.name.startsWith('mcp__')) {
      return this.executeMCPTool(request, startTime);
    }

    try {
      if (request.name === 'ssh_exec') {
        const data = await runSshExec(request.arguments as any);
        return {
          id: request.id,
          content: JSON.stringify(data),
          is_error: false,
          execution_time_ms: Date.now() - startTime,
        };
      }

      if (request.name === 'ssh_upload_file') {
        const data = await runSshUpload(request.arguments as any);
        return {
          id: request.id,
          content: JSON.stringify(data),
          is_error: false,
          execution_time_ms: Date.now() - startTime,
        };
      }

      if (request.name === 'ssh_read_file') {
        const data = await runSshReadFile(request.arguments as any);
        return {
          id: request.id,
          content: JSON.stringify(data),
          is_error: false,
          execution_time_ms: Date.now() - startTime,
        };
      }

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
