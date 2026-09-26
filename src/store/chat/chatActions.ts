import { invoke } from '@tauri-apps/api/core';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { safeInvoke, safeInvokeOrNull } from '../../utils/safeInvoke';
import { mergeReasoningParts, messageToDb, parseThinkContent } from '../../utils/chatHelpers';
import type { ChatState, Message } from '../../types/chat';
import { createMessage } from '../../types/chat';
import {
  createChatStopGenerationAction,
  createChatStreamingUpdateActions,
} from './chatStreamActions';
import { createSendMessageActionMethod } from './sendMessageAction';
import { useUIStore } from '@/store';
import {
  appendBrowserResultToSystemPrompt,
  createBrowserResultMessages,
  mapBrowserResponseArtifacts,
} from './chatBrowserHandoff';
import { CHAT_ERROR_MESSAGES, normalizeCaughtErrorMessage } from './chatErrors';
import { shouldPersistMessage } from './chatPersistence';
import {
  resolveSessionExecutionModeId,
  detectAskModeToolNeed,
  shouldOfferExecutionModeUpgrade,
} from '@/services/executionMode';
import { startNewChatFlow } from '@/services/newChatFlow';
import { scrubDanglingToolCalls } from './scrubDanglingToolCalls';
import {
  clearStreamingBuffer,
  getChatSessionTurnEpoch,
  getStreamingBuffer,
  ownsSelectedStreamChrome,
  STREAMING_TIMEOUT_MS,
} from './chatStreaming';
import { getSessionProjectDir as resolveSessionProjectDir } from '@/utils/sessionFolders';
import { t } from '@/i18n';

export function shouldRemoveEmptyAssistantPlaceholder(message: Message | undefined): boolean {
  return Boolean(message && message.role === 'assistant' && !message.content && !message.reasoning);
}

export function withUpdatedTimestamp<T extends { updatedAt: number }>(value: T, now = Date.now()): T {
  return { ...value, updatedAt: now };
}

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

/**
 * Remove an empty assistant placeholder by closed-over message id only.
 * Never delete by "last message" — a stale turn must not remove a newer turn's placeholder.
 */
export function removeEmptyAssistantPlaceholderById(
  set: ChatSetState,
  sessionId: string,
  messageId: string | null | undefined,
): void {
  if (!messageId) {
    return;
  }
  set((state) => ({
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }
      const index = session.messages.findIndex((message) => message.id === messageId);
      if (index < 0) {
        return session;
      }
      const target = session.messages[index];
      if (!shouldRemoveEmptyAssistantPlaceholder(target)) {
        return session;
      }
      return {
        ...session,
        messages: [
          ...session.messages.slice(0, index),
          ...session.messages.slice(index + 1),
        ],
      };
    }),
  }));
}

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

// AUDIT-FIX [audit-1#2] — `activeChatDiagnosticsTaskId` was a single module-
// level slot that the most recent sendMessage would overwrite. When two
// sessions were streaming concurrently (or one was about to be cancelled
// while another was starting), stopGeneration() would update the wrong task
// in the diagnostics panel. Track task id per session so we always cancel
// the task that belongs to the session being stopped.
const activeChatDiagnosticsTaskIds = new Map<string, string>();

function setActiveChatDiagnosticsTaskId(sessionId: string | null, taskId: string | null): void {
  if (!sessionId) return;
  if (taskId === null) {
    activeChatDiagnosticsTaskIds.delete(sessionId);
  } else {
    activeChatDiagnosticsTaskIds.set(sessionId, taskId);
  }
}

function getActiveChatDiagnosticsTaskId(sessionId: string | null): string | null {
  if (!sessionId) return null;
  return activeChatDiagnosticsTaskIds.get(sessionId) ?? null;
}

function getAnyActiveChatDiagnosticsTaskId(): string | null {
  // Fallback: if the caller doesn't know the session, return whichever task
  // was most recently set. Used by stopGeneration only when owningSessionId
  // cannot be resolved (never when a same-session newer turn may exist).
  const it = activeChatDiagnosticsTaskIds.values();
  let last: string | null = null;
  for (const id of it) last = id;
  return last;
}

/** @internal test helper — clear per-session diagnostics task bindings. */
export function resetActiveChatDiagnosticsTaskIdsForTests(): void {
  activeChatDiagnosticsTaskIds.clear();
}

class ChatGenerationCancelledError extends Error {
  sessionId: string;

  constructor(sessionId: string) {
    super(`Chat generation cancelled for session ${sessionId}`);
    this.name = 'ChatGenerationCancelledError';
    this.sessionId = sessionId;
  }
}

