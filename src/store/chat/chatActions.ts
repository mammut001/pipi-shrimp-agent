import { invoke } from '@tauri-apps/api/core';

import type { TokenUsage } from '../../core/types';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { safeInvoke, safeInvokeOrNull } from '../../utils/safeInvoke';
import { formatError } from '../../utils/errorFormat';
import {
  buildApiMessages,
  mergeReasoningParts,
  messageToDb,
  parseThinkContent,
} from '../../utils/chatHelpers';
import type { ChatSendOptions, ChatState, Message } from '../../types/chat';
import { createMessage } from '../../types/chat';
import { usePromptStore } from '../promptStore';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from '../taskRegistryStore';
import { useUIStore } from '../uiStore';
import { appendBrowserResultToSystemPrompt, createBrowserResultMessages, mapBrowserResponseArtifacts } from './chatBrowserHandoff';
import { CHAT_ERROR_MESSAGES, normalizeCaughtErrorMessage } from './chatErrors';
import { shouldPersistMessage } from './chatPersistence';
import { PLAN_MODE_SYSTEM_PROMPT, savePlanModeDoc, shouldSavePlanDoc } from '@/services/planMode';
import {
  clearSessionToolRuntime,
  failUnresolvedSessionTools,
  syncSessionToolRuntimeToCurrentSession,
} from './toolRuntimeState';
import {
  createStreamingAccumulator,
  flushBuffer,
  handleStreamChunk,
  resolveStreamingOwnerSessionId,
  shouldFlushStreamingUpdate,
  STREAMING_TIMEOUT_MS,
} from './chatStreaming';
import { handleToolBatchRequest } from './chatToolExecution';
import {
  abortActiveStreaming,
  clearStreamingAbortController,
  markStreamingAbortController,
} from './streamingAbort';

export function shouldRemoveEmptyAssistantPlaceholder(message: Message | undefined): boolean {
  return Boolean(message && message.role === 'assistant' && !message.content && !message.reasoning);
}

export function withUpdatedTimestamp<T extends { updatedAt: number }>(value: T, now = Date.now()): T {
  return { ...value, updatedAt: now };
}

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

type ChatActionMethodKeys =
  | 'generateBrowserResultResponse'
  | 'sendMessage'
  | 'stopGeneration'
  | 'retryLastMessage'
  | 'addMessage'
  | 'addMessageToSession'
  | 'updateLastMessage'
  | 'updateMessageContent'
  | 'appendStreamingContent'
  | 'setStreaming'
  | 'setError'
  | 'clearError';

export interface ChatActionFactoryDeps {
  set: ChatSetState;
  get: () => ChatState;
  ensureSessionWorkDir: (sessionId: string, set: ChatSetState, get: () => ChatState) => Promise<string | null>;
  runMicrocompactAfterStreaming: (sessionId: string, set: ChatSetState, get: () => ChatState) => Promise<void>;
  runSMCompactAfterStreaming: (sessionId: string, set: ChatSetState, get: () => ChatState) => Promise<void>;
}

let activeChatDiagnosticsTaskId: string | null = null;
const cancellationRequestedSessions = new Set<string>();

/**
 * AUDIT-2026-06-02 (session isolation): tracks the session whose engine is
 * currently streaming. `stopGeneration` was previously reading
 * `get().currentSessionId` — which is the session the user is VIEWING right now,
 * not necessarily the one whose model is actually streaming. After a fast
 * switch (A starts a turn, user clicks B, then user clicks Stop) the original
 * code cancelled B and left A's engine running forever, leaking tokens and
 * letting A's response corrupt B's last assistant message.
 *
 * `activeStreamingSessionId` is set when sendMessage begins streaming and
 * cleared in its finally block. `stopGeneration` consults it first, falling
 * back to currentSessionId for legacy callers.
 */
let activeStreamingSessionId: string | null = null;

function markStreamingSessionActive(sessionId: string): void {
  activeStreamingSessionId = sessionId;
}

function clearStreamingSessionActive(sessionId: string | null | undefined): void {
  if (sessionId && activeStreamingSessionId === sessionId) {
    activeStreamingSessionId = null;
  }
}

class ChatGenerationCancelledError extends Error {
  sessionId: string;

  constructor(sessionId: string) {
    super(`Chat generation cancelled for session ${sessionId}`);
    this.name = 'ChatGenerationCancelledError';
    this.sessionId = sessionId;
  }
}

function requestChatGenerationCancel(sessionId: string | null | undefined): void {
  if (sessionId) {
    cancellationRequestedSessions.add(sessionId);
  }
}

function clearChatGenerationCancel(sessionId: string | null | undefined): void {
  if (sessionId) {
    cancellationRequestedSessions.delete(sessionId);
  }
}

