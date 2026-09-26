import type { ChatState, Message } from '../../types/chat';
import { createMessage } from '../../types/chat';
import { safeInvoke, safeInvokeOrNull } from '../../utils/safeInvoke';
import { getSessionHandle } from '../../core/runtime';
import { formatError } from '../../utils/errorFormat';
import { mergeReasoningParts, messageToDb } from '../../utils/chatHelpers';
import { updateDiagnosticsTask } from '../taskRegistryStore';
import { useUIStore } from '../uiStore';
import {
  failUnresolvedSessionTools,
  listCancellableSessionExecutionIds,
  listUnresolvedSessionTools,
  markSessionToolsCancelling,
} from './toolRuntimeState';
import {
  buildToolCancelNoticeContent,
  scrubDanglingToolCalls,
} from './scrubDanglingToolCalls';
import {
  abortChatTurn,
  appendStreamingBuffer,
  clearStreamingBuffer,
  flushBuffer,
  getChatSessionTurnEpoch,
  requestChatGenerationCancel,
  ownsSelectedStreamChrome,
  resolveSessionStreamReasoning,
  resolveSessionStreamText,
  resolveStreamingOwnerSessionId,
  shouldFlushStreamingUpdate,
  STREAMING_TIMEOUT_MS,
} from './chatStreaming';
import { stripProviderStreamArtifacts } from '../../utils/streamSanitizer';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;
type ChatGetState = () => ChatState;

interface ChatStreamActionBaseDependencies {
  set: ChatSetState;
  get: ChatGetState;
}

type ChatStopGenerationDependencies = ChatStreamActionBaseDependencies & {
  getActiveChatDiagnosticsTaskId: (sessionId: string | null) => string | null;
  setActiveChatDiagnosticsTaskId: (sessionId: string | null, taskId: string | null) => void;
  getAnyActiveChatDiagnosticsTaskId: () => string | null;
  removeEmptyAssistantPlaceholderById: (
    set: ChatSetState,
    sessionId: string,
    messageId: string | null | undefined,
  ) => void;
};

type ChatStreamingUpdateDependencies = ChatStreamActionBaseDependencies & {
  clearStreamChromeIfSelected: (
    set: ChatSetState,
    get: ChatGetState,
    owningSessionId: string,
    extra?: Record<string, unknown>,
  ) => void;
};

type ChatStopGenerationActions = Pick<ChatState, 'stopGeneration'>;
type ChatStreamingUpdateActions = Pick<
  ChatState,
  | 'updateLastMessage'
  | 'updateMessageContent'
  | 'appendStreamingContent'
  | 'setStreaming'
  | 'setError'
  | 'clearError'
>;

