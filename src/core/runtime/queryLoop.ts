import { invokeRustAPIStream } from '../streamAdapter';
import type { EngineEvent, ToolCallParams } from '../types';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { isContextOverflowError } from '@/services/context/contextBudget';
import { useChatStore, useSettingsStore, useUIStore } from '@/store';
import { useCdpStore } from '@/store/cdpStore';
import {
  detectAskModeToolNeed,
  isAskModeToolFailureText,
  resolveSessionExecutionModeId,
} from '@/services/executionMode';
import {
  BROWSER_NOT_CONNECTED_USER_MESSAGE,
  isBrowserNotConnectedToolResult,
} from '@/services/browser/browserConnectionGate';
import { createMemoryHook } from '@/services/memory/memoryHooks';
import {
  appendToolBudgetEntries,
  createToolBudgetSummary,
  withToolBudgetSummary,
} from '@/services/tools/toolBudget';
import { buildProviderExecutionCapabilities } from '@/services/llm/capabilities';
import { sanitizeToolResultForModel } from '@/services/tools/toolResultSanitizer';
import {
  buildToolBatchFailureHint,
  isToolFailureText,
  shouldShortCircuitFailedToolBatch,
} from '@/services/tools/toolFailureClassification';
import { prepareMessagesForVision } from '@/services/vision/visionMessagePrep';
import { DEFAULT_AGENT_SETTINGS } from '@/types/settings';
import { toError } from '@/utils/errorFormat';
import type { ToolResultChannel } from './ToolResultChannel';

const OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM = `## Tool Calling Protocol
- You MUST invoke tools via the structured OpenAI function-calling channel named tool_calls.
- Do not emit XML tags like <tool_calls>, <invoke>, or <parameter>.
- Do not describe tool calls in plain text.
- If you need a tool, respond with structured tool_calls only.`;

const MALFORMED_TOOL_CALL_RETRY_NOTES = [
  'Your previous response used text-form tool calls, which were ignored. Use the structured tool_calls channel only.',
  'Your previous response still used text-form or XML tool calls. Reply using only the structured tool_calls channel. Do not emit XML tags, markdown, or prose describing the tool call.',
] as const;

const DISALLOWED_TOOL_RETRY_NOTES_PREFIX = 'Your previous tool calls were rejected because they are outside the allowed tool lane for this turn.';

function buildMalformedToolCallRetryMessage(attempt: number): string {
  return attempt === 1
    ? 'Model emitted text-form tool calls. Retrying with a structured tool-calling reminder.'
    : 'Model repeated text-form tool calls. Retrying with a stricter structured tool-calling reminder.';
}

function buildAllowedToolsRetryMessage(allowedTools: string[]): string {
  return [
    DISALLOWED_TOOL_RETRY_NOTES_PREFIX,
    `Only these tools are allowed in this turn: ${allowedTools.join(', ')}.`,
    'Retry now using only the allowed tools. Do not call any other tool, and do not describe a plan instead of making the allowed tool call.',
  ].join(' ');
}

const LAZY_TOOL_CALL_PATTERNS = [
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to|first,? i)\b.*\b(?:read|explore|look|check|search|scan|list|open|examine|analyze|browse)\b/i,
  /(?:我先|让我|我来|我会|首先|接下来|现在).*(?:读取|查看|探索|阅读|检查|搜索|扫描|列出|打开|分析|浏览|了解)/,
  /^.{0,200}(?:\.\.\.|…|接下来|然后|逐步).*$/s,
];

const LAZY_TOOL_CALL_NUDGE =
  'You described what you plan to do but did not actually call any tools. '
  + 'Do NOT describe your plan — execute it immediately by calling the appropriate tools now. '
  + 'Use the structured tool_calls channel to read files, list directories, or perform whatever action you described.';

function looksLikeLazyToolCallResponse(content: string, round: number, toolsAvailable: boolean): boolean {
  if (!toolsAvailable || round !== 1) return false;
  const trimmed = content.trim();
  if (trimmed.length > 300 || trimmed.length < 5) return false;
  return LAZY_TOOL_CALL_PATTERNS.some(pattern => pattern.test(trimmed));
}

function shouldInjectOpenAIToolProtocol(
  config: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
): boolean {
  if (options?.noTools) return false;
  if (options?.allowedTools && options.allowedTools.length === 0) return false;

  const capabilities = buildProviderExecutionCapabilities({
    provider: config.provider,
    apiFormat: config.apiFormat,
    model: config.model,
  });
  return capabilities.supportsToolCalls;
}

