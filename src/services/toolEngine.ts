/**
 * Tool Engine — DEPRECATED / REMOVED
 *
 * The multi-round runtime now lives behind SessionRuntime/SessionHandle and
 * registry-backed scheduling is authoritative in Rust.
 */

export { StreamingToolExecutor } from './StreamingToolExecutor';
export type { ToolRequest, ToolResult, ToolExecutionOptions, BatchExecutionResult } from './StreamingToolExecutor';
export { partitionToolsByMetadata, getToolRuntimeMetadata, loadToolRuntimeMetadata } from './tools/toolMetadata';
export type { ToolRuntimeMetadata } from './tools/toolMetadata';
