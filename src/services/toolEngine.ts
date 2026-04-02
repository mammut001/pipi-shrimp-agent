/**
 * Tool Engine — Multi-round tool execution loop
 *
 * Corresponds to Claude Code's query.ts main loop tool execution phase.
 * Supports unlimited rounds of tool calls (capped by maxRounds).
 *
 * Flow:
 *   1. Call API with messages
 *   2. Extract tool_calls from response
 *   3. If no tool_calls → break (done)
 *   4. Execute tools via Rust scheduler (concurrency-aware)
 *   5. Append tool_results to messages
 *   6. Go to step 1
 */

import { invoke } from '@tauri-apps/api/core'
import type { Message, ToolCall } from '../types/chat'
import { StreamingToolExecutor, type ToolRequest } from './StreamingToolExecutor'

export interface ToolLoopOptions {
  apiKey: string
  model: string
  baseUrl?: string
  systemPrompt?: string
  browserConnected?: boolean
  maxRounds?: number
  enableConcurrency?: boolean
  onToolProgress?: (completed: number, total: number, currentTool?: string) => void
}

export interface ToolLoopResult {
  messages: Message[]
  toolCallCount: number
  finalContent: string
  finalReasoning?: string
  tokenUsage?: { input_tokens: number; output_tokens: number; model?: string }
  error?: string
}

/**
 * Execute the tool loop: API → tool_use → execute → tool_result → API → ...
 *
 * This function handles the multi-round tool chain that the old
 * sendAllToolResults could not support (it only did 1 round).
 *
 * @param messages - Conversation messages (will be mutated with tool_results)
 * @param sessionId - Session ID for streaming isolation
 * @param options - API configuration
 */
export async function executeToolLoop(
  messages: Message[],
  sessionId: string,
  options: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const maxRounds = options.maxRounds ?? 10
  let totalToolCalls = 0
  let finalContent = ''
  let finalReasoning = ''
  let tokenUsage: ToolLoopResult['tokenUsage']

  for (let round = 0; round < maxRounds; round++) {
    // 1. Call API
    const response = await invoke<any>('send_claude_sdk_chat_streaming', {
      messages: buildApiMessages(messages),
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl || '',
      systemPrompt: options.systemPrompt,
      browserConnected: options.browserConnected ?? false,
      sessionId,
    })

    // Accumulate final content from this round
    if (response.content) {
      finalContent = response.content
    }
    if (response.reasoning) {
      finalReasoning = response.reasoning
    }
    if (response.usage) {
      tokenUsage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        model: response.model,
      }
    }

    // 2. Extract tool_calls
    const toolCalls: ToolCall[] = response.tool_calls || []
    if (toolCalls.length === 0) {
      // No more tool calls → main loop ends
      break
    }

    totalToolCalls += toolCalls.length

    // 3. Execute tools with concurrency control
    const toolRequests: ToolRequest[] = toolCalls.map(tc => {
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        // If not valid JSON, treat as command string
        parsedArgs = { command: tc.arguments };
      }
      return {
        id: tc.id,
        name: tc.name,
        arguments: parsedArgs,
      };
    });

    let results: any[];

    if (options.enableConcurrency ?? true) {
      // Use streaming executor with concurrency
      const executor = new StreamingToolExecutor();
      const batchResult = await executor.executeBatch(toolRequests, {
        sessionId,
        onProgress: options.onToolProgress,
        concurrencyLimit: 5, // Allow up to 5 concurrent read-only tools
        timeoutMs: 30000,
      });
      results = batchResult.results;
    } else {
      // Fallback to legacy batch execution
      results = await invoke<any[]>('execute_tool_batch', {
        toolCalls: toolRequests,
        sessionId,
      })
    }

    // 4. Append tool_results to messages
    for (const result of results) {
      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: `__TOOL_RESULT__:${result.id}:${result.content}`,
        timestamp: Date.now(),
        tool_call_id: result.id,
      } as Message)
    }

    // 5. If ALL tool calls failed, stop the loop to prevent infinite error cycles
    if (results.every((r: any) => r.is_error)) {
      return {
        messages,
        toolCallCount: totalToolCalls,
        finalContent,
        finalReasoning,
        tokenUsage,
        error: 'All tool calls failed — stopping tool loop',
      }
    }
  }

  return {
    messages,
    toolCallCount: totalToolCalls,
    finalContent,
    finalReasoning,
    tokenUsage,
  }
}

/**
 * Build API-ready messages array from internal Message[] format.
 *
 * Strips internal fields and ensures the format matches what the
 * Rust API client expects.
 */
function buildApiMessages(messages: Message[]): any[] {
  return messages.map(m => {
    const msg: any = {
      role: m.role,
      content: m.content,
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      msg.tool_calls = m.tool_calls
    }
    if (m.tool_call_id) {
      msg.tool_call_id = m.tool_call_id
    }
    return msg
  })
}