export const createChatStopGenerationAction: (
  dependencies: ChatStopGenerationDependencies,
) => ChatStopGenerationActions = ({
  set,
  get,
  getActiveChatDiagnosticsTaskId,
  setActiveChatDiagnosticsTaskId,
  getAnyActiveChatDiagnosticsTaskId,
  removeEmptyAssistantPlaceholderById,
}) => ({
    stopGeneration: async () => {
      const {
        isStreaming,
        streamingContent,
        streamingReasoning,
        currentSessionId,
        streamingSessionId,
        setError,
        pendingToolCalls,
        pendingToolResults,
        streamingTimeoutId,
      } = get();
      if (!isStreaming && pendingToolCalls === 0 && pendingToolResults.length === 0) {
        return;
      }

      // AUDIT-FIX [audit-1#4] — Stop the session that OWNS the running
      // subprocess, not necessarily the session that's currently selected.
      // If the user switched sessions while a stream was active, the backend
      // subprocess is still tied to streamingSessionId, and currentSessionId
      // would point at a different (or null) session — stopping that one
      // would be a no-op and the orphan subprocess would keep consuming
      // tokens until its own timeout fires.
      const owningSessionId = resolveStreamingOwnerSessionId(streamingSessionId, currentSessionId);

      abortChatTurn(owningSessionId);
      requestChatGenerationCancel(owningSessionId);

      // Snapshot unresolved tools + executionIds BEFORE failUnresolved clears them.
      const unresolvedTools = owningSessionId
        ? listUnresolvedSessionTools(owningSessionId)
        : [];
      const executionIds = owningSessionId
        ? listCancellableSessionExecutionIds(owningSessionId)
        : [];
      // Epoch + diagnostics + assistant id captured before optimistic clear /
      // await so a same-session sendMessage that starts mid-cancel is
      // detectable, we never cancel a newer diagnostics task, and placeholder /
      // message ops stay bound to the stopped turn only.
      const stopEpoch = getChatSessionTurnEpoch(owningSessionId);
      const diagnosticsTaskIdAtStop = getActiveChatDiagnosticsTaskId(owningSessionId);
      const owningMessagesAtStop = owningSessionId
        ? get().sessions.find((session) => session.id === owningSessionId)?.messages
        : undefined;
      let stoppedAssistantMessageId: string | null = null;
      if (owningMessagesAtStop) {
        for (let i = owningMessagesAtStop.length - 1; i >= 0; i -= 1) {
          const message = owningMessagesAtStop[i];
          if (message.role === 'assistant') {
            stoppedAssistantMessageId = message.id;
            break;
          }
        }
      }

      // Soak knife 3 — optimistic UI: cancelled feel ≤1s. Clear Stop/busy
      // before awaiting native cancel_tool_execution (can be slow). Capture
      // stream text first; only the owning session is cancelled (A≠B).
      // Empty per-session buffer must not inherit selected chrome from another session.
      const finalContent = resolveSessionStreamText(
        owningSessionId,
        streamingContent,
        currentSessionId,
      );
      const finalReasoning = resolveSessionStreamReasoning(
        owningSessionId,
        streamingReasoning,
        currentSessionId,
      );
      clearStreamingBuffer(owningSessionId);
      if (streamingTimeoutId) {
        clearTimeout(streamingTimeoutId);
      }
      set({
        isStreaming: false,
        streamingTimeoutId: null,
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingContent: '',
        streamingReasoning: '',
        streamingSessionId: null,
      });

      if (owningSessionId) {
        // Intermediate TaskStep status while native cancel settles (knife leftover).
        markSessionToolsCancelling(owningSessionId, set, get);
        const stopHandle = getSessionHandle(owningSessionId);
        // Re-validate epoch after EVERY await before further mutations.
        const stillOwnsStoppedTurn = () => getChatSessionTurnEpoch(owningSessionId) === stopEpoch;
        for (const tool of unresolvedTools) {
          stopHandle.emitTraceEvent('tool_cancel_requested', {
            toolCallId: tool.toolCallId,
            ...(tool.executionId ? { executionId: tool.executionId } : {}),
            reason: 'Cancelled by user',
          });
        }
        for (const executionId of executionIds) {
          if (!unresolvedTools.some((t) => t.executionId === executionId)) {
            stopHandle.emitTraceEvent('tool_cancel_requested', {
              executionId,
              reason: 'Cancelled by user',
            });
          }
        }

        // Eager scrub BEFORE slow native cancel so an immediate same-session
        // Send cannot build API history with dangling tool_calls from this turn.
        // In-memory rewrite runs synchronously inside scrub; DB awaits follow.
        if (stillOwnsStoppedTurn()) {
          await scrubDanglingToolCalls(owningSessionId, set, get);
        }

        await Promise.all(
          executionIds.map(async (executionId) => {
            try {
              const result = await safeInvoke<{
                cancelled?: boolean;
                status?: string;
                message?: string;
              }>('cancel_tool_execution', { executionId }, { silent: true });
              // already_finished / not_found must not fail Stop.
              if (
                result
                && result.cancelled !== true
                && result.status
                && result.status !== 'already_finished'
                && result.status !== 'not_found'
              ) {
                console.debug(
                  '[stopGeneration] cancel_tool_execution non-terminal status:',
                  result.status,
                  result.message,
                );
              }
            } catch {
              // Best-effort native cancel; Stop must still complete.
            }
          }),
        );

        // If a new same-session turn started after optimistic busy clear /
        // scrub, skip session-mutating cancel completion (handle.cancel,
        // failUnresolved, notice, stop_subprocess, pending wipe).
        if (stillOwnsStoppedTurn()) {
          useUIStore.getState().clearPermissionsForSession(owningSessionId);
          getSessionHandle(owningSessionId).cancel('Cancelled by user');
          failUnresolvedSessionTools(
            owningSessionId,
            set,
            get,
            (_toolCallId, label) => `Error: ${label} cancelled by user`,
            'cancelled',
          );
          // Re-assert idle immediately after terminalize — before notice /
          // stop_subprocess awaits — so pendingToolResults cannot rebound
          // shouldShowStopControl true mid-completion.
          set({ pendingToolCalls: 0, pendingToolResults: [] });
          // Bind removal to the stopped turn's assistant id only (never last-message).
          removeEmptyAssistantPlaceholderById(set, owningSessionId, stoppedAssistantMessageId);
          if (unresolvedTools.length > 0) {
            const toolNames = unresolvedTools.map((tool) => tool.label);
            const toolCallIds = unresolvedTools.map((tool) => tool.toolCallId);
            await get().addMessageToSession(
              owningSessionId,
              createMessage(
                'assistant',
                buildToolCancelNoticeContent(toolNames, 'user_cancel', toolCallIds),
              ),
              { expectedTurnEpoch: stopEpoch },
            );
          }

          if (stillOwnsStoppedTurn()) {
            try {
              await safeInvoke('stop_subprocess', { sessionId: owningSessionId }, { silent: true });
            } catch (error) {
              console.error('Failed to stop subprocess:', error);
              if (stillOwnsStoppedTurn()) {
                setError(`Failed to stop generation: ${formatError(error)}`);
              }
            }
          }

          if (stillOwnsStoppedTurn()) {
            const flushed = flushBuffer({
              content: finalContent,
              reasoning: finalReasoning,
              statusMessages: [],
            });

            if ((flushed.content || flushed.reasoning) && stoppedAssistantMessageId) {
              await get().updateLastMessage(
                flushed.content,
                undefined,
                flushed.reasoning,
                undefined,
                owningSessionId,
                stoppedAssistantMessageId,
              );
            }
          }

          // Re-assert idle busy flags only while this Stop still owns the turn.
          if (stillOwnsStoppedTurn()) {
            set({ pendingToolCalls: 0, pendingToolResults: [] });
          }
        }
      } else {
        try {
          await safeInvoke('stop_subprocess', { sessionId: owningSessionId }, { silent: true });
        } catch (error) {
          console.error('Failed to stop subprocess:', error);
          setError(`Failed to stop generation: ${formatError(error)}`);
        }

        const flushed = flushBuffer({
          content: finalContent,
          reasoning: finalReasoning,
          statusMessages: [],
        });

        if (flushed.content || flushed.reasoning) {
          await get().updateLastMessage(flushed.content, undefined, flushed.reasoning, undefined, owningSessionId ?? undefined);
        }

        set({ pendingToolCalls: 0, pendingToolResults: [] });
      }

      // AUDIT-FIX [audit-1#2] — Cancel only the snapshotted diagnostics task
      // from Stop start. Never fall back to "any active" when we know the
      // owning session — that can mis-mark a newer same-session turn's task.
      if (diagnosticsTaskIdAtStop) {
        updateDiagnosticsTask(diagnosticsTaskIdAtStop, {
          state: 'cancelled',
          cancelable: false,
        });
        if (getActiveChatDiagnosticsTaskId(owningSessionId) === diagnosticsTaskIdAtStop) {
          setActiveChatDiagnosticsTaskId(owningSessionId, null);
        }
      } else if (!owningSessionId) {
        const fallbackTaskId = getAnyActiveChatDiagnosticsTaskId();
        if (fallbackTaskId) {
          updateDiagnosticsTask(fallbackTaskId, {
            state: 'cancelled',
            cancelable: false,
          });
        }
      }
    },
});

