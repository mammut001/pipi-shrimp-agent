import { invokeRustAPIStream } from './streamAdapter';
import type { EngineEvent, ToolCallParams } from './types';
import { useSettingsStore, useCdpStore } from '@/store';
import { createMemoryHook } from '@/services/memory/memoryHooks';

export async function* runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
): AsyncGenerator<EngineEvent, void, unknown> {
  const settings = useSettingsStore.getState().agentSettings;
  const maxRounds = settings?.maxToolRounds ?? 10;
  
  // Clone to avoid mutating the original array passed from Zustand directly
  let currentMessages = [...initialMessages];
  let round = 0;
  let isTurnComplete = false;

  // Memory hook — fires after each final (no-tool-call) response
  const memoryHook = createMemoryHook({ projectRoot });
  
  while (!isTurnComplete && round < maxRounds) {
    round++;
    
    // [Phase 1: Pre-process]
    // Here we can inject Microcompact logic in the future easily, right before hitting the API.
    // await applyMicrocompact(currentMessages);

    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) {
      yield { type: 'error', error: new Error('API key not configured') };
      return;
    }
    
    // Clean up internal fields to ensure Rust safely processes it
    const backendMessages = currentMessages.map(m => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id
    }));

    // [Phase 2: API Call]
    const stream = invokeRustAPIStream({
      messages: backendMessages,
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      baseUrl: apiConfig.baseUrl || '',
      systemPrompt,
      browserConnected: useCdpStore.getState().status === 'connected',
      sessionId: sessionId,
    });
    
    let hasToolCalls = false;
    let pendingToolCalls: ToolCallParams[] = [];
    let assistantMessageContent = "";
    let assistantMessageReasoning = "";
    let tokenUsage: { input_tokens: number; output_tokens: number; model?: string } | undefined;

    try {
      // Consume the chunks stream
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          assistantMessageContent += chunk.content;
          yield { type: 'text_delta', content: chunk.content };
        } else if (chunk.type === 'reasoning_delta') {
          assistantMessageReasoning += chunk.content;
          yield { type: 'reasoning_delta', content: chunk.content };
        } else if (chunk.type === 'tool_call') {
          hasToolCalls = true;
          pendingToolCalls.push(chunk.tool);
        } else if (chunk.type === 'api_response_complete') {
          const usage = chunk.response?.usage;
          if (usage) {
            tokenUsage = {
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              model: chunk.response?.model || apiConfig.model
            };
          }
        }
      }
    } catch (e) {
      yield { type: 'error', error: e instanceof Error ? e : new Error(String(e)) };
      return;
    }
    
    // Record the Assistant's turn in the local history BEFORE yielding tool execution.
    const assistantMessage = {
      role: 'assistant',
      content: assistantMessageContent,
      // MiniMax reasoning could be merged here, but typically it is handled at display level via parsing
      tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined
    };
    currentMessages.push(assistantMessage);
    
    // [Phase 3: Decision & Execution]
    if (!hasToolCalls) {
      isTurnComplete = true;
      yield { type: 'turn_complete', tokenUsage };
      // Trigger background memory extraction (fire-and-forget)
      memoryHook.onTurnComplete(currentMessages);
      break; 
    }

    const toolResults: { id: string; content: string }[] = [];

    // Yield all tools as a single batch — lets the consumer execute read-only
    // tools in parallel while handling write/permission tools serially.
    // _resolveAll must be called with a result for EVERY tool in the batch.
    if (pendingToolCalls.length > 0) {
      yield { type: 'status_update', message: `Executing ${pendingToolCalls.length} tool(s): ${pendingToolCalls.map(t => t.name).join(', ')}` };

      const resolvers: Array<(v: string) => void> = [];
      const promises: Promise<string>[] = pendingToolCalls.map((_, i) =>
        new Promise<string>(r => { resolvers[i] = r; })
      );

      yield {
        type: 'tool_batch_request',
        tools: pendingToolCalls,
        _resolveAll: (results: { id: string; content: string }[]) => {
          for (let i = 0; i < pendingToolCalls.length; i++) {
            const result = results.find(r => r.id === pendingToolCalls[i].id);
            resolvers[i](result?.content ?? 'Error: no result returned for tool');
          }
        },
      } as EngineEvent;

      const allContent = await Promise.all(promises);
      for (let i = 0; i < pendingToolCalls.length; i++) {
        toolResults.push({ id: pendingToolCalls[i].id, content: allContent[i] });
      }
    }
    
    // Append the tool results to the context for the next round
    for (const result of toolResults) {
      currentMessages.push({
        role: 'user',
        // The __TOOL_RESULT__ syntax is specific to this project's Rust adapter mapping
        content: `__TOOL_RESULT__:${result.id}:${result.content}`,
        tool_call_id: result.id
      });
    }
  }

  if (!isTurnComplete && round >= maxRounds) {
    yield { type: 'error', error: new Error(`Exceeded maximum tool rounds (${maxRounds})`) };
  }
}
