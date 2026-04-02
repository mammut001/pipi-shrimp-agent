export type ToolCallParams = {
  id: string; // Corresponds to tool_call_id
  name: string;
  arguments: string;
};

export type EngineEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  // _resolve is a callback we use to pass the user's decision or the tool result back into the generator
  | { type: 'tool_call_request'; tool: ToolCallParams; _resolve: (result: string) => void }
  | { type: 'status_update'; message: string }
  | { type: 'error'; error: Error }
  | { type: 'turn_complete'; tokenUsage?: { input_tokens: number; output_tokens: number; model?: string } };
