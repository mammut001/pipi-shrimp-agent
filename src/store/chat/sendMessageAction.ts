import type { TokenUsage } from '../../core/types';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { safeInvoke } from '../../utils/safeInvoke';
import { runChatTurn } from '../../core/QueryEngine';
import { getSessionHandle } from '../../core/runtime';
import { mergeReasoningParts, parseThinkContent } from '../../utils/chatHelpers';
import type { ChatSendOptions, ChatState, Message } from '../../types/chat';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from '../taskRegistryStore';
import { useSettingsStore, useUIStore } from '@/store';
import { CHAT_ERROR_MESSAGES, normalizeCaughtErrorMessage } from './chatErrors';
import {
  savePlanModeDoc,
  shouldSavePlanDoc,
} from '@/services/planMode';
import {
  getExecutionMode,
  resolveSessionExecutionModeId,
  detectAskModeToolNeed,
  type AskModeToolNeedReason,
} from '@/services/executionMode';
import { useCdpStore } from '@/store/cdpStore';
import {
  clearSessionToolRuntime,
  syncSessionToolRuntimeToCurrentSession,
} from './toolRuntimeState';
import {
  clearAssistantPendingToolCalls,
  persistAssistantPendingToolCalls,
} from './scrubDanglingToolCalls';
import {
  bumpChatSessionTurnEpoch,
  clearChatGenerationCancel,
  clearStreamingBuffer,
  clearStreamingRoundBuffers,
  consumeChatGenerationCancel,
  createChatTurnAbortController,
  createStreamingAccumulator,
  flushBuffer,
  getChatSessionTurnEpoch,
  handleStreamChunk,
  ownsSelectedStreamChrome,
  resolveSessionStreamReasoning,
  resolveSessionStreamText,
} from './chatStreaming';
import { handleToolBatchRequest } from './chatToolExecution';
import {
  resolveRealSessionPipiOutputDir,
} from '@/utils/sessionFolders';
import { t } from '@/i18n';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import { prepareSendMessageContext } from './sendMessagePreparation';
import { stripGoalMarkers } from '@/services/sessionGoal/goalEvaluator';
import { decideGoalLoopAfterTurn, shouldRunGoalLoop } from '@/services/sessionGoal/goalLoop';
import type { ChatActionFactoryDeps } from './chatActions';

export interface SendMessageActionDependencies extends ChatActionFactoryDeps {
  setActiveChatDiagnosticsTaskId: (sessionId: string | null, taskId: string | null) => void;
  getActiveChatDiagnosticsTaskId: (sessionId: string | null) => string | null;
  ChatGenerationCancelledError: new (sessionId: string) => Error & { sessionId: string };
  isChatGenerationCancelledError: (error: unknown) => boolean;
  looksLikeAskModePseudoToolCall: (content: string) => boolean;
  buildAskModeToolUnavailableReply: (userRequest: string) => string;
  ensureChatSessionForSend: (get: () => ChatState, preferredSessionId?: string | null) => Promise<string | null>;
  pinChatSession: (sessionId: string, get: () => ChatState) => void;
  tryRecoverFromToolPolicyError: (
    errorMsg: string,
    userContent: string,
    activeSessionId: string,
    get: () => ChatState,
    set: ChatActionFactoryDeps['set'],
    turnEpoch: number,
  ) => Promise<boolean>;
  removeEmptyAssistantPlaceholderById: (
    set: ChatActionFactoryDeps['set'],
    sessionId: string,
    messageId: string | null | undefined,
  ) => void;
  shouldRemoveEmptyAssistantPlaceholder: (message: Message | undefined) => boolean;
  clearStreamChromeIfSelected: (
    set: ChatActionFactoryDeps['set'],
    get: () => ChatState,
    owningSessionId: string,
    extra?: Record<string, unknown>,
  ) => void;
}