function buildEffectiveSystemPrompt(
  baseSystemPrompt: string,
  injectToolProtocol: boolean,
  allowedTools?: string[],
): string {
  let prompt = baseSystemPrompt;

  if (allowedTools?.length) {
    const constraintLine = `HARD RULE: you may call only these tools in this turn: ${allowedTools.join(', ')}.`;
    if (!prompt.includes(constraintLine)) {
      prompt = `${prompt}\n\n## Tool Lane Constraints\n- ${constraintLine}\n- Do not call any other tool.\n- If you need workspace inspection, use only the allowed tools above.`;
    }
  }

  if (!injectToolProtocol || prompt.includes('structured OpenAI function-calling channel named tool_calls')) {
    return prompt;
  }
  return `${prompt}\n\n${OPENAI_TOOL_CALL_PROTOCOL_ADDENDUM}`;
}

function isMalformedToolCallError(error: unknown): boolean {
  return toError(error, 'Chat request failed').message.includes('malformed_tool_call');
}

export function buildExhaustedMalformedToolCallError(error: unknown): Error {
  const detail = toError(error, 'Chat request failed').message;
  return new Error(
    'The model kept emitting text-form or XML tool calls instead of structured tool_calls '
    + `after ${MALFORMED_TOOL_CALL_RETRY_NOTES.length} automatic retries. `
    + 'This turn stopped with an explicit reason (not a silent interrupt). '
    + 'Try a different model/provider that supports structured tools, or rephrase the request. '
    + `Detail: ${detail}`,
  );
}

