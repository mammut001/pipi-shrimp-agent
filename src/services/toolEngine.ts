/**
 * Tool Engine — DEPRECATED / REMOVED
 *
 * This file previously contained executeToolLoop(), a standalone multi-round
 * tool execution loop. It has been superseded by:
 *
 *   - QueryEngine (src/core/QueryEngine.ts) — async-generator-based main loop
 *   - StreamingToolExecutor (src/services/StreamingToolExecutor.ts) — concurrent tool execution
 *
 * executeToolLoop() was dead code (never called by runtime). The real tool
 * execution path is: chatStore.sendMessage → QueryEngine.runChatTurn → yields
 * tool_batch_request → chatStore handles concurrent + serial execution via
 * StreamingToolExecutor and invoke('execute_tool', ...).
 *
 * This file is intentionally empty — kept to avoid breaking any stale imports.
 */

// Re-export StreamingToolExecutor for consumers that may have imported from here
export { StreamingToolExecutor, partitionTools, isReadOnlyTool } from './StreamingToolExecutor';
export type { ToolRequest, ToolResult, ToolExecutionOptions, BatchExecutionResult } from './StreamingToolExecutor';