function isChatGenerationCancelledError(error: unknown): boolean {
  if (error instanceof ChatGenerationCancelledError) {
    return true;
  }
  // Only treat true AbortError primitives as cancel — do not match unrelated
  // failures whose messages happen to mention "abort" / "cancelled".
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

const ASK_MODE_PSEUDO_TOOL_CALL_PATTERNS = [
  /<]minimax\[>/i,
  /<tool_call>/i,
  /<\/tool_call>/i,
  /<tool_calls?>/i,
  /<\/tool_calls?>/i,
  /<invoke>/i,
  /<\/invoke>/i,
  /<parameter>/i,
  /<\/parameter>/i,
  /<list_files\b/i,
  /<read_file\b/i,
  /<search_files\b/i,
  /<execute_command\b/i,
  /<write_file\b/i,
  /<browser_[a-z_]+\b/i,
  /<ssh_[a-z_]+\b/i,
  /\b(?:list_files|read_file|search_files|write_file|execute_command|browser_[a-z_]+|ssh_[a-z_]+|mcp_call)\b/i,
];

function looksLikeAskModePseudoToolCall(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return ASK_MODE_PSEUDO_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function buildAskModeToolUnavailableReply(userRequest: string): string {
  const { reason } = detectAskModeToolNeed(userRequest);
  if (reason === 'browser') {
    return '当前问答模式不能调用工具。请切到规划或危险模式后重试，我就可以使用已连接的 Chrome。';
  }
  if (reason === 'workspace') {
    return '问答模式这回合不能读取本地文件或调用工具。请切到规划（只读检查）或危险（可执行）后重试；如果你愿意，也可以把文件内容贴到这里。';
  }
  return '问答模式这回合不能调用工具。如果需要读取文件、执行命令或改动代码，请切到规划或危险模式。';
}

async function ensureChatSessionForSend(
  get: () => ChatState,
  preferredSessionId?: string | null,
): Promise<string | null> {
  const state = get();
  if (preferredSessionId && state.sessions.some((session) => session.id === preferredSessionId)) {
    return preferredSessionId;
  }
  if (state.currentSessionId) {
    return state.currentSessionId;
  }
  return startNewChatFlow('chat-input');
}

function pinChatSession(sessionId: string, get: () => ChatState): void {
  if (get().currentSessionId !== sessionId) {
    get().selectSession(sessionId);
  }
}

async function rollbackToLastUserMessage(
  activeSessionId: string,
  get: () => ChatState,
  set: ChatSetState,
): Promise<{ content: string; attachments?: import('@/types/vision').ImageAttachment[] } | null> {
  const session = get().sessions.find((candidate) => candidate.id === activeSessionId);
  if (!session) {
    return null;
  }

  const messages = session.messages;
  const lastUserIndex = [...messages].reverse().findIndex((message) => message.role === 'user');
  if (lastUserIndex === -1) {
    return null;
  }

  const actualIndex = messages.length - 1 - lastUserIndex;
  const lastUserMessage = messages[actualIndex];
  const messagesToDelete = messages.slice(actualIndex);

  set((state) => ({
    error: null,
    pendingToolCalls: 0,
    pendingToolResults: [],
    sessions: state.sessions.map((candidate) => (
      candidate.id === activeSessionId
        ? { ...candidate, messages: candidate.messages.slice(0, actualIndex) }
        : candidate
    )),
  }));

  await Promise.allSettled(messagesToDelete.map((message) => safeInvokeOrNull('db_delete_message', { messageId: message.id })));
  return {
    content: lastUserMessage.content,
    attachments: lastUserMessage.attachments,
  };
}

async function tryRecoverFromToolPolicyError(
  errorMsg: string,
  userContent: string,
  activeSessionId: string,
  get: () => ChatState,
  set: ChatSetState,
  turnEpoch: number,
): Promise<boolean> {
  const session = get().sessions.find((candidate) => candidate.id === activeSessionId);
  const executionModeId = resolveSessionExecutionModeId(session);
  if (!shouldOfferExecutionModeUpgrade(errorMsg, executionModeId, userContent)) {
    return false;
  }

  // Stale recovering turn must not show an upgrade dialog for a newer turn.
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    return false;
  }

  const toolNeed = detectAskModeToolNeed(userContent);
  const choice = await useUIStore.getState().showExecutionModeUpgradePrompt({
    reason: toolNeed.reason,
    messagePreview: userContent.trim().slice(0, 240),
  });
  // Prompt await: a newer same-session turn may have started — do not mutate it.
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    return false;
  }
  if (choice === 'cancel') {
    return false;
  }

  await get().updateSessionExecutionMode(activeSessionId, choice);
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    return false;
  }
  useUIStore.getState().addNotification(
    'info',
    choice === 'bypass'
      ? t('executionMode.upgrade.switchedToDanger')
      : t('executionMode.upgrade.switchedToPlan'),
    activeSessionId,
  );
  pinChatSession(activeSessionId, get);

  clearStreamingBuffer(activeSessionId);
  clearStreamChromeIfSelected(set, get, activeSessionId, {
    pendingToolCalls: 0,
    pendingToolResults: [],
  });

  // Gate rollback+auto-retry behind epoch match for the recovering turn.
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    return false;
  }

  const lastUser = await rollbackToLastUserMessage(activeSessionId, get, set);
  if (!lastUser) {
    return false;
  }

  // Rollback awaited DB deletes — do not start an extra retry if epoch moved.
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    return false;
  }

  await get().sendMessage(lastUser.content, activeSessionId, {
    attachments: lastUser.attachments,
  });
  return true;
}

