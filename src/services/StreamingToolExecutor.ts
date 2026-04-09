/**
 * Streaming Tool Executor
 * Provides concurrent execution for read-only tools and progress callbacks
 *
 * Based on Claude Code's StreamingToolExecutor.ts
 */

import { invoke } from '@tauri-apps/api/core';

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

  /**
   * Execute tools with intelligent partitioning and concurrency
   */
  async executeBatch(
    toolRequests: ToolRequest[],
    options: ToolExecutionOptions
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const { onProgress, workDir } = options;

    if (toolRequests.length === 0) {
      return { results: [], totalExecutionTime: 0, errors: [] };
    }

    // Partition tools
    const { concurrent, serial } = partitionTools(toolRequests);
    const allResults: ToolResult[] = [];
    const errors: ToolResult[] = [];

    let completed = 0;
    const total = toolRequests.length;

    // Progress callback helper
    const reportProgress = (currentTool?: string) => {
      completed++;
      onProgress?.(completed, total, currentTool);
    };

    // Execute concurrent tools in parallel (with limit)
    if (concurrent.length > 0) {
      const concurrentResults = await this.executeConcurrent(concurrent, reportProgress, workDir);
      allResults.push(...concurrentResults.results);
      errors.push(...concurrentResults.errors);
    }

    // Execute serial tools one by one
    for (const request of serial) {
      try {
        const result = await this.executeSingleTool(request, workDir);
        allResults.push(result);
        if (result.is_error) {
          errors.push(result);
        }
        reportProgress(request.name);
      } catch (error) {
        const errorResult: ToolResult = {
          id: request.id,
          content: '',
          is_error: true,
          error_message: error instanceof Error ? error.message : 'Unknown error',
          execution_time_ms: 0,
        };
        allResults.push(errorResult);
        errors.push(errorResult);
        reportProgress(request.name);
      }
    }

    const totalExecutionTime = Date.now() - startTime;

    return {
      results: allResults,
      totalExecutionTime,
      errors,
    };
  }

  /**
   * Execute read-only tools concurrently with rate limiting
   */
  private async executeConcurrent(
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
        this.executeSingleTool(request, workDir).then(result => {
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
   * Execute a single tool with timeout
   */
  private async executeSingleTool(
    request: ToolRequest,
    workDir?: string,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        invoke<any>('execute_tool', {
          toolName: request.name,
          arguments: JSON.stringify(request.arguments),
          workDir: workDir ?? null,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool execution timeout: ${request.name}`)), this.timeoutMs)
        ),
      ]);

      const executionTime = Date.now() - startTime;

      // execute_tool returns a plain string (the tool result).
      // Detect Rust-side AppError by checking for JSON error shape as fallback.
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      const isError = content.startsWith('Error:') || content.startsWith('ERROR:');
      return {
        id: request.id,
        content,
        is_error: isError,
        execution_time_ms: executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        id: request.id,
        content: '',
        is_error: true,
        error_message: error instanceof Error ? error.message : 'Tool execution failed',
        execution_time_ms: executionTime,
      };
    }
  }

  /**
   * Execute tools using the legacy batch method (for compatibility)
   */
  async executeLegacyBatch(
    toolRequests: ToolRequest[],
    sessionId: string
  ): Promise<ToolResult[]> {
    const results = await invoke<any[]>('execute_tool_batch', {
      toolCalls: toolRequests.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      sessionId,
    });

    return results.map(result => ({
      id: result.id,
      content: result.content,
      is_error: result.is_error,
      error_message: result.error_message,
      execution_time_ms: result.execution_time_ms || 0,
    }));
  }
}

/**
 * Default instance for global use
 */
export const defaultToolExecutor = new StreamingToolExecutor();