export interface RunChatTurnOptions {
  noTools?: boolean;
  allowedTools?: string[];
  maxToolRounds?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function createToolRequestId(sessionId: string, round: number): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:tool-batch:${round}:${randomId}`;
}

function errorMessage(error: unknown, fallback = 'Chat request failed'): string {
  return toError(error, fallback).message;
}

/**
 * The model/tool continuation loop. It is intentionally not exported through
 * the old UI-facing module directly; SessionRuntime owns the ToolResultChannel
 * and is the only production caller.
 */
export async function* runQueryEngineTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot: string | undefined,
  allowBrowserTools: boolean,
  requestConfig: ResolvedAgentConfig | undefined,
  options: RunChatTurnOptions | undefined,
  pipiOutputDir: string | undefined,
  toolResultChannel: ToolResultChannel,
): AsyncGenerator<EngineEvent, void, unknown> {
  const settings = useSettingsStore.getState().agentSettings;
  const maxToolBudget = options?.maxToolRounds ?? settings?.maxToolRounds ?? DEFAULT_AGENT_SETTINGS.maxToolRounds;
  const toolBudgetReserve = maxToolBudget > 4 ? 2 : 1;
  const maxModelRounds = Math.max(maxToolBudget + 8, 25);

  let currentMessages = [...initialMessages];
  let round = 0;
  let isTurnComplete = false;
  let toolBudgetSummary = createToolBudgetSummary(maxToolBudget);
  let reserveFinalResponseRound = false;
  let malformedToolCallRetryCount = 0;
  let disallowedToolRetryCount = 0;

  const effectivePipiOutputDir = pipiOutputDir
    ?? useChatStore.getState().sessions.find((session) => session.id === sessionId)?.pipiOutputDir;
  const memoryHook = createMemoryHook({ projectRoot, pipiOutputDir: effectivePipiOutputDir });

  let modelRound = 0;

  while (
    !isTurnComplete
    && modelRound < maxModelRounds
    && (toolBudgetSummary.toolBudgetUsedRaw < maxToolBudget || reserveFinalResponseRound)
  ) {
    round++;
    modelRound++;

    const resolvedConfig = requestConfig ?? resolveActiveAgentConfig();
    const validationIssues = validateResolvedAgentConfig(resolvedConfig);
    if (validationIssues.length > 0) {
      yield {
        type: 'error',
        error: formatAgentConfigValidationError(resolvedConfig, validationIssues),
      };
      return;
    }

    const backendMessages = prepareMessagesForVision(currentMessages.map(m => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    })), resolvedConfig!);
    const effectiveNoTools = Boolean(options?.noTools || reserveFinalResponseRound);
    const effectiveOptions: RunChatTurnOptions = {
      ...options,
      noTools: effectiveNoTools,
      allowedTools: effectiveNoTools ? undefined : options?.allowedTools,
    };
    const injectOpenAIToolProtocol = shouldInjectOpenAIToolProtocol(resolvedConfig!, effectiveOptions);
    const effectiveSystemPrompt = buildEffectiveSystemPrompt(
      systemPrompt,
      injectOpenAIToolProtocol,
      effectiveOptions.allowedTools,
    );

    let hasToolCalls = false;
    let pendingToolCalls: ToolCallParams[] = [];
    let assistantMessageContent = '';
    let assistantMessageReasoning = '';
    let tokenUsage: { input_tokens: number; output_tokens: number; model?: string } | undefined;
    let strictBudgetRetry = false;
    let retryDueToMalformedToolCall = false;

    while (true) {
      if (modelRound >= maxModelRounds) {
        yield {
          type: 'error',
          error: `The agent exceeded its reasoning/tool loop limit (${maxModelRounds} rounds). Try Ask mode for questions or Agent mode for tasks. If the model keeps looping, switch execution mode and retry.`,
        };
        return;
      }

      const request = buildResolvedChatRequest(resolvedConfig!, {
        messages: backendMessages,
        systemPrompt: effectiveSystemPrompt,
        allowBrowserTools,
        sessionId,
        contextBudget: { strict: strictBudgetRetry },
        noTools: effectiveOptions.noTools ?? false,
        allowedTools: effectiveOptions.allowedTools,
      });
      const stream = invokeRustAPIStream({
        ...request.params,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 300_000,
      });

      hasToolCalls = false;
      pendingToolCalls = [];
      assistantMessageContent = '';
      assistantMessageReasoning = '';
      tokenUsage = undefined;

      try {
        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            throw new DOMException('Chat turn aborted', 'AbortError');
          }
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
        // eslint-disable-next-line no-console
        console.info(`[QueryEngine] Stream finished for session ${sessionId}`);
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
            error: '当前上下文过大，已尝试自动精简但仍失败。请新建干净会话或移除大型引用。',
          };
          return;
        }

        if (isMalformedToolCallError(e)) {
          if (effectiveNoTools && assistantMessageContent.trim().length > 0) {
            isTurnComplete = true;
            yield { type: 'turn_complete', tokenUsage };
            return;
          }

          if (malformedToolCallRetryCount < MALFORMED_TOOL_CALL_RETRY_NOTES.length) {
            malformedToolCallRetryCount += 1;
            const retryNote = effectiveNoTools
              ? 'HARD RULE: Tool calls are disabled for this turn. Do NOT emit text-form or XML tool calls or <tool_call> tags. Return strict text or JSON response only.'
              : MALFORMED_TOOL_CALL_RETRY_NOTES[Math.min(
                  malformedToolCallRetryCount - 1,
                  MALFORMED_TOOL_CALL_RETRY_NOTES.length - 1,
                )];
            currentMessages.push({ role: 'user', content: retryNote });
            yield {
              type: 'status_update',
              message: buildMalformedToolCallRetryMessage(malformedToolCallRetryCount),
            };
            retryDueToMalformedToolCall = true;
            break;
          }

          yield {
            type: 'error',
            error: buildExhaustedMalformedToolCallError(e).message,
          };
          return;
        }

        yield { type: 'error', error: errorMessage(e) };
        return;
      }
    }

    if (retryDueToMalformedToolCall) continue;

    const assistantMessage = {
      role: 'assistant',
      content: assistantMessageContent,
      tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
    };
    currentMessages.push(assistantMessage);

    if (!hasToolCalls) {
      if (
        !effectiveNoTools
        && looksLikeLazyToolCallResponse(assistantMessageContent, round, !effectiveNoTools)
      ) {
        currentMessages.pop();
        currentMessages.push({ role: 'user', content: LAZY_TOOL_CALL_NUDGE });
        yield { type: 'status_update', message: 'Model described tool actions without executing them. Retrying with a nudge.' };
        continue;
      }

      isTurnComplete = true;
      yield { type: 'turn_complete', tokenUsage };
      memoryHook.onTurnComplete(currentMessages);
      break;
    }

    if (reserveFinalResponseRound && hasToolCalls) {
      yield {
        type: 'error',
        error: errorMessage(withToolBudgetSummary(
          new Error(
            `Exceeded maximum tool rounds (${maxToolBudget}); tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; failed_calls=${toolBudgetSummary.failedCalls}; successful_calls=${toolBudgetSummary.successfulCalls}`,
          ),
          toolBudgetSummary,
        )),
      };
      return;
    }

    const toolResults: { id: string; content: string }[] = [];

    if (pendingToolCalls.length > 0) {
      yield {
        type: 'status_update',
        message: `Executing ${pendingToolCalls.length} tool(s): ${pendingToolCalls.map(t => t.name).join(', ')}`,
      };

      const requestId = createToolRequestId(sessionId, round);
      yield {
        type: 'tool_batch_request',
        requestId,
        tools: pendingToolCalls,
      };

      const submittedResults = await toolResultChannel.waitFor(
        requestId,
        pendingToolCalls.map((tool) => tool.id),
        {
          timeoutMs: Number.parseInt(
            (typeof process !== 'undefined' && process.env?.PIPI_TOOL_BATCH_TIMEOUT_MS) || '300000',
            10,
          ) || 300_000,
          signal: options?.signal,
        },
      );
      const allContent = pendingToolCalls.map((tool) => (
        submittedResults.find((result) => result.id === tool.id)?.content
        ?? 'Error: no result returned for tool'
      ));

      toolBudgetSummary = appendToolBudgetEntries(
        toolBudgetSummary,
        pendingToolCalls.map((tool, index) => ({
          name: tool.name,
          content: allContent[index] ?? 'Error: no result returned for tool',
        })),
      );

      const allContentList = pendingToolCalls.map((_, index) => allContent[index] ?? 'Error: no result returned for tool');
      const allFailed = allContentList.length > 0 && allContentList.every(isToolFailureText);
      const allRejectedByAllowedLane = allContentList.length > 0
        && allContentList.every((content) => {
          const normalized = content.toLowerCase();
          return normalized.includes('not allowed in plan mode')
            || normalized.includes('outside the allowed tool lane')
            || normalized.includes('not allowed for execution source')
            || normalized.includes('tool execution blocked')
            || normalized.includes('permission denied');
        });

      if (
        allRejectedByAllowedLane
        && effectiveOptions.allowedTools?.length
        && disallowedToolRetryCount < 1
      ) {
        disallowedToolRetryCount += 1;
        currentMessages.pop();
        currentMessages.push({
          role: 'user',
          content: buildAllowedToolsRetryMessage(effectiveOptions.allowedTools),
        });
        yield {
          type: 'status_update',
          message: `Model called disallowed tools. Retrying with a stricter allowlist reminder (${effectiveOptions.allowedTools.join(', ')}).`,
        };
        continue;
      }

      if (allFailed && !effectiveNoTools && shouldShortCircuitFailedToolBatch(allContentList)) {
        const allBrowserDisconnected = allContentList.every(isBrowserNotConnectedToolResult);
        if (allBrowserDisconnected) {
          void useCdpStore.getState().requestChromeConnection();
          yield { type: 'error', error: BROWSER_NOT_CONNECTED_USER_MESSAGE };
          return;
        }

        const allAskBlocked = allContentList.every(isAskModeToolFailureText);
        if (allAskBlocked) {
          const currentSession = useChatStore.getState().sessions.find((s) => s.id === sessionId);
          const currentModeId = resolveSessionExecutionModeId(currentSession);
          if (currentModeId === 'ask' || currentModeId === 'plan') {
            const lastUserMessage = [...currentMessages].reverse().find((message) => message.role === 'user');
            const userContent = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
            const toolNeed = detectAskModeToolNeed(userContent);
            if (toolNeed.needed) {
              void useUIStore.getState().showExecutionModeUpgradePrompt({
                reason: toolNeed.reason,
                messagePreview: userContent.trim().slice(0, 240),
              });
            }
          }
          yield {
            type: 'error',
            error: '当前为问答模式，无法执行工具。请在弹窗中切换到规划或危险模式，然后点击「重试」。',
          };
          return;
        }

        const failureDetail = pendingToolCalls
          .map((tool, index) => {
            const raw = (allContentList[index] ?? '').trim();
            const reason = raw.replace(/^\s*error:\s*/i, '').slice(0, 300) || '未知原因';
            return `• ${tool.name}: ${reason}`;
          })
          .join('\n');
        const currentSession = useChatStore.getState().sessions.find((s) => s.id === sessionId);
        const currentModeId = resolveSessionExecutionModeId(currentSession);
        yield {
          type: 'error',
          error: `本轮所有工具调用都被拒绝。具体原因：\n${failureDetail}\n\n（${buildToolBatchFailureHint(currentModeId)}）`,
        };
        return;
      }

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

    for (const result of toolResults) {
      currentMessages.push({
        role: 'user',
        content: `__TOOL_RESULT__:${result.id}:${result.content}`,
        tool_call_id: result.id,
        metadata: { toolResult: true, hidden: true },
      });
    }
  }

  if (!isTurnComplete && toolBudgetSummary.toolBudgetUsedRaw >= maxToolBudget && !reserveFinalResponseRound) {
    yield {
      type: 'error',
      error: errorMessage(withToolBudgetSummary(
        new Error(
          `The agent exceeded its tool loop limit (${maxToolBudget} tool rounds). `
          + `tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; `
          + `failed_calls=${toolBudgetSummary.failedCalls}; `
          + `successful_calls=${toolBudgetSummary.successfulCalls}. `
          + 'Try Ask mode for questions or Agent mode for tasks.',
        ),
        toolBudgetSummary,
      )),
    };
    return;
  }

  if (!isTurnComplete && round >= maxModelRounds) {
    yield {
      type: 'error',
      error: errorMessage(withToolBudgetSummary(
        new Error(
          `The agent exceeded its reasoning/tool loop limit (${maxModelRounds} model rounds). `
          + `tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; `
          + `failed_calls=${toolBudgetSummary.failedCalls}; `
          + `successful_calls=${toolBudgetSummary.successfulCalls}. `
          + 'Try Ask mode for questions or Agent mode for tasks.',
        ),
        toolBudgetSummary,
      )),
    };
  }
}