export function createSendMessageActionMethod(
  dependencies: SendMessageActionDependencies,
): ChatState['sendMessage'] {
  const {
    set,
    get,
    ensureSessionWorkDir,
    runMicrocompactAfterStreaming,
    runSMCompactAfterStreaming,
    setActiveChatDiagnosticsTaskId,
    getActiveChatDiagnosticsTaskId,
    ChatGenerationCancelledError,
    isChatGenerationCancelledError,
    looksLikeAskModePseudoToolCall,
    buildAskModeToolUnavailableReply,
    ensureChatSessionForSend,
    pinChatSession,
    tryRecoverFromToolPolicyError,
    removeEmptyAssistantPlaceholderById,
    shouldRemoveEmptyAssistantPlaceholder,
    clearStreamChromeIfSelected,
  } = dependencies;
  return async (content: string, targetSessionId?: string, options?: ChatSendOptions) => {
      const {
        currentSessionId,
        currentMessages,
        addMessage,
        setStreaming,
        setError,
        isStreaming,
        streamingSessionId,
      } = get();

      let activeSessionId = targetSessionId || currentSessionId || null;

      if (activeSessionId && isStreaming && streamingSessionId === activeSessionId) {
        useUIStore.getState().addNotification('warning', '当前会话仍在处理中，请等待当前步骤完成后再发送。', activeSessionId);
        return;
      }

      let sessionSnapshot = activeSessionId
        ? get().sessions.find((session) => session.id === activeSessionId)
        : undefined;
      let executionModeId = resolveSessionExecutionModeId(sessionSnapshot);
      let executionModeProfile = getExecutionMode(executionModeId);
      let isAskMode = executionModeId === 'ask';
      let isPlanMode = executionModeId === 'plan';

      if (isAskMode && !options?.goalLoopContinuation) {
        const toolNeed = detectAskModeToolNeed(content);
        if (toolNeed.needed) {
          const choice = await useUIStore.getState().showExecutionModeUpgradePrompt({
            reason: toolNeed.reason,
            messagePreview: content.trim().slice(0, 240),
          });
          if (choice === 'cancel') {
            return;
          }

          if (!activeSessionId) {
            activeSessionId = await ensureChatSessionForSend(get, targetSessionId);
            if (!activeSessionId) {
              return;
            }
            sessionSnapshot = get().sessions.find((session) => session.id === activeSessionId);
            executionModeId = resolveSessionExecutionModeId(sessionSnapshot);
            executionModeProfile = getExecutionMode(executionModeId);
            isAskMode = executionModeId === 'ask';
            isPlanMode = executionModeId === 'plan';
          }

          pinChatSession(activeSessionId, get);
          await get().updateSessionExecutionMode(activeSessionId, choice);
          const refreshedSession = get().sessions.find((session) => session.id === activeSessionId);
          executionModeId = resolveSessionExecutionModeId(refreshedSession);
          executionModeProfile = getExecutionMode(executionModeId);
          isAskMode = executionModeId === 'ask';
          isPlanMode = executionModeId === 'plan';
          useUIStore.getState().addNotification(
            'info',
            choice === 'bypass'
              ? t('executionMode.upgrade.switchedToDanger')
              : t('executionMode.upgrade.switchedToPlan'),
            activeSessionId,
          );
        }
      }

      if (!activeSessionId) {
        activeSessionId = await ensureChatSessionForSend(get, targetSessionId);
        if (!activeSessionId) {
          setError(CHAT_ERROR_MESSAGES.noActiveSession);
          return;
        }
        sessionSnapshot = get().sessions.find((session) => session.id === activeSessionId);
        executionModeId = resolveSessionExecutionModeId(sessionSnapshot);
        executionModeProfile = getExecutionMode(executionModeId);
        isAskMode = executionModeId === 'ask';
        isPlanMode = executionModeId === 'plan';
      }

      pinChatSession(activeSessionId, get);

      const diagnosticsTaskId = `chat:${activeSessionId}:${Date.now()}`;
      setActiveChatDiagnosticsTaskId(activeSessionId, diagnosticsTaskId);
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
      // Bump turn epoch so an in-flight stopGeneration (optimistic busy clear
      // before cancel_tool_execution settles) ignores stale cancel completion,
      // and so this turn's cancel catch cannot mutate a newer same-session turn.
      const turnEpoch = bumpChatSessionTurnEpoch(activeSessionId);
      clearSessionToolRuntime(activeSessionId, set, get);
      setError(null);

      const resolvedConfig = resolveActiveAgentConfig();
      const configIssues = validateResolvedAgentConfig(resolvedConfig);
      if (configIssues.length > 0) {
        setError(formatAgentConfigValidationError(resolvedConfig, configIssues));
        return;
      }

      // AUDIT-FIX [audit-1#1] — Streaming timeout is owned by setStreaming(true) via the
      // store-level `streamingTimeoutId`. Previously sendMessage also armed a private
      // timeout here, which would race with the store timer (each clearTimeout only
      // cleared its own handle). We no longer start a local timer; on completion or
      // cancellation we rely on setStreaming(false) / store cancel logic to clear it.
      clearStreamingBuffer(activeSessionId);
      let streamState = createStreamingAccumulator();
      let sessionWorkDir: string | undefined;
      let turnHadError = false;
      let sawTurnComplete = false;
      let planDocSaved = false;
      let assistantMessage: Message | null = null;

      try {
        const preparation = await prepareSendMessageContext({
          content, activeSessionId, options, isAskMode, isPlanMode, executionModeId,
          executionModeProfile, diagnosticsTaskId, turnEpoch, sessionWorkDir,
          onAssistantMessageCreated: (message) => { assistantMessage = message; },
          get, set, currentMessages, addMessage, setStreaming, setError,
          setActiveChatDiagnosticsTaskId, ChatGenerationCancelledError, clearStreamChromeIfSelected,
        });
        if (!preparation.ready) return;
        assistantMessage = preparation.assistantMessage;
        sessionWorkDir = preparation.sessionWorkDir;
        const {
          sessionPipiOutputDir,
          finalSystemPrompt,
          shouldAllowBrowserTools,
          modeAllowedTools,
        } = preparation;
        // Final epoch re-check: Stop → newer Send may advance the epoch during
        // any post-scrub await (placeholder persist, pipi-output resolve, core.md,
        // memory, CDP connect, …). createChatTurnAbortController aborts+replaces
        // the session controller — must not install/take over if this turn is stale.
        if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
          throw new ChatGenerationCancelledError(activeSessionId);
        }
        const turnAbort = createChatTurnAbortController(activeSessionId);
        const turnHostContext = {
          maxToolRounds: useSettingsStore.getState().agentSettings?.maxToolRounds,
          executionModeId,
          onBrowserNotConnected: () => {
            void useCdpStore.getState().requestChromeConnection();
          },
          onExecutionModeUpgradeNeeded: (info: { reason: AskModeToolNeedReason; messagePreview: string }) => {
            void useUIStore.getState().showExecutionModeUpgradePrompt(info);
          },
        };
        const engine = isAskMode
          ? runChatTurn(
              activeSessionId,
              currentMessages(),
              finalSystemPrompt,
              sessionWorkDir,
              false,
              undefined,
              { ...turnHostContext, noTools: true, signal: turnAbort.signal },
              sessionPipiOutputDir ?? undefined,
            )
          : isPlanMode
          ? runChatTurn(
              activeSessionId,
              currentMessages(),
              finalSystemPrompt,
              sessionWorkDir,
              false, // allowBrowserTools — always off in plan mode
              undefined,
              {
                ...turnHostContext,
                // Plan mode: read-only inspection only. The chat engine
                // forwards `allowedTools` through `buildResolvedChatRequest`
                // (which normalises `[]` -> `undefined`) and the Rust executor
                // filters the openai body down to that exact allowlist.
                // Plan-doc persistence is an app-side post-turn action,
                // not a model-callable tool, so `save_plan_doc` is
                // intentionally absent here.
                allowedTools: modeAllowedTools,
                signal: turnAbort.signal,
              },
              sessionPipiOutputDir ?? undefined,
            )
          : runChatTurn(
              activeSessionId,
              currentMessages(),
              finalSystemPrompt,
              sessionWorkDir,
              shouldAllowBrowserTools,
              undefined,
              {
                ...turnHostContext,
                ...(modeAllowedTools?.length ? { allowedTools: modeAllowedTools } : {}),
                signal: turnAbort.signal,
              },
              sessionPipiOutputDir ?? undefined,
            );
        const uiStore = useUIStore.getState();
        let tokenUsageResult: TokenUsage | undefined;
        let activeTurnId: string | undefined;

        for await (const chunk of engine) {
          if (chunk.turnId) {
            activeTurnId = chunk.turnId;
          }
          // SessionRuntime may forward tools_cancelled after the turn is no
          // longer active. Do not drop it on the isTurnActive gate — observe
          // it (durable cancel notice still comes from stopGeneration).
          if (chunk.type === 'tools_cancelled') {
            streamState = handleStreamChunk(streamState, chunk);
            continue;
          }
          if (activeTurnId && !getSessionHandle(activeSessionId).isTurnActive(activeTurnId)) {
            throw new ChatGenerationCancelledError(activeSessionId);
          }
          if (consumeChatGenerationCancel(activeSessionId)) {
            throw new ChatGenerationCancelledError(activeSessionId);
          }
          streamState = handleStreamChunk(streamState, chunk);

          if (chunk.type === 'text_delta') {
            get().appendStreamingContent(chunk.content, chunk.turnId, activeSessionId);
          } else if (chunk.type === 'reasoning_delta') {
            if (
              getChatSessionTurnEpoch(activeSessionId) === turnEpoch
              && ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)
            ) {
              set((state) => ({ streamingReasoning: state.streamingReasoning + chunk.content }));
            }
          } else if (chunk.type === 'status_update') {
            uiStore.addNotification('info', chunk.message, activeSessionId);
          } else if (chunk.type === 'tool_batch_request') {
            // Durably attach pending tool_calls BEFORE waiting on tools so a
            // kill -9 / crash mid-tool leaves orphans in SQLite for hydrate
            // interrupted notice (see docs/soak-crash-reload.md).
            const streamSnapshot = get();
            await persistAssistantPendingToolCalls(
              activeSessionId,
              assistantMessage.id,
              chunk.tools,
              set,
              get,
              {
                content: resolveSessionStreamText(
                  activeSessionId,
                  streamSnapshot.streamingContent,
                  streamSnapshot.currentSessionId,
                ) || '',
                reasoning: resolveSessionStreamReasoning(
                  activeSessionId,
                  streamSnapshot.streamingReasoning,
                  streamSnapshot.currentSessionId,
                ) || undefined,
              },
            );
            // After mid-tool persist await: Stop / cancel / newer Send may have
            // advanced epoch or marked cancel while db_save_message was in flight.
            // Must not proceed to execute tools for a cancelled/stale turn.
            if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
              throw new ChatGenerationCancelledError(activeSessionId);
            }
            if (activeTurnId && !getSessionHandle(activeSessionId).isTurnActive(activeTurnId)) {
              throw new ChatGenerationCancelledError(activeSessionId);
            }
            if (consumeChatGenerationCancel(activeSessionId)) {
              throw new ChatGenerationCancelledError(activeSessionId);
            }
            try {
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
            } finally {
              // Batch finished (success / handled failure / cancel settle).
              // Process death never reaches here — orphans stay for hydrate.
              await clearAssistantPendingToolCalls(
                activeSessionId,
                assistantMessage.id,
                set,
                get,
              );
            }
            streamState = clearStreamingRoundBuffers(streamState);
            // After await: only clear shared stream UI if this turn still owns the epoch
            // AND the owning session is selected (background A must not wipe B chrome).
            if (getChatSessionTurnEpoch(activeSessionId) === turnEpoch) {
              clearStreamingBuffer(activeSessionId);
              if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
                set({ streamingReasoning: '', streamingContent: '' });
              }
            }
            if (activeTurnId && !getSessionHandle(activeSessionId).isTurnActive(activeTurnId)) {
              throw new ChatGenerationCancelledError(activeSessionId);
            }
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

        if (activeTurnId && !getSessionHandle(activeSessionId).isTurnActive(activeTurnId)) {
          throw new ChatGenerationCancelledError(activeSessionId);
        }
        if (consumeChatGenerationCancel(activeSessionId)) {
          throw new ChatGenerationCancelledError(activeSessionId);
        }

        const streamed = flushBuffer(streamState);
        const completionOwnsTurn = getChatSessionTurnEpoch(activeSessionId) === turnEpoch;
        // Prefer closed-over streamState when stale so we do not read/clear a newer turn's buffer.
        const completionSnapshot = get();
        const finalContent = completionOwnsTurn
          ? (
            resolveSessionStreamText(
              activeSessionId,
              completionSnapshot.streamingContent,
              completionSnapshot.currentSessionId,
            ) || streamed.content
          )
          : streamed.content;
        if (completionOwnsTurn) {
          clearStreamingBuffer(activeSessionId);
        }
        const parsed = parseThinkContent(finalContent);
        const tokenUsage = tokenUsageResult
          ? {
              input_tokens: tokenUsageResult.input_tokens,
              output_tokens: tokenUsageResult.output_tokens,
              model: tokenUsageResult.model || resolvedConfig!.model,
            }
          : undefined;

        const sanitizedAssistantContent = isAskMode && looksLikeAskModePseudoToolCall(parsed.content)
          ? buildAskModeToolUnavailableReply(content)
          : parsed.content;
        const displayContent = stripGoalMarkers(sanitizedAssistantContent);

        await get().updateLastMessage(
          displayContent,
          undefined,
          mergeReasoningParts(
            getChatSessionTurnEpoch(activeSessionId) === turnEpoch
              ? resolveSessionStreamReasoning(
                activeSessionId,
                get().streamingReasoning,
                get().currentSessionId,
              )
              : '',
            streamed.reasoning,
            parsed.reasoning,
          ),
          tokenUsage,
          activeSessionId,
          assistantMessage.id,
        );
        const successOwnsTurn = getChatSessionTurnEpoch(activeSessionId) === turnEpoch;
        if (successOwnsTurn) {
          if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
            setError(null);
            set({ streamingContent: displayContent });
          }
        }

        if (successOwnsTurn && activeGoal && displayContent.trim()) {
          useSessionGoalStore.getState().recordTrace(activeSessionId, 'assistant_turn', displayContent);
        }

        const tokenDelta = (tokenUsage?.input_tokens ?? 0) + (tokenUsage?.output_tokens ?? 0);
        if (successOwnsTurn && activeGoal && shouldRunGoalLoop({ goalLoopContinuation: options?.goalLoopContinuation, isPlanMode })) {
          const latestGoal = useSessionGoalStore.getState().getGoalForSession(activeSessionId);
          if (latestGoal) {
            useSessionGoalStore.getState().consumeTurnBudget(activeSessionId, tokenDelta);
            const refreshedGoal = useSessionGoalStore.getState().getGoalForSession(activeSessionId)!;
            const loopDecision = decideGoalLoopAfterTurn({
              goal: refreshedGoal,
              assistantContent: sanitizedAssistantContent,
              tokenDelta,
              isGoalLoopContinuation: options?.goalLoopContinuation,
            });

            useSessionGoalStore.getState().recordEvaluation(activeSessionId, loopDecision.evaluation);

            if (loopDecision.action === 'complete') {
              useSessionGoalStore.getState().completeGoal(activeSessionId, loopDecision.evaluation.evidence);
              uiStore.addNotification('success', t('goal.completedToast'), activeSessionId);
            } else if (loopDecision.action === 'budget_limited') {
              useSessionGoalStore.getState().setStatus(activeSessionId, 'budget_limited');
              useSessionGoalStore.getState().recordTrace(activeSessionId, 'system', '目标预算已用尽');
              uiStore.addNotification('warning', t('goal.budgetLimitedToast'), activeSessionId);
            } else if (loopDecision.action === 'blocked') {
              useSessionGoalStore.getState().pauseGoal(activeSessionId);
              uiStore.addNotification('info', t('goal.blockedToast'), activeSessionId);
            } else if (loopDecision.action === 'continue' && loopDecision.continueMessage) {
              queueMicrotask(() => {
                void get().sendMessage(loopDecision.continueMessage!, activeSessionId, {
                  goalLoopContinuation: true,
                });
              });
            }
          }
        }

        if (tokenUsage) {
          const now = new Date();
          await safeInvoke('db_save_token_usage', {
            usage: {
              id: crypto.randomUUID(),
               session_id: activeSessionId,
               date: now.toISOString().split('T')[0],
               input_tokens: tokenUsage.input_tokens,
               output_tokens: tokenUsage.output_tokens,
               model: tokenUsage.model || resolvedConfig!.model,
               api_config_id: resolvedConfig!.configId,
               created_at: Math.floor(now.getTime() / 1000),
             },
          }).catch((error: unknown) => {
            console.error('Failed to save token usage:', error);
          });
        }

        // After awaits (token usage etc.): stale turn must not clear newer turn UI.
        // Background session A completing while B is selected must not flip B chrome.
        if (getChatSessionTurnEpoch(activeSessionId) === turnEpoch) {
          clearStreamingBuffer(activeSessionId);
          clearStreamChromeIfSelected(set, get, activeSessionId);
          if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
            useUIStore.getState().setActiveSkill(null);
          }
        }
        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'completed',
          cancelable: false,
          detail: displayContent.slice(0, 240),
        });
        if (getActiveChatDiagnosticsTaskId(activeSessionId) === diagnosticsTaskId) {
          setActiveChatDiagnosticsTaskId(activeSessionId, null);
        }

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
              // Two-folder model: plan docs are app-owned outputs and
              // land in the PiPi Output Folder, NOT the Project Folder.
              // Resolve the real on-disk path via the Tauri helper so
              // we never write into the JS-side placeholder.
              let planOutputDir = await resolveRealSessionPipiOutputDir(latestSession);

              if (!planOutputDir) {
                const resolved = await ensureSessionWorkDir(activeSessionId, set, get);
                planOutputDir = resolved ?? undefined;
              }

              if (planOutputDir) {
                const savedDoc = await savePlanModeDoc({
                  workDir: planOutputDir,
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
            // Two-folder model: memory lives under the PiPi Output
            // Folder, not the Project Folder. Resolve the real on-disk
            // path so the extraction pipeline writes into the
            // app-owned location — the JS-side placeholder must never
            // reach the filesystem.
            const latestSession = get().sessions.find((session) => session.id === activeSessionId);
            const memoryRoot = await resolveRealSessionPipiOutputDir(latestSession);
            if (memoryRoot) {
              triggerMemoryExtraction({
                messages: messagesForExtraction.map((message) => ({ role: message.role, content: message.content ?? '' })),
                projectRoot: memoryRoot,
              });
            }
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
          // Always mark THIS turn's diagnostics cancelled; never touch a newer
          // turn's UI/runtime when the epoch has moved (Stop→send race).
          updateDiagnosticsTask(diagnosticsTaskId, {
            state: 'cancelled',
            cancelable: false,
          });
          if (getActiveChatDiagnosticsTaskId(activeSessionId) === diagnosticsTaskId) {
            setActiveChatDiagnosticsTaskId(activeSessionId, null);
          }
          if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
            return;
          }
          // Epoch still matches: safe to clear THIS turn's stream buffer + cancel
          // marker. Doing either before the guard lets a stale cancelled turn wipe
          // a newer same-session turn's buffer / Stop marker.
          // Only touch selected-session chrome when this owning session is selected.
          clearStreamingBuffer(activeSessionId);
          clearChatGenerationCancel(activeSessionId);
          clearStreamChromeIfSelected(set, get, activeSessionId, {
            pendingToolCalls: 0,
            pendingToolResults: [],
          });
          if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
            useUIStore.getState().setActiveSkill(null);
          }

          // Bind removal to THIS turn's assistant placeholder id only.
          removeEmptyAssistantPlaceholderById(set, activeSessionId, assistantMessage?.id);
          syncSessionToolRuntimeToCurrentSession(set, get);
          return;
        }

        turnHadError = true;
        const errorMsg = normalizeCaughtErrorMessage(error, CHAT_ERROR_MESSAGES.sendFailed);

        if (await tryRecoverFromToolPolicyError(errorMsg, content, activeSessionId, get, set, turnEpoch)) {
          updateDiagnosticsTask(diagnosticsTaskId, {
            state: 'cancelled',
            cancelable: false,
          });
          if (getActiveChatDiagnosticsTaskId(activeSessionId) === diagnosticsTaskId) {
            setActiveChatDiagnosticsTaskId(activeSessionId, null);
          }
          // Recovery may have started a newer sendMessage (epoch bumped) — only
          // clear shared UI if this turn still owns the epoch and is selected.
          if (getChatSessionTurnEpoch(activeSessionId) === turnEpoch) {
            clearStreamingBuffer(activeSessionId);
            clearStreamChromeIfSelected(set, get, activeSessionId);
            if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
              useUIStore.getState().setActiveSkill(null);
            }
          }
          return;
        }

        // Persist error onto THIS turn's assistant message (id-bound). Prefer
        // closed-over streamState when stale so we do not copy a newer turn's
        // live streamingContent onto the old placeholder.
        const errorOwnsTurn = getChatSessionTurnEpoch(activeSessionId) === turnEpoch;
        const {
          streamingContent: errContent,
          streamingReasoning: errReasoning,
          currentSessionId: errCurrentSessionId,
          updateLastMessage: saveLastMsg,
        } = get();
        const flushed = flushBuffer(streamState);
        const parsed = parseThinkContent(
          (errorOwnsTurn
            ? resolveSessionStreamText(activeSessionId, errContent, errCurrentSessionId)
            : '') || flushed.content || '',
        );
        const finalContent = parsed.content.trim()
          ? `${parsed.content}\n\n⚠️ **Error:** ${errorMsg}`
          : `⚠️ **Error:** ${errorMsg}`;

        if (assistantMessage?.id) {
          void saveLastMsg(
            finalContent,
            undefined,
            mergeReasoningParts(
              errorOwnsTurn
                ? resolveSessionStreamReasoning(activeSessionId, errReasoning, errCurrentSessionId)
                : '',
              flushed.reasoning,
              parsed.reasoning,
            ),
            undefined,
            activeSessionId,
            assistantMessage.id,
          ).catch((saveError: unknown) => {
            console.error('Failed to persist sendMessage error content:', saveError);
          });
        }

        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'failed',
          cancelable: false,
          error: errorMsg,
        });
        if (getActiveChatDiagnosticsTaskId(activeSessionId) === diagnosticsTaskId) {
          setActiveChatDiagnosticsTaskId(activeSessionId, null);
        }

        // Stale non-cancel / real-error path must not mutate a newer turn:
        // setError, setStreaming(false), clear streaming, setActiveSkill(null),
        // or delete a newer turn's placeholder via last-message heuristics.
        if (errorOwnsTurn && getChatSessionTurnEpoch(activeSessionId) === turnEpoch) {
          clearStreamingBuffer(activeSessionId);
          clearStreamChromeIfSelected(set, get, activeSessionId);
          if (ownsSelectedStreamChrome(activeSessionId, get().currentSessionId)) {
            setError(errorMsg);
            useUIStore.getState().setActiveSkill(null);
          }
          removeEmptyAssistantPlaceholderById(set, activeSessionId, assistantMessage?.id);
        }
      } finally {
        // Stale turn must not clear a newer same-session Stop/cancel marker.
        if (getChatSessionTurnEpoch(activeSessionId) === turnEpoch) {
          clearChatGenerationCancel(activeSessionId);
        }
      }
  };
}