/** Test-only: inspect per-session module stream buffer (Stop→send / multi-session proofs). */
export function getCurrentStreamingBufferForTests(sessionId: string): string {
  return getStreamingBuffer(sessionId);
}

/**
 * Clear selected-session stream chrome only when `owningSessionId` is currently
 * selected. Background completion/cancel must not flip another session's
 * isStreaming / stream buffers / busy chrome / streamingTimeoutId.
 *
 * Owner-gated timeout cleanup: `streamingTimeoutId` is selected-session chrome.
 * Only clear/reset it when this owning session is the selected session. A
 * background completion may drop a stale `streamingSessionId` pointer that still
 * names the completing session, but must never clearTimeout/null B's timeout.
 */
function clearStreamChromeIfSelected(
  set: ChatActionFactoryDeps['set'],
  get: ChatActionFactoryDeps['get'],
  owningSessionId: string,
  extra: Record<string, unknown> = {},
): void {
  const { currentSessionId, streamingSessionId, streamingTimeoutId } = get();
  const ownsSelected = ownsSelectedStreamChrome(owningSessionId, currentSessionId);

  if (!ownsSelected) {
    // Drop stale ownership pointer only. Never touch streamingTimeoutId — after
    // switch, B may already own the selected-session timeout timer.
    if (streamingSessionId === owningSessionId) {
      set({ streamingSessionId: null });
    }
    return;
  }
  if (streamingTimeoutId) {
    clearTimeout(streamingTimeoutId);
  }
  set({
    isStreaming: false,
    streamingTimeoutId: null,
    streamingContent: '',
    streamingReasoning: '',
    streamingSessionId: null,
    ...extra,
  });
}

