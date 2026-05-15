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
import { buildProviderExecutionCapabilities } from '@/services/llm/capabilities';
import { sanitizeToolResultForModel } from '@/services/tools/toolResultSanitizer';
import { prepareMessagesForVision } from '@/services/vision/visionMessagePrep';
import { DEFAULT_AGENT_SETTINGS } from '@/types/settings';
import { toError } from '@/utils/errorFormat';

const OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM = `## Tool Calling Protocol
- You MUST invoke tools via the structured OpenAI function-calling channel named tool_calls.
- Do not emit XML tags like <tool_calls>, <invoke>, or <parameter>.
- Do not describe tool calls in plain text.
- If you need a tool, respond with structured tool_calls only.`;

const MALFORMED_TOOL_CALL_RETRY_NOTES = [
  'Your previous response used text-form tool calls, which were ignored. Use the structured tool_calls channel only.',
  'Your previous response still used text-form or XML tool calls. Reply using only the structured tool_calls channel. Do not emit XML tags, markdown, or prose describing the tool call.',
] as const;

function buildMalformedToolCallRetryMessage(attempt: number): string {
  return attempt === 1
    ? 'Model emitted text-form tool calls. Retrying with a structured tool-calling reminder.'
    : 'Model repeated text-form tool calls. Retrying with a stricter structured tool-calling reminder.';
}

function shouldInjectOpenAIToolProtocol(
  config: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
): boolean {
  if (options?.noTools) {
    return false;
  }

  if (options?.allowedTools && options.allowedTools.length === 0) {
    return false;
  }

  const capabilities = buildProviderExecutionCapabilities({
    provider: config.provider,
    apiFormat: config.apiFormat,
    model: config.model,
  });

  return capabilities.supportsToolCalls && capabilities.supportsToolOpenAI;
}

function buildEffectiveSystemPrompt(
  baseSystemPrompt: string,
  injectToolProtocol: boolean,
): string {
  if (!injectToolProtocol || baseSystemPrompt.includes('structured OpenAI function-calling channel named tool_calls')) {
    return baseSystemPrompt;
  }

  return `${baseSystemPrompt}\n\n${OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM}`;
}

function isMalformedToolCallError(error: unknown): boolean {
  return toError(error, 'Chat request failed').message.includes('malformed_tool_call');
}

export interface RunChatTurnOptions {
  noTools?: boolean;
  allowedTools?: string[];
}

export async function* runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
  allowBrowserTools: boolean = false,
  requestConfig?: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
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
  let malformedToolCallRetryCount = 0;

  // Memory hook — fires after each final (no-tool-call) response
  const memoryHook = createMemoryHook({ projectRoot });

  // AUDIT-019 FIX: Separate model reasoning rounds from tool execution rounds.
  // modelRound only increments when we make an actual API call, not on tool retries.
  // This prevents transient tool failures from prematurely exhausting maxModelRounds.
  let modelRound = 0;

  while (
    !isTurnComplete
    && modelRound < maxModelRounds
    && (toolBudgetSummary.toolBudgetUsedRaw < maxToolBudget || reserveFinalResponseRound)
  ) {
    round++; // round tracks overall loop iterations for logging/debugging
    modelRound++; // modelRound tracks actual API calls made
    
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
    const injectOpenAIToolProtocol = shouldInjectOpenAIToolProtocol(resolvedConfig!, options);
    const effectiveSystemPrompt = buildEffectiveSystemPrompt(systemPrompt, injectOpenAIToolProtocol);

    // [Phase 2: API Call]
    let hasToolCalls = false;
    let pendingToolCalls: ToolCallParams[] = [];
    let assistantMessageContent = '';
    let assistantMessageReasoning = '';
    let tokenUsage: { input_tokens: number; output_tokens: number; model?: string } | undefined;
    let strictBudgetRetry = false;
    let retryDueToMalformedToolCall = false;

    while (true) {
      // AUDIT-019 FIX: Check modelRound against maxModelRounds at API call time,
      // not the overall round counter. This ensures retries don't prematurely
      // exhaust the API call budget.
      if (modelRound >= maxModelRounds) {
        yield {
          type: 'error',
          error: new Error(`Exceeded maximum model reasoning rounds (${maxModelRounds}). The conversation is too long or complex.`),
        };
        return;
      }

      const request = buildResolvedChatRequest(resolvedConfig!, {
        messages: backendMessages,
        systemPrompt: effectiveSystemPrompt,
        allowBrowserTools,
        sessionId,
        contextBudget: { strict: strictBudgetRetry },
        noTools: options?.noTools,
        allowedTools: options?.allowedTools,
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

        if (
          injectOpenAIToolProtocol
          && malformedToolCallRetryCount < MALFORMED_TOOL_CALL_RETRY_NOTES.length
          && isMalformedToolCallError(e)
        ) {
          malformedToolCallRetryCount += 1;
          currentMessages.push({
            role: 'user',
            content: MALFORMED_TOOL_CALL_RETRY_NOTES[Math.min(
              malformedToolCallRetryCount - 1,
              MALFORMED_TOOL_CALL_RETRY_NOTES.length - 1,
            )],
          });
          yield {
            type: 'status_update',
            message: buildMalformedToolCallRetryMessage(malformedToolCallRetryCount),
          };
          retryDueToMalformedToolCall = true;
          break;
        }

        yield { type: 'error', error: toError(e, 'Chat request failed') };
        return;
      }
    }

    if (retryDueToMalformedToolCall) {
      continue;
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
