import { invoke } from '@tauri-apps/api/core';
import { safeInvoke } from '../../utils/safeInvoke';
import { buildApiMessages } from '../../utils/chatHelpers';
import type { ChatSendOptions, ChatState, Message } from '../../types/chat';
import { createMessage } from '../../types/chat';
import { usePromptStore } from '../promptStore';
import { updateDiagnosticsTask } from '../taskRegistryStore';
import { useSettingsStore, useUIStore } from '@/store';
import { PLAN_MODE_ALLOWED_TOOLS, PLAN_MODE_SYSTEM_PROMPT } from '@/services/planMode';
import { getAllowedToolsForMode, getExecutionMode, resolveSessionExecutionModeId } from '@/services/executionMode';
import { detectBrowserIntent } from '@/services/browser/browserIntent';
import { BROWSER_TOOL_NAMES } from '@/services/browser/browserTools';
import { useCdpStore } from '@/store/cdpStore';
import { clearStreamingBuffer, getChatSessionTurnEpoch } from './chatStreaming';
import { scrubDanglingToolCalls } from './scrubDanglingToolCalls';
import { buildShellProfilePromptContext } from '@/utils/windowsShellProfile';
import { getSessionProjectDir as resolveSessionProjectDir, resolveRealSessionPipiOutputDir } from '@/utils/sessionFolders';
import { t } from '@/i18n';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import type { ChatActionFactoryDeps } from './chatActions';

type SendMessagePreparationInput = {
  content: string;
  activeSessionId: string;
  options?: ChatSendOptions;
  isAskMode: boolean;
  isPlanMode: boolean;
  executionModeId: ReturnType<typeof resolveSessionExecutionModeId>;
  executionModeProfile: ReturnType<typeof getExecutionMode>;
  diagnosticsTaskId: string;
  turnEpoch: number;
  sessionWorkDir?: string;
  onAssistantMessageCreated: (message: Message) => void;
  get: () => ChatState;
  set: ChatActionFactoryDeps['set'];
  currentMessages: ChatState['currentMessages'];
  addMessage: ChatState['addMessage'];
  setStreaming: ChatState['setStreaming'];
  setError: ChatState['setError'];
  setActiveChatDiagnosticsTaskId: (sessionId: string | null, taskId: string | null) => void;
  ChatGenerationCancelledError: new (sessionId: string) => Error & { sessionId: string };
  clearStreamChromeIfSelected: (
    set: ChatActionFactoryDeps['set'],
    get: () => ChatState,
    owningSessionId: string,
    extra?: Record<string, unknown>,
  ) => void;
};

type SendMessagePreparationResult =
  | { ready: false; assistantMessage: Message | null; sessionWorkDir?: string }
  | {
      ready: true;
      assistantMessage: Message;
      sessionWorkDir?: string;
      sessionPipiOutputDir?: string;
      finalSystemPrompt: string;
      shouldAllowBrowserTools: boolean;
      modeAllowedTools: string[] | undefined;
    };