export function createChatActionMethods({
  set,
  get,
  ensureSessionWorkDir,
  runMicrocompactAfterStreaming,
  runSMCompactAfterStreaming,
}: ChatActionFactoryDeps): Pick<ChatState, ChatActionMethodKeys> {
  let sendMessageAction: ChatState['sendMessage'] | null = null;
  const getSendMessageAction = (): ChatState['sendMessage'] => {
    if (!sendMessageAction) {
      sendMessageAction = createSendMessageActionMethod({
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
      });
    }
    return sendMessageAction;
  };

  let stopGenerationAction: ChatState['stopGeneration'] | null = null;
  const getStopGenerationAction = (): ChatState['stopGeneration'] => {
    if (!stopGenerationAction) {
      stopGenerationAction = createChatStopGenerationAction({
        set,
        get,
        getActiveChatDiagnosticsTaskId,
        setActiveChatDiagnosticsTaskId,
        getAnyActiveChatDiagnosticsTaskId,
        removeEmptyAssistantPlaceholderById,
      }).stopGeneration;
    }
    return stopGenerationAction;
  };

  let streamingUpdateActions: ReturnType<typeof createChatStreamingUpdateActions> | null = null;
  const getStreamingUpdateActions = (): ReturnType<typeof createChatStreamingUpdateActions> => {
    if (!streamingUpdateActions) {
      streamingUpdateActions = createChatStreamingUpdateActions({
        set,
        get,
        clearStreamChromeIfSelected,
      });
    }
    return streamingUpdateActions;
  };

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

      const resolvedConfig = resolveActiveAgentConfig();
      const configIssues = validateResolvedAgentConfig(resolvedConfig);
      if (configIssues.length > 0) {
        setError(formatAgentConfigValidationError(resolvedConfig, configIssues));
        return;
      }

      // AUDIT-FIX [audit-1#1] — Local timeout kept on purpose. Unlike sendMessage
      // (which goes through the store's setStreaming(true) timer), this path
      // bypasses the engine and calls `send_claude_sdk_chat_streaming` directly,
      // so it does NOT trigger the store-level streamingTimeoutId. The local
      // timer mirrors that store-level behavior for parity (same
      // STREAMING_TIMEOUT_MS, same cancel + cleanup on success / error).
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        clearStreamingBuffer(currentSessionId);
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
        await addMessage(assistantMessage);

        const baseSystemPrompt = useUIStore.getState().agentInstructions;
        const currentSession = get().sessions.find((session) => session.id === currentSessionId);
        // Two-folder model: Project Folder via helper (projectDir ?? workDir).
        // Do not read `workDir` alone — that skips an explicit `projectDir`.
        const sessionWorkDir = resolveSessionProjectDir(currentSession);
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
          usage: { input_tokens: number; output_tokens: number };
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
              model: response.model || resolvedConfig!.model,
            }
          : undefined;

        await updateLastMessage(
          cleanContent,
          mapBrowserResponseArtifacts(response.artifacts, () => crypto.randomUUID()),
          mergeReasoningParts(streamingReasoning, parsedReasoning),
          tokenUsage,
          currentSessionId,
          assistantMessage.id,
        );

        clearStreamingBuffer(currentSessionId);
        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
      } catch (error) {
        clearStreamingBuffer(currentSessionId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const errorMsg = normalizeCaughtErrorMessage(error, CHAT_ERROR_MESSAGES.browserResponseFailed);
        setError(errorMsg);

        const { streamingContent: errContent, streamingReasoning: errReasoning, updateLastMessage: saveLastMsg } = get();
        if (errContent || errReasoning) {
          const { content: cleanErr, reasoning: parsedErrReasoning } = parseThinkContent(errContent || '');
          void saveLastMsg(cleanErr, undefined, mergeReasoningParts(errReasoning, parsedErrReasoning)).catch((saveError: unknown) => {
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

    sendMessage: (content, targetSessionId, options) =>
      getSendMessageAction()(content, targetSessionId, options),

    stopGeneration: () => getStopGenerationAction()(),

    retryLastMessage: async () => {
      const { currentSessionId, sessions, error } = get();
      if (!currentSessionId || !error) {
        return;
      }

      const session = sessions.find((candidate) => candidate.id === currentSessionId);
      if (!session) {
        return;
      }

      const lastUser = await rollbackToLastUserMessage(currentSessionId, get, set);
      if (!lastUser) {
        set({ error: null });
        return;
      }

      await get().sendMessage(lastUser.content, currentSessionId, {
        attachments: lastUser.attachments,
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

    addMessageToSession: async (
      sessionId: string,
      message: Message,
      options?: { expectedTurnEpoch?: number },
    ) => {
      const expectedEpoch = options?.expectedTurnEpoch;
      const epochMatches = () => (
        typeof expectedEpoch !== 'number'
        || getChatSessionTurnEpoch(sessionId) === expectedEpoch
      );

      // Discard before DB if the turn already moved on (e.g. Stop→Send race).
      if (!epochMatches()) {
        return;
      }

      if (shouldPersistMessage(message)) {
        try {
          await safeInvoke('db_save_message', { message: messageToDb(message, sessionId) });
        } catch (error) {
          console.warn('[addMessageToSession] DB persist failed:', error);
        }
      }

      // After DB await: re-check epoch before local list mutation. If a newer
      // same-session turn started mid-persist, drop the stale notice locally
      // and best-effort delete the just-written DB row.
      if (!epochMatches()) {
        try {
          await safeInvoke('db_delete_message', { messageId: message.id }, { silent: true });
        } catch (error) {
          console.warn('[addMessageToSession] stale message DB delete failed:', error);
        }
        return;
      }

      set((state) => ({
        sessions: state.sessions.map((session) => (
          session.id === sessionId
            ? { ...session, messages: [...session.messages, message], updatedAt: Date.now() }
            : session
        )),
      }));
    },

    updateLastMessage: (...args: Parameters<ChatState['updateLastMessage']>) =>
      getStreamingUpdateActions().updateLastMessage(...args),
    updateMessageContent: (...args: Parameters<ChatState['updateMessageContent']>) =>
      getStreamingUpdateActions().updateMessageContent(...args),
    appendStreamingContent: (...args: Parameters<ChatState['appendStreamingContent']>) =>
      getStreamingUpdateActions().appendStreamingContent(...args),
    setStreaming: (...args: Parameters<ChatState['setStreaming']>) =>
      getStreamingUpdateActions().setStreaming(...args),
    setError: (...args: Parameters<ChatState['setError']>) =>
      getStreamingUpdateActions().setError(...args),
    clearError: (...args: Parameters<ChatState['clearError']>) =>
      getStreamingUpdateActions().clearError(...args),
  };
}
