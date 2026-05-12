import { invokeRustAPIStream } from './streamAdapter';
import type { EngineEvent, ToolCallParams } from './types';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { isContextOverflowError } from '@/services/context/contextBudget';
import { useSettingsStore } from '@/store';
import { createMemoryHook } from '@/services/memory/memoryHooks';
import {
  appendToolBudgetEntries,
  createToolBudgetSummary,
  withToolBudgetSummary,
} from '@/services/tools/toolBudget';
import { sanitizeToolResultForModel } from '@/services/tools/toolResultSanitizer';
import { prepareMessagesForVision } from '@/services/vision/visionMessagePrep';
import { DEFAULT_AGENT_SETTINGS } from '@/types/settings';
import { toError } from '@/utils/errorFormat';

export async function* runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
  allowBrowserTools: boolean = false,
  requestConfig?: ResolvedAgentConfig,
): AsyncGenerator<EngineEvent, void, unknown> {
  const settings = useSettingsStore.getState().agentSettings;
  const maxToolBudget = settings?.maxToolRounds ?? DEFAULT_AGENT_SETTINGS.maxToolRounds;
  const toolBudgetReserve = Math.min(4, Math.max(1, maxToolBudget - 1));
  const maxModelRounds = Math.max(maxToolBudget + 8, 25);
  
  // Clone to avoid mutating the original array passed from Zustand directly
  let currentMessages = [...initialMessages];
  let round = 0;
  let isTurnComplete = false;
  let toolBudgetSummary = createToolBudgetSummary(maxToolBudget);
  let reserveFinalResponseRound = false;

  // Memory hook — fires after each final (no-tool-call) response
  const memoryHook = createMemoryHook({ projectRoot });
  
  // [ROUND ACCOUNTING CONTRACT]
  // Current Behavior: Every iteration of this loop increments `round` by 1, regardless of whether it's
  // a true model reasoning step, a tool retry, or polling/waiting. If a tool fails transiently or polling 
  // requires many checks, these eat into the single `maxRounds` limit indiscriminately.
  // 
  // Target Behavior: We need an Explicit Execution Budget distinguishing:
  // 1. Model reasoning rounds (maxModelRounds)
  // 2. Tool execution attempts (maxToolExecutions)
  // 3. Tool wall-clock timeouts & Retries
  // This will prevent slow or polling tools from prematurely exhausting the agent loop budget.

  while (
    !isTurnComplete
    && round < maxModelRounds
    && (toolBudgetSummary.toolBudgetUsedRaw < maxToolBudget || reserveFinalResponseRound)
  ) {
    round++;
    
    // [Phase 1: Pre-process]
    // Here we can inject Microcompact logic in the future easily, right before hitting the API.
    // await applyMicrocompact(currentMessages);

    const resolvedConfig = requestConfig ?? resolveActiveAgentConfig();
    const validationIssues = validateResolvedAgentConfig(resolvedConfig);
    if (validationIssues.length > 0) {
      yield {
        type: 'error',
        error: new Error(formatAgentConfigValidationError(resolvedConfig, validationIssues)),
      };
      return;
    }
    
    // Clean up internal fields to ensure Rust safely processes it
    const backendMessages = prepareMessagesForVision(currentMessages.map(m => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id
    })), resolvedConfig!);

    // [Phase 2: API Call]
    let hasToolCalls = false;
    let pendingToolCalls: ToolCallParams[] = [];
    let assistantMessageContent = '';
    let assistantMessageReasoning = '';
    let tokenUsage: { input_tokens: number; output_tokens: number; model?: string } | undefined;
    let strictBudgetRetry = false;

    while (true) {
      const request = buildResolvedChatRequest(resolvedConfig!, {
        messages: backendMessages,
        systemPrompt,
        allowBrowserTools,
        sessionId,
        contextBudget: { strict: strictBudgetRetry },
      });
      const stream = invokeRustAPIStream(request.params);

      hasToolCalls = false;
      pendingToolCalls = [];
      assistantMessageContent = '';
      assistantMessageReasoning = '';
      tokenUsage = undefined;

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
                model: chunk.response?.model || resolvedConfig!.model,
              };
            }
          }
        }
        break;
      } catch (e) {
        if (
          !strictBudgetRetry
          && isContextOverflowError(e)
          && !assistantMessageContent
          && !assistantMessageReasoning
          && pendingToolCalls.length === 0
        ) {
          strictBudgetRetry = true;
          yield { type: 'status_update', message: 'Context too large, retrying with a pruned request.' };
          continue;
        }

        if (strictBudgetRetry && isContextOverflowError(e)) {
          yield {
            type: 'error',
            error: new Error('当前上下文过大，已尝试自动精简但仍失败。请新建干净会话或移除大型引用。'),
          };
          return;
        }

        yield { type: 'error', error: toError(e, 'Chat request failed') };
        return;
      }
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

    if (reserveFinalResponseRound) {
      yield {
        type: 'error',
        error: withToolBudgetSummary(
          new Error(
            `Exceeded maximum tool rounds (${maxToolBudget}); tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; failed_calls=${toolBudgetSummary.failedCalls}; successful_calls=${toolBudgetSummary.successfulCalls}`,
          ),
          toolBudgetSummary,
        ),
      };
      return;
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
      toolBudgetSummary = appendToolBudgetEntries(
        toolBudgetSummary,
        pendingToolCalls.map((tool, index) => ({
          name: tool.name,
          content: allContent[index] ?? 'Error: no result returned for tool',
        })),
      );
      if (toolBudgetSummary.toolBudgetUsedRaw >= Math.max(0, maxToolBudget - toolBudgetReserve)) {
        reserveFinalResponseRound = true;
      }
      for (let i = 0; i < pendingToolCalls.length; i++) {
        toolResults.push({
          id: pendingToolCalls[i].id,
          content: sanitizeToolResultForModel(pendingToolCalls[i].name, allContent[i]),
        });
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

  if (!isTurnComplete && toolBudgetSummary.toolBudgetUsedRaw >= maxToolBudget && !reserveFinalResponseRound) {
    yield {
      type: 'error',
      error: withToolBudgetSummary(
        new Error(
          `Exceeded maximum tool rounds (${maxToolBudget}); tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; failed_calls=${toolBudgetSummary.failedCalls}; successful_calls=${toolBudgetSummary.successfulCalls}`,
        ),
        toolBudgetSummary,
      ),
    };
    return;
  }

  if (!isTurnComplete && round >= maxModelRounds) {
    yield {
      type: 'error',
      error: withToolBudgetSummary(
        new Error(
          `Exceeded maximum model rounds (${maxModelRounds}) before completing the turn; tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; failed_calls=${toolBudgetSummary.failedCalls}; successful_calls=${toolBudgetSummary.successfulCalls}`,
        ),
        toolBudgetSummary,
      ),
    };
  }
}