export async function prepareSendMessageContext(
  input: SendMessagePreparationInput,
): Promise<SendMessagePreparationResult> {
  const {
    content, activeSessionId, options, isAskMode, isPlanMode, executionModeId,
    executionModeProfile, diagnosticsTaskId, turnEpoch, get, set,
    currentMessages, addMessage, setStreaming, setError, setActiveChatDiagnosticsTaskId,
    ChatGenerationCancelledError, clearStreamChromeIfSelected,
  } = input;
  let sessionWorkDir = input.sessionWorkDir;
  let assistantMessage: Message | null = null;

  const userMessage = createMessage('user', content, undefined, options?.attachments);
  await addMessage(userMessage);

  const activeGoal = useSessionGoalStore.getState().getGoalForSession(activeSessionId);
  if (activeGoal && activeGoal.status !== 'paused' && activeGoal.status !== 'completed' && !options?.goalLoopContinuation) {
    useSessionGoalStore.getState().recordTrace(activeSessionId, 'user_turn', content);
  } else if (activeGoal && options?.goalLoopContinuation) {
    useSessionGoalStore.getState().recordTrace(activeSessionId, 'system', '自动续跑触发');
  }

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
          // Two-folder model: delegated sub-agents run with the
          // **Project Folder** as their cwd so they can edit the
          // user's repo directly. The PiPi Output Folder is
          // resolved via the helper inside each agent when it
          // needs to write outputs.
          sessionWorkDir = resolveSessionProjectDir(currentSession);
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
  updateDiagnosticsTask(diagnosticsTaskId, {
    state: 'running',
    cancelable: true,
    detail: content.trim().slice(0, 240),
  });

  // Gate: never ship outbound API history with dangling tool_calls from a
  // stopped prior turn (Stop may still be awaiting native cancel).
  await scrubDanglingToolCalls(activeSessionId, set, get);
  // Stop / newer Send may advance the epoch during scrub DB awaits.
  // Abort before buildApiMessages / placeholder / runChatTurn so cleanup
  // cannot mutate a newer same-session turn (cancel catch is epoch-gated).
  if (getChatSessionTurnEpoch(activeSessionId) !== turnEpoch) {
    throw new ChatGenerationCancelledError(activeSessionId);
  }
  const messages = buildApiMessages(currentMessages());
  if (messages.length === 0) {
    setError('Message content is empty. Cannot send.');
    setStreaming(false);
    set({ streamingSessionId: null });
    return { ready: false, assistantMessage, sessionWorkDir };
  }

  assistantMessage = createMessage('assistant', '');
  input.onAssistantMessageCreated(assistantMessage);
  await addMessage(assistantMessage);

  const template = usePromptStore.getState().getActiveTemplate();
  const currentSession = get().sessions.find((session) => session.id === activeSessionId);
  const sessionWorkingFiles = currentSession?.workingFiles ?? [];
  // Two-folder model: the engine cwd / prompt builder / tool path
  // resolution all use the **Project Folder**. Resolve through the
  // helper so pre-v7 sessions (which only have `workDir`) keep
  // working without code changes.
  sessionWorkDir = resolveSessionProjectDir(currentSession);
  // The PiPi Output Folder is where chat outputs, docs, memory,
  // and AutoResearch artifacts land. Resolve the **real on-disk
  // path** via the Rust `get_app_default_dir` command — the
  // `PiPi-Shrimp/chats/<id>` placeholder must NEVER be fed into
  // a filesystem call, because nothing has joined it with the
  // platform's Documents folder yet.
  const sessionPipiOutputDir = await resolveRealSessionPipiOutputDir(currentSession);

  if (!isPlanMode && sessionPipiOutputDir && !currentSession?.outputDir) {
    try {
      // The Rust `get_next_output_dir` helper takes any folder
      // and returns `{folder}/.pipi-shrimp/{date}-{i}/`. We point
      // it at the PiPi Output Folder so the date-stamped layout
      // lives inside the app-owned root, not the user's repo.
      const outputDir = await safeInvoke<string>('get_next_output_dir', { workDir: sessionPipiOutputDir });
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
  if (sessionPipiOutputDir) {
    try {
      // core.md lives in the PiPi Output Folder, not the Project
      // Folder — two-folder model separation. Fall back to the
      // legacy `${projectDir}/.pipi-shrimp/core.md` location when
      // the PiPi Output Folder is missing or the legacy file is
      // the only one present, so pre-v7 sessions don't lose
      // memory.
      const legacyPath = sessionWorkDir ? `${sessionWorkDir}/.pipi-shrimp/core.md` : null;
      const newPath = `${sessionPipiOutputDir}/core.md`;
      const coreMdRes = await invoke<{ content: string; path: string }>('read_file', {
        path: newPath,
        workDir: sessionPipiOutputDir,
      }).catch(async (error) => {
        if (!legacyPath || !sessionWorkDir) {
          throw error;
        }
        return invoke<{ content: string; path: string }>('read_file', {
          path: legacyPath,
          workDir: sessionWorkDir,
        });
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
  if (sessionPipiOutputDir) {
    try {
      // Two-folder model: memory lives under the PiPi Output
      // Folder (`{pipiOutputDir}/.pipi-shrimp/memory`) rather than
      // `${projectDir}/.pipi-shrimp/memory`. The `getMemoryDir`
      // helper accepts a pipiOutputDir override; we pass the
      // PiPi Output Folder explicitly. Custom paths /
      // settings-based directories still win via the existing
      // priority list.
      const { getMemoryDir, getTopicMemoriesDir } = await import('../../services/memory/memoryPaths');
      const { buildMemoryContext, findRelevantMemories } = await import('../../services/memory/relevantRecall');
      const memoryDir = await getMemoryDir(sessionWorkDir, sessionPipiOutputDir);
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
  const shellProfileContext = buildShellProfilePromptContext({
    selection: useSettingsStore.getState().windowsShellProfile,
    workDir: sessionWorkDir,
  });
  const sessionGoalContext = useSessionGoalStore.getState().getPromptContext(activeSessionId);
  const { systemPrompt } = buildPrompt(template?.sections || [], {
    agentInstructions: useUIStore.getState().agentInstructions,
    // Two-folder model: `workDir` here is the **Project Folder**
    // (the user's repo). `pipiOutputDir` is the **PiPi Output
    // Folder** (app-owned output root). Both are exposed as
    // template variables so defaultTemplate can mention each one
    // explicitly in the prompt.
    workDir: sessionWorkDir || '',
    pipiOutputDir: sessionPipiOutputDir || '',
    coreMdContent,
    workingFilesList,
    memoryContext,
    shellProfileLabel: shellProfileContext.shellProfileLabel,
    shellProfileGuidance: shellProfileContext.shellProfileGuidance,
    originalQuery: '',
    browserResult: '',
    ...sessionGoalContext,
  });
  const modeSystemPrompt = executionModeProfile.systemPromptSuffix
    ? `${systemPrompt}\n\n${executionModeProfile.systemPromptSuffix}`
    : systemPrompt;
  const finalSystemPrompt = isPlanMode
    ? `${modeSystemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`
    : modeSystemPrompt;

  const browserIntent = detectBrowserIntent(content);
  const shouldAllowBrowserTools = Boolean(options?.allowBrowserTools || browserIntent);

  let modeAllowedTools = isAskMode
    ? []
    : isPlanMode
      ? [...PLAN_MODE_ALLOWED_TOOLS]
      : getAllowedToolsForMode(executionModeId);

  if (shouldAllowBrowserTools && !isAskMode && !isPlanMode) {
    if (modeAllowedTools) {
      modeAllowedTools = [...new Set([...modeAllowedTools, ...BROWSER_TOOL_NAMES])];
    }
  }

  if (shouldAllowBrowserTools && !isAskMode && !isPlanMode) {
    const { status, requestChromeConnection } = useCdpStore.getState();
    if (status !== 'connected') {
      const connected = await requestChromeConnection();
      if (!connected) {
        await get().updateLastMessage(
          '需要先连接 Chrome 才能执行浏览器任务。连接成功后请重新发送你的请求。',
        );
        clearStreamingBuffer(activeSessionId);
        clearStreamChromeIfSelected(set, get, activeSessionId, {
          pendingToolCalls: 0,
          pendingToolResults: [],
        });
        updateDiagnosticsTask(diagnosticsTaskId, {
          state: 'cancelled',
          cancelable: false,
        });
        setActiveChatDiagnosticsTaskId(activeSessionId, null);
        return { ready: false, assistantMessage, sessionWorkDir };
      }
    }
  }


  if (!assistantMessage) {
    throw new Error('Assistant message placeholder was not created');
  }
  return {
    ready: true,
    assistantMessage,
    sessionWorkDir,
    sessionPipiOutputDir,
    finalSystemPrompt,
    shouldAllowBrowserTools,
    modeAllowedTools,
  };
}
