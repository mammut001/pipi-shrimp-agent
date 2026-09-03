export type ToolCallParams = {
  id: string; // Corresponds to tool_call_id
  name: string;
  arguments: string; // JSON string
};

/**
 * Serializable tool execution result passed back to the session runtime.
 */
export interface ToolExecutionResult {
  id: string;
  content: string;
}

/**
 * Token usage statistics from API response
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  model?: string;
}

/**
 * API response metadata
 */
export interface APIResponse {
  id?: string;
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
  };
  stop_reason?: string;
  [key: string]: unknown;
}

/**
 * Engine events emitted by the session runtime.
 *
 * IMPORTANT: EngineEvent is a transport type. Every branch must remain JSON
 * serializable: no callbacks, Promises, AbortSignals, Error instances, DOM
 * objects, or other process-local state. Tool continuation travels through the
 * SessionHandle command/result channel keyed by requestId.
 */
export type EngineEvent =
  // Streaming output
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }

  // Tool use detection (collected during streaming)
  | { type: 'tool_call'; tool: ToolCallParams }

  // Single tool execution request. Consumers submit the result through the
  // SessionHandle using requestId; the event itself contains no resolver.
  | { type: 'tool_call_request'; requestId: string; tool: ToolCallParams }

  // Batch tool execution request. Consumers execute the tools and submit one
  // result per id through SessionHandle.submitToolResults(requestId, results).
  | { type: 'tool_batch_request'; requestId: string; tools: ToolCallParams[] }

  // Tool execution result (optional observability event)
  | { type: 'tool_result'; id: string; content: string; is_error: boolean }

  // Status updates for UI
  | { type: 'status_update'; message: string }

  // Turn completion
  | { type: 'turn_complete'; tokenUsage?: TokenUsage }

  // Error handling. Keep the transport payload a string so it can be persisted,
  // replayed, sent over remote control, and reconstructed as Error by clients.
  | { type: 'error'; error: string }

  // API response completion (contains final token stats, etc.)
  | { type: 'api_response_complete'; response?: APIResponse };
