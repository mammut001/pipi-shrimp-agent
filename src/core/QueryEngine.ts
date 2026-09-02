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

// Patterns that suggest the model is describing future tool use rather than providing a final answer.
// These indicate the model "plans" to call tools but didn't actually emit any tool_calls.
const LAZY_TOOL_CALL_PATTERNS = [
  // English intent markers
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to|first,? i)\b.*\b(?:read|explore|look|check|search|scan|list|open|examine|analyze|browse)\b/i,
  // Chinese intent markers
  /(?:我先|让我|我来|我会|首先|接下来|现在).*(?:读取|查看|探索|阅读|检查|搜索|扫描|列出|打开|分析|浏览|了解)/,
  // Short response with ellipsis or planning language (under 200 chars, looks like a stub)
  /^.{0,200}(?:\.\.\.|…|接下来|然后|逐步).*$/s,
];

const LAZY_TOOL_CALL_NUDGE =
  'You described what you plan to do but did not actually call any tools. '
  + 'Do NOT describe your plan — execute it immediately by calling the appropriate tools now. '
  + 'Use the structured tool_calls channel to read files, list directories, or perform whatever action you described.';

/**
 * Detect if a short assistant response looks like a planning stub rather than a genuine final answer.
 * Only triggers on round 1 when tools are available and the response is short.
 */
function looksLikeLazyToolCallResponse(content: string, round: number, toolsAvailable: boolean): boolean {
  if (!toolsAvailable || round !== 1) return false;
  const trimmed = content.trim();
  // Must be short (real answers tend to be longer)
  if (trimmed.length > 300 || trimmed.length < 5) return false;
  return LAZY_TOOL_CALL_PATTERNS.some(pattern => pattern.test(trimmed));
}