function consumeChatGenerationCancel(sessionId: string | null | undefined): boolean {
  if (!sessionId) {
    return false;
  }
  const requested = cancellationRequestedSessions.has(sessionId);
  if (requested) {
    cancellationRequestedSessions.delete(sessionId);
  }
  return requested;
}

function isChatGenerationCancelledError(error: unknown): error is ChatGenerationCancelledError {
  return error instanceof ChatGenerationCancelledError;
}

export function createChatActionMethods({
  set,
  get,
  ensureSessionWorkDir,
  runMicrocompactAfterStreaming,
  runSMCompactAfterStreaming,
}: ChatActionFactoryDeps): Pick<ChatState, ChatActionMethodKeys> {
  return {
    generateBrowserResultResponse: async (browserResult: string, originalQuery: string) => {
      const {
        currentSessionId,
        addMessage,
        setStreaming,
        setError,
      } = get();

      if (!currentSessionId) {
        return;
      }

      // AUDIT-2026-06-02 (session isolation): pin the session at the start
      // of the operation so post-await mutations land in the session that
      // owns the work, even if the user switched away mid-flight.
      const pinnedSessionId = currentSessionId;

      const resolvedConfig = resolveActiveAgentConfig();
      const configIssues = validateResolvedAgentConfig(resolvedConfig);
      if (configIssues.length > 0) {
        setError(formatAgentConfigValidationError(resolvedConfig, configIssues));
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        setStreaming(true);
        set({ streamingContent: '', streamingSessionId: currentSessionId });

        timeoutId = setTimeout(() => {
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
            safeInvokeOrNull('stop_subprocess', { sessionId: currentSessionId });
          }
        }, STREAMING_TIMEOUT_MS);

        const messages = createBrowserResultMessages(originalQuery);
        const assistantMessage = createMessage('assistant', '');
        // AUDIT-2026-06-02 (B6 / B3): pin the placeholder to pinnedSessionId
        // so it lands in the session that owns the browser-result follow-up.
        await get().addMessageToSession(pinnedSessionId, assistantMessage);

        const baseSystemPrompt = useUIStore.getState().agentInstructions;
        const currentSession = get().sessions.find((session) => session.id === currentSessionId);
        const sessionWorkDir = currentSession?.workDir;
        const systemPrompt = appendBrowserResultToSystemPrompt(
          baseSystemPrompt,
          originalQuery,
          browserResult,
          sessionWorkDir,
        );

        const request = buildResolvedChatRequest(resolvedConfig!, {
          messages,
          systemPrompt,
          noTools: true,
          allowBrowserTools: true,
          sessionId: currentSessionId,
        });

        const response = await invoke<{
          content: string;
          artifacts: Array<{ type: string; content: string; title?: string; language?: string }>;
          model: string;
          usage: {
            input_tokens: number;
            output_tokens: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
          tool_calls: Array<{ tool_call_id: string; name: string; arguments: string }>;
        }>('send_claude_sdk_chat_streaming', request.params);

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const { streamingContent: finalContent, streamingReasoning } = get();
        const { updateLastMessage } = get();
        const rawContent = finalContent || response.content || '';
        const { content: cleanContent, reasoning: parsedReasoning } = parseThinkContent(rawContent);

        const tokenUsage = response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
              cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
              cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
              model: response.model || resolvedConfig!.model,
            }
          : undefined;

        await updateLastMessage(
          cleanContent,
          mapBrowserResponseArtifacts(response.artifacts, () => crypto.randomUUID()),
          mergeReasoningParts(streamingReasoning, parsedReasoning),
          tokenUsage,
          pinnedSessionId,
        );

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const errorMsg = normalizeCaughtErrorMessage(error, CHAT_ERROR_MESSAGES.browserResponseFailed);
        setError(errorMsg);

        const { streamingContent: errContent, streamingReasoning: errReasoning, updateLastMessage: saveLastMsg } = get();
        if (errContent || errReasoning) {
          const { content: cleanErr, reasoning: parsedErrReasoning } = parseThinkContent(errContent || '');
          void saveLastMsg(cleanErr, undefined, mergeReasoningParts(errReasoning, parsedErrReasoning), undefined, pinnedSessionId).catch((saveError: unknown) => {
            console.error('Failed to persist browser response error content:', saveError);
          });
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        const sessionId = get().currentSessionId;
        if (sessionId) {
          set((state) => ({
            sessions: state.sessions.map((session) => {
              if (session.id !== sessionId || session.messages.length === 0) {
                return session;
              }
              const last = session.messages[session.messages.length - 1];
              if (shouldRemoveEmptyAssistantPlaceholder(last)) {
                return { ...session, messages: session.messages.slice(0, -1) };
              }
              return session;
            }),
          }));
        }
      }
    },

    sendMessage: async (content: string, targetSessionId?: string, options?: ChatSendOptions) => {
      const {
        currentSessionId,
        currentMessages,
        addMessage,
        setStreaming,
        setError,
        isStreaming,
        streamingSessionId,
      } = get();

      const activeSessionId = targetSessionId || currentSessionId;
      if (!activeSessionId) {
        setError(CHAT_ERROR_MESSAGES.noActiveSession);
        return;
      }

      if (isStreaming && streamingSessionId === activeSessionId) {
        useUIStore.getState().addNotification('warning', '当前会话仍在处理中，请等待当前步骤完成后再发送。', activeSessionId);
        return;
      }

      const sessionSnapshot = get().sessions.find((session) => session.id === activeSessionId);
      const isPlanMode = sessionSnapshot?.permissionMode === 'plan-only';

      const diagnosticsTaskId = `chat:${activeSessionId}:${Date.now()}`;
      activeChatDiagnosticsTaskId = diagnosticsTaskId;
      registerDiagnosticsTask({
        id: diagnosticsTaskId,
        kind: 'chat',
        source: `session:${activeSessionId}`,
        state: 'created',
        cancelable: true,
        title: content.trim().slice(0, 120),
      });
      registerDiagnosticsTaskCancel(diagnosticsTaskId, async () => {
        await get().stopGeneration();
      });

      useUIStore.getState().clearTaskProgress();
      clearChatGenerationCancel(activeSessionId);
      clearSessionToolRuntime(activeSessionId, set, get);

      const resolvedConfig = resolveActiveAgentConfig();
      const configIssues = validateResolvedAgentConfig(resolvedConfig);
      if (configIssues.length > 0) {
        setError(formatAgentConfigValidationError(resolvedConfig, configIssues));
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let streamState = createStreamingAccumulator();
      let sessionWorkDir: string | undefined;
      let turnHadError = false;
      let sawTurnComplete = false;
      let planDocSaved = false;

      try {
        const userMessage = createMessage('user', content, undefined, options?.attachments);
        // AUDIT-2026-06-02 (B6): use addMessageToSession with the pinned
        // activeSessionId rather than addMessage (which reads
        // get().currentSessionId at await resolution time). This guarantees
        // the user message lands on the intended session even if a
        // concurrent click triggers another selectSession between our
        // synchronous selectSession call and the next await boundary.
        if (targetSessionId && targetSessionId !== get().currentSessionId) {
          get().selectSession(targetSessionId);
        }
        await get().addMessageToSession(activeSessionId, userMessage);

        if (!isPlanMode) {
          try {
            const {
              classifyIntent,
              buildDelegationPlan,
              describePlan,
              runDelegationPlan: executePlan,
              buildSynthesisPrompt,
              resolveFollowThrough,
            } = await import('../../services/orchestration');

            const classification = classifyIntent(content);
            if (classification.shouldDelegate) {
              const plan = buildDelegationPlan(classification, content);
              if (plan.delegate && plan.agents.length > 0) {
                await addMessage(createMessage('assistant', describePlan(plan)));
                const currentSession = get().sessions.find((session) => session.id === activeSessionId);
                sessionWorkDir = currentSession?.workDir;
                const delegationResult = await executePlan(plan, activeSessionId, sessionWorkDir);
                const followThrough = resolveFollowThrough(plan);
                const synthesisPrompt = buildSynthesisPrompt(plan, delegationResult, followThrough);
                const synthesisMsg = createMessage('user', synthesisPrompt);
                synthesisMsg.metadata = {
                  orchestrationPlanId: plan.id,
                  orchestrationPhase: 'synthesis',
                  followThroughMode: followThrough.mode,
                  hidden: true,
                };
                await addMessage(synthesisMsg);
              }
            }
          } catch (orchestrationError) {
            console.warn('[Orchestration] Classification/delegation failed, continuing normally:', orchestrationError);
          }
        }

        setStreaming(true);
        set({ streamingContent: '', streamingSessionId: activeSessionId });
        markStreamingSessionActive(activeSessionId);
        // AUDIT-2026-06-02 (B4): explicit AbortController for this turn so
        // the streaming-timeout path and stopGeneration can actually break
        // the for-await loop instead of relying on stop_subprocess and
        // hoping the engine drains.
        const turnAbortController = new AbortController();
        markStreamingAbortController(activeSessionId, turnAbortController);
        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'running',
          cancelable: true,
          detail: content.trim().slice(0, 240),
        });

        timeoutId = setTimeout(() => {
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
            setError(`Response timeout (${STREAMING_TIMEOUT_MS / 1000}s exceeded). Please try again.`);
            safeInvokeOrNull('stop_subprocess', { sessionId: activeSessionId });
            // AUDIT-2026-06-02 (B4): also abort the in-flight engine so
            // the for-await loop breaks instead of waiting on
            // stop_subprocess to land and the engine to drain naturally.
            turnAbortController.abort(new Error(`Streaming timeout after ${STREAMING_TIMEOUT_MS / 1000}s`));
          }
        }, STREAMING_TIMEOUT_MS);

        const messages = buildApiMessages(currentMessages());
        if (messages.length === 0) {
          setError('Message content is empty. Cannot send.');
          setStreaming(false);
          set({ streamingSessionId: null });
          return;
        }

        const assistantMessage = createMessage('assistant', '');
        // AUDIT-2026-06-02 (B6): pin the placeholder to activeSessionId.
        await get().addMessageToSession(activeSessionId, assistantMessage);

        const template = usePromptStore.getState().getActiveTemplate();
        const currentSession = get().sessions.find((session) => session.id === activeSessionId);
        const sessionWorkingFiles = currentSession?.workingFiles ?? [];
        sessionWorkDir = currentSession?.workDir;

        if (!isPlanMode && sessionWorkDir && !currentSession?.outputDir) {
          try {
            const outputDir = await safeInvoke<string>('get_next_output_dir', { workDir: sessionWorkDir });
            await safeInvoke('create_directory', { path: outputDir });
            const updated = { ...currentSession!, outputDir, updatedAt: Date.now() };
            set((state) => ({
              sessions: state.sessions.map((session) => (session.id === activeSessionId ? updated : session)),
            }));
          } catch (error) {
            console.debug('Failed to auto-create output dir (non-fatal):', error);
          }
        }

        let coreMdContent = '';
        if (sessionWorkDir) {
          try {
            const coreMdPath = `${sessionWorkDir}/.pipi-shrimp/core.md`;
            const coreMdRes = await invoke<{ content: string; path: string }>('read_file', {
              path: coreMdPath,
              workDir: sessionWorkDir,
            });
            if (coreMdRes?.content) {
              coreMdContent = coreMdRes.content;
            }
          } catch (error) {
            console.debug('No core.md found or failed to read:', error);
          }
        }

        const workingFilesList = sessionWorkingFiles.length > 0
          ? sessionWorkingFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
          : '';

        let memoryContext = '';
        if (sessionWorkDir) {
          try {
            const { getMemoryDir, getTopicMemoriesDir } = await import('../../services/memory/memoryPaths');
            const { buildMemoryContext, findRelevantMemories } = await import('../../services/memory/relevantRecall');
            const memoryDir = await getMemoryDir(sessionWorkDir);
            const topicDir = getTopicMemoriesDir(memoryDir);
            const relevantMemories = await findRelevantMemories(topicDir, content);
            if (relevantMemories.length > 0) {
              memoryContext = await buildMemoryContext(relevantMemories);
            }
          } catch (error) {
            console.debug('Memory recall failed:', error);
          }
        }

        const { buildPrompt } = await import('../../services/prompt/promptBuilder');
        const { systemPrompt } = buildPrompt(template?.sections || [], {
          agentInstructions: useUIStore.getState().agentInstructions,
          workDir: sessionWorkDir || '',
          coreMdContent,
          workingFilesList,
          memoryContext,
          originalQuery: '',
          browserResult: '',
        });
        const finalSystemPrompt = isPlanMode
          ? `${systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`
          : systemPrompt;

        const { runChatTurn } = await import('../../core/QueryEngine');
        const engine = isPlanMode
          ? runChatTurn(activeSessionId, currentMessages(), finalSystemPrompt, sessionWorkDir, false, undefined, { noTools: true, signal: turnAbortController.signal })
          : runChatTurn(activeSessionId, currentMessages(), finalSystemPrompt, sessionWorkDir, options?.allowBrowserTools || false, undefined, { signal: turnAbortController.signal });
        const uiStore = useUIStore.getState();
        let tokenUsageResult: TokenUsage | undefined;
        // AUDIT-2026-06-02 (B7): accumulate every tool_call the engine
        // emits this turn so they can be persisted on the assistant
        // message. Without this the in-store assistant turn loses its
        // tool_calls history on reload (the engine sees them, the DB
        // doesn't).
        const accumulatedToolCalls: import('../../core/types').ToolCallParams[] = [];

        for await (const chunk of engine) {
          if (consumeChatGenerationCancel(activeSessionId)) {
            throw new ChatGenerationCancelledError(activeSessionId);
          }
          streamState = handleStreamChunk(streamState, chunk);

          if (chunk.type === 'text_delta') {
            get().appendStreamingContent(chunk.content);
          } else if (chunk.type === 'reasoning_delta') {
            set((state) => ({ streamingReasoning: state.streamingReasoning + chunk.content }));
          } else if (chunk.type === 'status_update') {
            uiStore.addNotification('info', chunk.message, activeSessionId);
          } else if (chunk.type === 'tool_batch_request') {
            // AUDIT-2026-06-02 (B7): remember the tool_calls that were
            // sent to handleToolBatchRequest so we can persist them on
            // the assistant message at turn end.
            for (const tool of chunk.tools) {
              accumulatedToolCalls.push(tool);
            }
            await handleToolBatchRequest(
              {
                chunk,
                activeSessionId,
                assistantMessageId: assistantMessage.id,
                get,
                set,
                ensureSessionWorkDir: () => ensureSessionWorkDir(activeSessionId, set, get),
              },
            );
            if (consumeChatGenerationCancel(activeSessionId)) {
              throw new ChatGenerationCancelledError(activeSessionId);
            }
          } else if (chunk.type === 'error') {
            throw chunk.error;
          } else if (chunk.type === 'turn_complete') {
            sawTurnComplete = true;
            tokenUsageResult = streamState.tokenUsage;
          }
        }

        if (consumeChatGenerationCancel(activeSessionId)) {
          throw new ChatGenerationCancelledError(activeSessionId);
        }

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const streamed = flushBuffer(streamState);
        const finalContent = get().streamingContent || streamed.content;
        const parsed = parseThinkContent(finalContent);
        const tokenUsage = tokenUsageResult
          ? {
              input_tokens: tokenUsageResult.input_tokens,
              output_tokens: tokenUsageResult.output_tokens,
              cache_read_input_tokens: tokenUsageResult.cache_read_input_tokens ?? 0,
              cache_creation_input_tokens: tokenUsageResult.cache_creation_input_tokens ?? 0,
              model: tokenUsageResult.model || resolvedConfig!.model,
            }
          : undefined;

        await get().updateLastMessage(
          parsed.content,
          undefined,
          mergeReasoningParts(get().streamingReasoning, streamed.reasoning, parsed.reasoning),
          tokenUsage,
          // AUDIT-2026-06-02 (session isolation): pin the session the
          // engine started with — never `currentSessionId`, which may
          // have changed under us if the user switched sessions while
          // we were awaiting the stream.
          activeSessionId,
          // AUDIT-2026-06-02 (B7): persist tool_calls so reload doesn't
          // diverge from the engine's view (e.g. drop assistant blocks
          // whose tool_use isn't matched).
          accumulatedToolCalls.length > 0
            ? accumulatedToolCalls.map((t) => ({
                id: t.id,
                name: t.name,
                arguments: t.arguments,
              }))
            : undefined,
        );

        if (tokenUsage) {
          const now = new Date();
          await safeInvoke('db_save_token_usage', {
            usage: {
              id: crypto.randomUUID(),
              session_id: activeSessionId,
              date: now.toISOString().split('T')[0],
              input_tokens: tokenUsage.input_tokens,
              output_tokens: tokenUsage.output_tokens,
              cache_read_input_tokens: tokenUsage.cache_read_input_tokens ?? 0,
              cache_creation_input_tokens: tokenUsage.cache_creation_input_tokens ?? 0,
              model: tokenUsage.model || resolvedConfig!.model,
              api_config_id: resolvedConfig!.configId,
              created_at: Math.floor(now.getTime() / 1000),
            },
          }).catch((error: unknown) => {
            console.error('Failed to save token usage:', error);
          });
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'completed',
          cancelable: false,
          detail: parsed.content.slice(0, 240),
        });
        activeChatDiagnosticsTaskId = null;
        useUIStore.getState().setActiveSkill(null);

        if (
          isPlanMode
          && sawTurnComplete
          && !turnHadError
          && !planDocSaved
        ) {
          const finalAssistantContent = parsed.content.trim();

          if (finalAssistantContent && shouldSavePlanDoc(finalAssistantContent)) {
            planDocSaved = true;

            try {
              const latestSession = get().sessions.find((session) => session.id === activeSessionId);
              let planWorkDir: string | null | undefined = latestSession?.workDir ?? sessionWorkDir;

              if (!planWorkDir) {
                planWorkDir = await ensureSessionWorkDir(activeSessionId, set, get);
              }

              if (planWorkDir) {
                sessionWorkDir = planWorkDir;
                const savedDoc = await savePlanModeDoc({
                  workDir: planWorkDir,
                  userRequest: content,
                  planMarkdown: finalAssistantContent,
                  sessionId: activeSessionId,
                });

                uiStore.addNotification('success', `Plan saved to Docs: ${savedDoc.filename}`, activeSessionId);
              } else {
                uiStore.addNotification(
                  'warning',
                  'Plan generated, but no working directory was available to save it to Docs.',
                  activeSessionId,
                );
              }
            } catch (planSaveError) {
              console.warn('[PlanMode] Failed to save plan document:', planSaveError);
              uiStore.addNotification('warning', 'Plan generated, but failed to save it to Docs.', activeSessionId);
            }
          }
        }

        try {
          const { triggerMemoryExtraction } = await import('../../services/memory/autoExtraction');
          const messagesForExtraction = currentMessages();
          if (messagesForExtraction.length >= 10) {
            triggerMemoryExtraction({
              messages: messagesForExtraction.map((message) => ({ role: message.role, content: message.content ?? '' })),
              projectRoot: sessionWorkDir ?? undefined,
            });
          }
        } catch (error) {
          console.debug('Auto memory extraction setup failed:', error);
        }

        await runMicrocompactAfterStreaming(activeSessionId, set, get);
        await runSMCompactAfterStreaming(activeSessionId, set, get);

        const { checkReactiveCompact } = await import('../../services/compact/reactiveCompact');
        const { triggerContextAnalysis } = await import('../../services/contextAnalysis/hooks/contextAnalysisTrigger');
        void triggerContextAnalysis(activeSessionId, currentMessages(), sessionWorkDir ?? undefined).catch((error: unknown) => {
          console.debug('[ContextAnalysis] Trigger failed:', error);
        });
        void checkReactiveCompact(activeSessionId, currentMessages()).catch((error: unknown) => {
          console.debug('[ReactiveCompact] Check failed:', error);
        });
      } catch (error) {
        if (isChatGenerationCancelledError(error)) {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          clearChatGenerationCancel(activeSessionId);
          clearStreamingSessionActive(activeSessionId);
          clearStreamingAbortController(activeSessionId);
          setStreaming(false);
          set({
            streamingContent: '',
            streamingReasoning: '',
            streamingSessionId: null,
            pendingToolCalls: 0,
            pendingToolResults: [],
          });
          updateDiagnosticsTask(diagnosticsTaskId, {
            state: 'cancelled',
            cancelable: false,
          });
          activeChatDiagnosticsTaskId = null;
          useUIStore.getState().setActiveSkill(null);

          set((state) => ({
            sessions: state.sessions.map((session) => {
              if (session.id !== activeSessionId || session.messages.length === 0) {
                return session;
              }
              const last = session.messages[session.messages.length - 1];
              if (shouldRemoveEmptyAssistantPlaceholder(last)) {
                return { ...session, messages: session.messages.slice(0, -1) };
              }
              return session;
            }),
          }));
          syncSessionToolRuntimeToCurrentSession(set, get);
          return;
        }

        turnHadError = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const errorMsg = normalizeCaughtErrorMessage(error, CHAT_ERROR_MESSAGES.sendFailed);
        setError(errorMsg);

        const { streamingContent: errContent, streamingReasoning: errReasoning, updateLastMessage: saveLastMsg } = get();
        if (errContent || errReasoning) {
          const flushed = flushBuffer(streamState);
          const parsed = parseThinkContent(errContent || flushed.content || '');
          // AUDIT-2026-06-02 (session isolation): pin the error-path persist
          // to the engine's session so flushed content lands on the right
          // last message after a fast switch.
          void saveLastMsg(parsed.content, undefined, mergeReasoningParts(errReasoning, flushed.reasoning, parsed.reasoning), undefined, activeSessionId).catch((saveError: unknown) => {
            console.error('Failed to persist sendMessage error content:', saveError);
          });
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'failed',
          cancelable: false,
          error: errorMsg,
        });
        activeChatDiagnosticsTaskId = null;
        useUIStore.getState().setActiveSkill(null);

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== activeSessionId || session.messages.length === 0) {
              return session;
            }
            const last = session.messages[session.messages.length - 1];
            if (shouldRemoveEmptyAssistantPlaceholder(last)) {
              return { ...session, messages: session.messages.slice(0, -1) };
            }
            return session;
          }),
        }));
      } finally {
        clearChatGenerationCancel(activeSessionId);
        clearStreamingSessionActive(activeSessionId);
        clearStreamingAbortController(activeSessionId);
      }
    },

    stopGeneration: async () => {
      const {
        isStreaming,
        streamingContent,
        streamingReasoning,
        setStreaming,
        currentSessionId,
        setError,
        pendingToolCalls,
        pendingToolResults,
      } = get();
      if (!isStreaming && pendingToolCalls === 0 && pendingToolResults.length === 0) {
        return;
      }

      // AUDIT-2026-06-02 (session isolation): prefer the engine's actual session
      // over whatever the user is currently viewing. Otherwise a fast switch
      // before clicking Stop cancels the wrong session and leaves the original
      // engine running.
      const targetSessionId = activeStreamingSessionId ?? currentSessionId;

      requestChatGenerationCancel(targetSessionId);
      // AUDIT-2026-06-02 (B4): fire the AbortSignal too — without this the
      // engine's for-await loop would keep draining until it hit a chunk
      // boundary check, which can be slow on a long-running stream.
      abortActiveStreaming(targetSessionId, 'User clicked Stop');
      if (targetSessionId) {
        failUnresolvedSessionTools(
          targetSessionId,
          set,
          get,
          (_toolCallId, label) => `Error: ${label} cancelled by user`,
        );
      }

      try {
        await safeInvoke('stop_subprocess', { sessionId: targetSessionId }, { silent: true });
      } catch (error) {
        console.error('Failed to stop subprocess:', error);
        setError(`Failed to stop generation: ${formatError(error)}`);
      }

      const flushed = flushBuffer({
        content: streamingContent,
        reasoning: streamingReasoning,
        statusMessages: [],
      });
      set({ streamingContent: '', streamingReasoning: '' });

      if (targetSessionId && (flushed.content || flushed.reasoning)) {
        // AUDIT-2026-06-02 (session isolation): pin the engine's session
        // (computed above) so the final flush lands on the right last
        // assistant message even after a fast switch.
        await get().updateLastMessage(flushed.content, undefined, flushed.reasoning, undefined, targetSessionId);
      }

      setStreaming(false);
      set({ pendingToolCalls: 0, pendingToolResults: [] });
      if (activeChatDiagnosticsTaskId) {
        updateDiagnosticsTask(activeChatDiagnosticsTaskId, {
          state: 'cancelled',
          cancelable: false,
        });
        activeChatDiagnosticsTaskId = null;
      }
    },

    retryLastMessage: async () => {
      const { currentSessionId, sessions, error } = get();
      if (!currentSessionId || !error) {
        return;
      }

      const session = sessions.find((candidate) => candidate.id === currentSessionId);
      if (!session) {
        return;
      }

      const messages = session.messages;
      const lastUserIndex = [...messages].reverse().findIndex((message) => message.role === 'user');
      if (lastUserIndex === -1) {
        set({ error: null });
        return;
      }

      const actualIndex = messages.length - 1 - lastUserIndex;
      const lastUserMessage = messages[actualIndex];
      const messagesToDelete = messages.slice(actualIndex);

      set((state) => ({
        error: null,
        pendingToolCalls: 0,
        pendingToolResults: [],
        sessions: state.sessions.map((candidate) => (
          candidate.id === currentSessionId
            ? { ...candidate, messages: candidate.messages.slice(0, actualIndex) }
            : candidate
        )),
      }));

      await Promise.allSettled(messagesToDelete.map((message) => safeInvokeOrNull('db_delete_message', { messageId: message.id })));
        await get().sendMessage(lastUserMessage.content, undefined, {
          attachments: lastUserMessage.attachments,
        });
    },

    addMessage: async (message: Message) => {
      const { currentSessionId } = get();
      if (!currentSessionId) {
        return;
      }

      if (shouldPersistMessage(message)) {
        try {
          await safeInvoke('db_save_message', { message: messageToDb(message, currentSessionId) });
        } catch (error) {
          console.error('Failed to save message to database:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((session) => (
          session.id === currentSessionId
            ? { ...session, messages: [...session.messages, message], updatedAt: Date.now() }
            : session
        )),
      }));
    },

    addMessageToSession: async (sessionId: string, message: Message) => {
      if (shouldPersistMessage(message)) {
        try {
          await safeInvoke('db_save_message', { message: messageToDb(message, sessionId) });
        } catch (error) {
          console.warn('[addMessageToSession] DB persist failed:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((session) => (
          session.id === sessionId
            ? { ...session, messages: [...session.messages, message], updatedAt: Date.now() }
            : session
        )),
      }));
    },

    updateLastMessage: async (
      content: string,
      artifacts?: Message['artifacts'],
      reasoning?: string,
      tokenUsage?: Message['token_usage'],
      targetSessionId?: string,
      toolCalls?: Message['tool_calls'],
    ) => {
      // AUDIT-2026-06-02 (session isolation): prefer the explicit target
      // session over `currentSessionId` so post-await mutations land in the
      // session that owns the work, even if the user switched away.
      const sessionId = targetSessionId ?? get().currentSessionId;
      if (!sessionId) {
        return;
      }

      let messageToUpdate: Message | null = null;

      set((state) => ({
        sessions: state.sessions.map((session) => {
          if (session.id !== sessionId || session.messages.length === 0) {
            return session;
          }

          const lastMessageIndex = session.messages.length - 1;
          const lastMessage = session.messages[lastMessageIndex];
          if (lastMessage.role !== 'assistant') {
            return session;
          }

          const updatedMessage = {
            ...lastMessage,
            content,
            reasoning: mergeReasoningParts(reasoning, lastMessage.reasoning),
            artifacts: artifacts !== undefined ? artifacts : lastMessage.artifacts,
            token_usage: tokenUsage !== undefined ? tokenUsage : lastMessage.token_usage,
            // AUDIT-2026-06-02 (B7): write tool_calls when supplied. Merge
            // so a later updateLastMessage that doesn't pass toolCalls
            // does NOT erase a previous round's persisted calls.
            tool_calls: toolCalls !== undefined ? toolCalls : lastMessage.tool_calls,
            updatedAt: Date.now(),
          };

          messageToUpdate = updatedMessage;
          return {
            ...session,
            messages: session.messages.map((message, index) => (index === lastMessageIndex ? updatedMessage : message)),
            updatedAt: Date.now(),
          };
        }),
      }));

      if (messageToUpdate) {
        try {
          await safeInvoke('db_save_message', { message: messageToDb(messageToUpdate, sessionId) });
        } catch (error) {
          console.error('Failed to persist streaming update to database:', error);
        }
      }
    },

    updateMessageContent: async (messageId: string, content: string, metadata?: Record<string, unknown>) => {
      const { currentSessionId } = get();
      if (!currentSessionId) {
        return;
      }

      let messageToUpdate: Message | null = null;

      set((state) => ({
        sessions: state.sessions.map((session) => {
          if (session.id !== currentSessionId) {
            return session;
          }

          const messageIndex = session.messages.findIndex((message) => message.id === messageId);
          if (messageIndex === -1) {
            return session;
          }

          const updatedMessage: Message = {
            ...session.messages[messageIndex],
            content,
            metadata: metadata !== undefined
              ? { ...session.messages[messageIndex].metadata, ...metadata }
              : session.messages[messageIndex].metadata,
          };

          messageToUpdate = updatedMessage;
          const newMessages = [...session.messages];
          newMessages[messageIndex] = updatedMessage;
          return { ...session, messages: newMessages, updatedAt: Date.now() };
        }),
      }));

      if (messageToUpdate) {
        try {
          await safeInvoke('db_save_message', { message: messageToDb(messageToUpdate, currentSessionId) });
        } catch (error) {
          console.error('Failed to persist updateMessageContent to database:', error);
        }
      }
    },

    appendStreamingContent: (content: string) => {
      const { currentSessionId, streamingContent, lastUiUpdateTime } = get();
      const newContent = streamingContent + content;
      const now = Date.now();
      set({ streamingContent: newContent });

      if (shouldFlushStreamingUpdate(now, lastUiUpdateTime) && currentSessionId) {
        const flushed = flushBuffer({
          content: newContent,
          reasoning: get().streamingReasoning,
          statusMessages: [],
        });
        set((state) => ({
          lastUiUpdateTime: now,
          sessions: state.sessions.map((session) => {
            if (session.id !== currentSessionId || session.messages.length === 0) {
              return session;
            }
            const messages = [...session.messages];
            const lastMessage = messages[messages.length - 1];
            messages[messages.length - 1] = {
              ...lastMessage,
              content: flushed.content,
              reasoning: mergeReasoningParts(flushed.reasoning, lastMessage.reasoning),
            };
            return { ...session, messages, updatedAt: Date.now() };
          }),
        }));
      }
    },

    setStreaming: (streaming: boolean) => {
      const { streamingTimeoutId, currentSessionId, streamingContent } = get();
      if (!streaming && streamingTimeoutId) {
        clearTimeout(streamingTimeoutId);
        if (currentSessionId && streamingContent) {
          const flushed = flushBuffer({
            content: streamingContent,
            reasoning: get().streamingReasoning,
            statusMessages: [],
          });
          set((state) => ({
            isStreaming: false,
            streamingTimeoutId: null,
            sessions: state.sessions.map((session) => {
              if (session.id !== currentSessionId || session.messages.length === 0) {
                return session;
              }
              const messages = [...session.messages];
              const lastMessage = messages[messages.length - 1];
              messages[messages.length - 1] = {
                ...lastMessage,
                content: flushed.content,
                reasoning: mergeReasoningParts(flushed.reasoning, lastMessage.reasoning),
              };
              return { ...session, messages, updatedAt: Date.now() };
            }),
          }));
        } else {
          set({ isStreaming: false, streamingTimeoutId: null });
        }
        return;
      }

      if (streaming) {
        const timeoutId = setTimeout(() => {
          const { currentSessionId: fallbackSessionId, setStreaming, streamingSessionId } = get();
          const owningSessionId = resolveStreamingOwnerSessionId(streamingSessionId, fallbackSessionId);
          if (owningSessionId) {
            safeInvokeOrNull('stop_subprocess', { sessionId: owningSessionId });
          }
          setStreaming(false);
          set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        }, STREAMING_TIMEOUT_MS);

        void import('../../services/compact/microCompact').then(({ resetMicrocompactForNewTurn }) => {
          resetMicrocompactForNewTurn();
        });
        set({ isStreaming: true, streamingTimeoutId: timeoutId });
      }
    },

    setError: (error: string | null) => {
      set({ error });
    },

    clearError: () => {
      set({ error: null });
    },
  };
}
