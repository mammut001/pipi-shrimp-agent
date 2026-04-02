export type ToolCallParams = {
  id: string; // Corresponds to tool_call_id
  name: string;
  arguments: string; // JSON string
};

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
 * Engine events emitted by runChatTurn (QueryEngine)
 * 
 * Flow:
 *   - text_delta/reasoning_delta: streaming output
 *   - tool_call: detected tool use (collected)
 *   - tool_call_request: requests UI to execute tool (with _resolve callback)
 *   - tool_result: tool execution completed
 *   - status_update: status message for UI
 *   - turn_complete: turn finished successfully
 *   - error: error occurred
 *   - api_response_complete: API response finished (contains token stats)
 */
export type EngineEvent =
  // Streaming output
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  
  // Tool use detection (collected during streaming)
  | { type: 'tool_call'; tool: ToolCallParams }
  
  // Tool execution request (UI should call invoke('execute_tool_batch'))
  // _resolve is a callback to pass the tool result back into the generator
  | { type: 'tool_call_request'; tool: ToolCallParams; _resolve: (result: string) => void }
  
  // Tool execution result (emitted after tool completes)
  | { type: 'tool_result'; id: string; content: string; is_error: boolean }
  
  // Status updates for UI
  | { type: 'status_update'; message: string }
  
  // Turn completion
  | { type: 'turn_complete'; tokenUsage?: TokenUsage }
  
  // Error handling
  | { type: 'error'; error: Error }
  
  // API response completion (contains final token stats, etc.)
  | { type: 'api_response_complete'; response?: APIResponse };