function shouldInjectOpenAIToolProtocol(
  config: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
): boolean {
  if (options?.noTools) {
    return false;
  }

  // Empty allowedTools is equivalent to "no tools this turn" — don't
  // inject the tool calling protocol, otherwise the
  // model would loop back into tool calls we already told it to skip.
  if (options?.allowedTools && options.allowedTools.length === 0) {
    return false;
  }

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

/** User-facing error after structured-tool retries are exhausted (not a silent drop). */
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

export async function* runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
  allowBrowserTools: boolean = false,
  requestConfig?: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
  pipiOutputDir?: string,
): AsyncGenerator<EngineEvent, void, unknown> {
  const settings = useSettingsStore.getState().agentSettings;
  const maxToolBudget = options?.maxToolRounds ?? settings?.maxToolRounds ?? DEFAULT_AGENT_SETTINGS.maxToolRounds;
  const toolBudgetReserve = maxToolBudget > 4 ? 2 : 1;
  const maxModelRounds = Math.max(maxToolBudget + 8, 25);
  
  // Clone to avoid mutating the original array passed from Zustand directly
  let currentMessages = [...initialMessages];
  let round = 0;
  let isTurnComplete = false;
  let toolBudgetSummary = createToolBudgetSummary(maxToolBudget);
  let reserveFinalResponseRound = false;
  let malformedToolCallRetryCount = 0;
  let disallowedToolRetryCount = 0;

  // Memory hook — fires after each final (no-tool-call) response
  const effectivePipiOutputDir = pipiOutputDir
    ?? useChatStore.getState().sessions.find((session) => session.id === sessionId)?.pipiOutputDir;
  const memoryHook = createMemoryHook({ projectRoot, pipiOutputDir: effectivePipiOutputDir });

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
        // AUDIT-FIX: stop with a user-actionable message that tells
        // them which mode to use next time. Hitting this error is
        // almost always caused by Ask-mode Q&A falling into an
        // Agent/Bypass tool loop; nudging the user back to Ask (or to
        // disable tool calls entirely) is the right next step.
        yield {
          type: 'error',
          error: new Error(
            `The agent exceeded its reasoning/tool loop limit (${maxModelRounds} rounds). `
            + 'Try Ask mode for questions or Agent mode for tasks. '
            + 'If the model keeps looping, switch execution mode and retry.',
          ),
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
        // Consume the chunks stream
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
            error: new Error('当前上下文过大，已尝试自动精简但仍失败。请新建干净会话或移除大型引用。'),
          };
          return;
        }

        if (isMalformedToolCallError(e)) {
          if (effectiveNoTools) {
            // On noTools turns (e.g. goal evaluation), tool calling is disabled by contract.
            // If the LLM returned pseudo-tool text or XML tags in its response,
            // treat the streamed text as a valid text turn_complete instead of throwing an error.
            if (assistantMessageContent.trim().length > 0) {
              isTurnComplete = true;
              yield { type: 'turn_complete', tokenUsage };
              return;
            }
          }

          if (malformedToolCallRetryCount < MALFORMED_TOOL_CALL_RETRY_NOTES.length) {
            malformedToolCallRetryCount += 1;
            const retryNote = effectiveNoTools
              ? 'HARD RULE: Tool calls are disabled for this turn. Do NOT emit text-form or XML tool calls or <tool_call> tags. Return strict text or JSON response only.'
              : MALFORMED_TOOL_CALL_RETRY_NOTES[Math.min(
                  malformedToolCallRetryCount - 1,
                  MALFORMED_TOOL_CALL_RETRY_NOTES.length - 1,
                )];
            currentMessages.push({
              role: 'user',
              content: retryNote,
            });
            yield {
              type: 'status_update',
              message: buildMalformedToolCallRetryMessage(malformedToolCallRetryCount),
            };
            retryDueToMalformedToolCall = true;
            break;
          }

          yield {
            type: 'error',
            error: buildExhaustedMalformedToolCallError(e),
          };
          return;
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
      // Detect "lazy" responses where the model describes tool use intent but didn't
      // actually make any tool calls. This is common with MiniMax M3 which tends to
      // output planning text ("我先读取...", "Let me explore...") instead of calling tools.
      if (
        !effectiveNoTools
        && looksLikeLazyToolCallResponse(assistantMessageContent, round, !effectiveNoTools)
      ) {
        // Don't save the lazy response — pop it and nudge the model
        currentMessages.pop();
        currentMessages.push({
          role: 'user',
          content: LAZY_TOOL_CALL_NUDGE,
        });
        yield { type: 'status_update', message: 'Model described tool actions without executing them. Retrying with a nudge.' };
        continue;
      }

      isTurnComplete = true;
      yield { type: 'turn_complete', tokenUsage };
      // Trigger background memory extraction (fire-and-forget)
      memoryHook.onTurnComplete(currentMessages);
      break; 
    }

    if (reserveFinalResponseRound && hasToolCalls) {
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

      // AUDIT-FIX [TOP-15-05 / T-03]: The previous code had no
      // timeout, so a consumer that never resolved `_resolveAll`
      // would hang the chat turn forever. Default is 5 minutes which
      // matches the original audit fix (R4-03). The default is
      // overridable via `process.env.PIPI_TOOL_BATCH_TIMEOUT_MS` so
      // tests can use a tighter value.
      const TOOL_BATCH_TIMEOUT_MS = Number.parseInt(
        (typeof process !== 'undefined' && process.env?.PIPI_TOOL_BATCH_TIMEOUT_MS) || '300000',
        10,
      ) || 300_000;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Tool batch timed out after ${TOOL_BATCH_TIMEOUT_MS / 1000}s`)),
          TOOL_BATCH_TIMEOUT_MS,
        );
        if (typeof timeoutId === 'object' && timeoutId !== null && 'unref' in timeoutId) {
          (timeoutId as unknown as { unref: () => void }).unref();
        }
      });

      let allContent: string[];
      let abortListener: (() => void) | null = null;
      try {
        const abortPromise = options?.signal
          ? new Promise<never>((_, reject) => {
            if (options.signal?.aborted) {
              reject(new Error('Chat turn aborted'));
              return;
            }
            abortListener = () => {
              reject(new Error('Chat turn aborted'));
            };
            options.signal?.addEventListener('abort', abortListener, { once: true });
          })
          : null;
        allContent = await Promise.race([
          Promise.all(promises),
          timeoutPromise,
          ...(abortPromise ? [abortPromise] : []),
        ]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (options?.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
        }
      }
      toolBudgetSummary = appendToolBudgetEntries(
        toolBudgetSummary,
        pendingToolCalls.map((tool, index) => ({
          name: tool.name,
          content: allContent[index] ?? 'Error: no result returned for tool',
        })),
      );
      // AUDIT-FIX: short-circuit if every tool in this batch failed with a
      // policy/infrastructure block. Recoverable operational failures (e.g.
      // ENOENT) are fed back to the model so it can try another path.
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
          yield {
            type: 'error',
            error: withToolBudgetSummary(
              new Error(BROWSER_NOT_CONNECTED_USER_MESSAGE),
              toolBudgetSummary,
            ),
          };
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
            error: withToolBudgetSummary(
              new Error(
                '当前为问答模式，无法执行工具。请在弹窗中切换到规划或危险模式，然后点击「重试」。',
              ),
              toolBudgetSummary,
            ),
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
          error: withToolBudgetSummary(
            new Error(
              `本轮所有工具调用都被拒绝。具体原因：\n${failureDetail}\n\n`
              + `（${buildToolBatchFailureHint(currentModeId)}）`,
            ),
            toolBudgetSummary,
          ),
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
    
    // Append the tool results to the context for the next round
    for (const result of toolResults) {
      currentMessages.push({
        role: 'user',
        // AUDIT-FIX [audit-1#3] — The __TOOL_RESULT__ sentinel is a transport-
        // only token used by this project's Rust adapter to pair tool results
        // with their originating tool_call_id. It lives in the in-memory
        // `currentMessages` context that gets sent to the model and is NEVER
        // persisted to the DB or rendered in the UI. Two consumer invariants
        // depend on this:
        //   1. chatHelpers.parseThinkContent must skip these lines so a tool
        //      result containing literal "<think>..." text isn't misclassified.
        //   2. UI filtering (Chat.tsx / ChatBrowserWorkspaceShell.tsx) detects
        //      the prefix as a safety belt in case anything leaks through.
        // If you ever start persisting these into the message store, you MUST
        // move the result into `message.metadata.toolResult` instead.
        content: `__TOOL_RESULT__:${result.id}:${result.content}`,
        tool_call_id: result.id,
        // Skip persistence + display via the established filter paths.
        metadata: { toolResult: true, hidden: true },
      });
    }
  }

  if (!isTurnComplete && toolBudgetSummary.toolBudgetUsedRaw >= maxToolBudget && !reserveFinalResponseRound) {
    yield {
      type: 'error',
      error: withToolBudgetSummary(
        new Error(
          `The agent exceeded its tool loop limit (${maxToolBudget} tool rounds). `
          + `tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; `
          + `failed_calls=${toolBudgetSummary.failedCalls}; `
          + `successful_calls=${toolBudgetSummary.successfulCalls}. `
          + 'Try Ask mode for questions or Agent mode for tasks.',
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
          `The agent exceeded its reasoning/tool loop limit (${maxModelRounds} model rounds). `
          + `tool_budget_used=${toolBudgetSummary.toolBudgetUsed}; `
          + `failed_calls=${toolBudgetSummary.failedCalls}; `
          + `successful_calls=${toolBudgetSummary.successfulCalls}. `
          + 'Try Ask mode for questions or Agent mode for tasks.',
        ),
        toolBudgetSummary,
      ),
    };
  }
}