export const createChatStreamingUpdateActions: (
  dependencies: ChatStreamingUpdateDependencies,
) => ChatStreamingUpdateActions = ({
  set,
  get,
  clearStreamChromeIfSelected,
}) => ({
    updateLastMessage: async (
      content: string,
      artifacts?: Message['artifacts'],
      reasoning?: string,
      tokenUsage?: Message['token_usage'],
      targetSessionIdOverride?: string,
      targetMessageId?: string,
    ) => {
      const { streamingSessionId, currentSessionId } = get();
      const targetSessionId = targetSessionIdOverride || resolveStreamingOwnerSessionId(streamingSessionId, currentSessionId);
      if (!targetSessionId) {
        return;
      }

      let messageToUpdate: Message | null = null;

      set((state) => ({
        sessions: state.sessions.map((session) => {
          if (session.id !== targetSessionId || session.messages.length === 0) {
            return session;
          }

          let lastMessageIndex = -1;
          if (targetMessageId) {
            lastMessageIndex = session.messages.findIndex((message) => message.id === targetMessageId);
          }
          if (lastMessageIndex === -1) {
            lastMessageIndex = session.messages.length - 1;
          }

          const lastMessage = session.messages[lastMessageIndex];
          if (!lastMessage || lastMessage.role !== 'assistant') {
            return session;
          }

          const updatedMessage = {
            ...lastMessage,
            content,
            reasoning: mergeReasoningParts(reasoning, lastMessage.reasoning),
            artifacts: artifacts !== undefined ? artifacts : lastMessage.artifacts,
            token_usage: tokenUsage !== undefined ? tokenUsage : lastMessage.token_usage,
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
          await safeInvoke('db_save_message', { message: messageToDb(messageToUpdate, targetSessionId) });
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

    appendStreamingContent: (content: string, turnId?: string, sessionId?: string) => {
      if (sessionId && turnId && !getSessionHandle(sessionId).isTurnActive(turnId)) {
        return;
      }
      const { streamingContent, streamingSessionId, currentSessionId, lastUiUpdateTime } = get();
      const targetSessionId = sessionId || resolveStreamingOwnerSessionId(streamingSessionId, currentSessionId);
      if (!targetSessionId) {
        return;
      }
      const stripped = stripProviderStreamArtifacts(content);
      // Prefer selected chrome seed only when appending for the selected session;
      // background A must not seed from B's streamingContent.
      const chromeSeed = ownsSelectedStreamChrome(targetSessionId, currentSessionId)
        ? streamingContent
        : '';
      const newContent = appendStreamingBuffer(targetSessionId, stripped, chromeSeed);
      const now = Date.now();

      if (shouldFlushStreamingUpdate(now, lastUiUpdateTime)) {
        const updateSelectedStreamChrome = ownsSelectedStreamChrome(targetSessionId, currentSessionId);
        const flushed = flushBuffer({
          content: newContent,
          // Background A must not merge B's streamingReasoning into A's message.
          reasoning: updateSelectedStreamChrome ? get().streamingReasoning : '',
          statusMessages: [],
        });
        // Background session streams must update their own messages, but must
        // not paint into the selected session's stream chrome after a switch.
        set((state) => ({
          ...(updateSelectedStreamChrome
            ? { streamingContent: newContent, lastUiUpdateTime: now }
            : { lastUiUpdateTime: now }),
          sessions: state.sessions.map((session) => {
            if (session.id !== targetSessionId || session.messages.length === 0) {
              return session;
            }
            const messages = [...session.messages];
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role !== 'assistant') {
              return session;
            }
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
      const { streamingTimeoutId, streamingSessionId, currentSessionId, streamingContent } = get();
      // Flush target is the stream owner only — never fall back to currentSessionId.
      // After selectSession, streamingSessionId is null while a background turn may
      // still complete; falling back would paint/flush into the selected session.
      const flushTargetId = streamingSessionId;
      const clearSelectedChrome = ownsSelectedStreamChrome(streamingSessionId, currentSessionId)
        || streamingSessionId == null;
      if (!streaming) {
        // Flush/clear only the stream owner's per-session buffer — never a shared global.
        const finalContent = resolveSessionStreamText(
          flushTargetId,
          streamingContent,
          currentSessionId,
        );
        if (flushTargetId) {
          clearStreamingBuffer(flushTargetId);
        }
        // Owner-gate timeout cleanup: background setStreaming(false) must not
        // clearTimeout / null another session's streamingTimeoutId.
        if (clearSelectedChrome && streamingTimeoutId) {
          clearTimeout(streamingTimeoutId);
        }
        if (flushTargetId && finalContent) {
          const flushed = flushBuffer({
            content: finalContent,
            reasoning: resolveSessionStreamReasoning(
              flushTargetId,
              get().streamingReasoning,
              currentSessionId,
            ),
            statusMessages: [],
          });
          set((state) => ({
            ...(clearSelectedChrome
              ? { isStreaming: false, streamingTimeoutId: null, streamingContent: '' }
              : {}),
            sessions: state.sessions.map((session) => {
              if (session.id !== flushTargetId || session.messages.length === 0) {
                return session;
              }
              const messages = [...session.messages];
              const lastMessage = messages[messages.length - 1];
              if (lastMessage?.role !== 'assistant') {
                return session;
              }
              messages[messages.length - 1] = {
                ...lastMessage,
                content: flushed.content,
                reasoning: mergeReasoningParts(flushed.reasoning, lastMessage.reasoning),
              };
              return { ...session, messages, updatedAt: Date.now() };
            }),
          }));
        } else if (clearSelectedChrome) {
          set({ isStreaming: false, streamingTimeoutId: null, streamingContent: '' });
        }
        return;
      }

      if (streaming) {
        // Do not clear any session buffer here: callers clear their own session
        // before arming the timer. A global clear would wipe background A when B starts.
        const timeoutId = setTimeout(() => {
          const { setStreaming, streamingSessionId: ownerId } = get();
          if (ownerId) {
            safeInvokeOrNull('stop_subprocess', { sessionId: ownerId });
            clearStreamChromeIfSelected(set, get, ownerId);
          } else {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
          }
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
});
