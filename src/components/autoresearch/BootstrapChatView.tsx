import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessage } from '@/components/ChatMessage';
import { t } from '@/i18n';
import { createMessage, type Message } from '@/types/chat';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { AUTORESEARCH_BOOTSTRAP_TEMPLATE } from '@/services/agents/templates/autoresearchBootstrap';
import { AutoResearchBootstrapResultSchema } from '@/services/autoresearch/bootstrap/schema';
import {
  CONVERSATIONAL_TEMPLATE_OPENERS,
  type ConversationalTemplateOption,
} from '@/services/autoresearch/bootstrap/conversationalTemplates';
import type { AutoResearchBootstrapResult, ExtractedBaseline } from '@/services/autoresearch/bootstrap/types';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';
import { startAutoResearchRun, logAutoResearchSetupFailure } from '@/services/autoresearch/setupFlow';
import type { SshConfig } from '@/store/autoresearchStore';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { BootstrapQuickStartCards } from './BootstrapQuickStartCards';
import { BootstrapProgressRail } from './BootstrapProgressRail';
import { runSshExec, runSshUpload } from '@/tools/impl/SshTool';
import { shellEscapePath } from '@/utils/remoteExec';
import { shouldAutoOpenAutoResearchTerminal } from '@/utils/windowsShellProfile';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/store';

interface BootstrapChatViewProps {
  onReady?: () => void;
  sshConfig?: SshConfig;
}

function guessMetricDirection(metricName: string): 'higher' | 'lower' {
  const lowered = metricName.toLowerCase();
  if (['loss', 'error', 'perplexity', 'wer', 'cer', 'latency', 'time'].some((token) => lowered.includes(token))) {
    return 'lower';
  }
  return 'higher';
}

function resolveBaselineValue(baselines: ExtractedBaseline[], primaryMetric: string): number | null {
  const normalizedMetric = primaryMetric.trim().toLowerCase();
  for (const baseline of baselines) {
    for (const metric of baseline.reportedMetrics) {
      if (metric.name.trim().toLowerCase() === normalizedMetric) {
        return metric.value;
      }
    }
  }
  return baselines[0]?.reportedMetrics[0]?.value ?? null;
}

function createAssistantShell(): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  };
}

function toHeadlessMessages(messages: Message[]) {
  return messages
    .filter((message): message is Message & { role: 'user' | 'assistant' } => (
      message.role === 'user' || message.role === 'assistant'
    ))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export function BootstrapChatView({ onReady, sshConfig }: BootstrapChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftKey, setDraftKey] = useState('autoresearch-bootstrap-initial');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffSummary, setHandoffSummary] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const bootstrappedAtRef = useRef<string | null>(null);
  const currentStep = useBootstrapPlanStore((state) => state.currentStep);
  const warnings = useBootstrapPlanStore((state) => state.warnings);
  const readyResult = useBootstrapPlanStore((state) => state.readyResult);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const noteTool = useBootstrapPlanStore((state) => state.noteTool);
  const markMetricsStep = useBootstrapPlanStore((state) => state.markMetricsStep);
  const setWarnings = useBootstrapPlanStore((state) => state.setWarnings);
  const setReadyResult = useBootstrapPlanStore((state) => state.setReadyResult);
  const resetPlanStore = useBootstrapPlanStore((state) => state.reset);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => () => {
    resetPlanStore();
  }, [resetPlanStore]);

  const appendAssistantChunk = useCallback((messageId: string, chunk: string) => {
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? { ...message, content: `${message.content}${chunk}` }
        : message
    )));
  }, []);

  const handleReadyResult = useCallback(async (result: AutoResearchBootstrapResult) => {
    if (result.status !== 'ready' || bootstrappedAtRef.current === result.createdAt) {
      return;
    }
    bootstrappedAtRef.current = result.createdAt;

    const workDir = result.plan.scaffold.workDir;
    const isSshMode = sshConfig && sshConfig.mode === 'ssh';
    
    // Determine the directory name and target paths
    const folderName = workDir.split(/[\\/]/).filter(Boolean).pop() || 'bootstrap-project';
    const remoteWorkDir = isSshMode
      ? `${sshConfig.remoteWorkDir || '~/autoresearch'}/${folderName}`
      : workDir;

    const targetConfig: SshConfig = isSshMode
      ? {
          ...sshConfig,
          remoteWorkDir,
        }
      : {
          mode: 'local',
          host: '',
          user: 'root',
          keyPath: '',
          port: 22,
          remoteWorkDir: workDir,
          authMode: 'agent',
          password: '',
        };

    const baseline = resolveBaselineValue(result.plan.baselines, result.plan.primaryMetric);
    const direction = guessMetricDirection(result.plan.primaryMetric);
    const autoResearchState = useAutoResearchStore.getState();

    try {
      if (isSshMode) {
        // 1. Create remote workspace directory
        await runSshExec({
          ...sshConfig,
          command: `mkdir -p ${shellEscapePath(remoteWorkDir)}`,
        });

        // 2. Upload scaffold files
        for (const file of result.plan.scaffold.files) {
          const localFilePath = `${workDir}/${file.path}`;
          const remoteFilePath = `${remoteWorkDir}/${file.path}`;

          // Read local file content
          const localFileResponse = await invoke<{ content: string }>('read_file', {
            path: localFilePath,
            workDir: null,
          });

          // Upload to remote
          await runSshUpload({
            ...sshConfig,
            content: localFileResponse.content,
            remotePath: remoteFilePath,
          });
        }

        // 3. Upload bootstrap plan JSON
        const remoteBootstrapResultPath = `${remoteWorkDir}/.pipi-shrimp/autoresearch.bootstrap.json`;
        await runSshUpload({
          ...sshConfig,
          content: JSON.stringify(result, null, 2),
          remotePath: remoteBootstrapResultPath,
        });

        // 4. Initialize Git on remote
        await runSshExec({
          ...sshConfig,
          command: [
            `cd ${shellEscapePath(remoteWorkDir)}`,
            `git init`,
            `git config user.name "AutoResearch"`,
            `git config user.email "autoresearch@local"`,
            `git add -A`,
            `git commit --allow-empty -m "Initial bootstrap scaffold"`,
          ].join('\n'),
        });
      }

      const started = await startAutoResearchRun({
        sshConfig: targetConfig,
        experimentDir: remoteWorkDir,
        metric: result.plan.primaryMetric,
        direction,
        iterations: 50,
        baseline,
      }, {
        setSshConfig: autoResearchState.setSshConfig,
        setLastUsedConfig: autoResearchState.setLastUsedConfig,
        initSession: autoResearchState.initSession,
      });

      (autoResearchState as typeof autoResearchState & {
        setSuccessCriteria?: (value: string) => void;
        setPrimaryMetric?: (value: string) => void;
      }).setSuccessCriteria?.(result.plan.successCriteria);
      (autoResearchState as typeof autoResearchState & {
        setSuccessCriteria?: (value: string) => void;
        setPrimaryMetric?: (value: string) => void;
      }).setPrimaryMetric?.(result.plan.primaryMetric);

      if (shouldAutoOpenAutoResearchTerminal({
        selection: windowsShellProfile,
        mode: started.resolvedConfig.mode,
        workDir: started.resolvedConfig.remoteWorkDir,
      })) {
        autoResearchState.openTerminalPanel(
          `autoresearch-terminal-${Date.now()}`,
          started.resolvedConfig.mode === 'local' ? started.resolvedConfig.remoteWorkDir : '',
        );
      }

      const workflowState = useWorkflowStore.getState();
      if (!workflowState.getCurrentInstance()) {
        workflowState.createInstance('AutoResearch Bootstrap');
      }
      workflowState.addWorkflowRun({
        id: crypto.randomUUID(),
        title: result.plan.researchGoal,
        projectGoal: result.plan.researchGoal,
        successCriteria: result.plan.successCriteria,
        bootstrapKind: 'conversational',
        status: 'running',
        startTime: Date.now(),
        agents: [],
        runDirectory: isSshMode ? remoteWorkDir : workDir,
        currentIteration: 0,
        goalEvaluations: [],
        reachedGoal: false,
      });

      setHandoffSummary(`${result.plan.primaryMetric} · ${isSshMode ? remoteWorkDir : workDir}`);
      onReady?.();
    } catch (handoffError) {
      setError(logAutoResearchSetupFailure('bootstrap-handoff', handoffError, {
        workDir: isSshMode ? remoteWorkDir : workDir,
        metric: result.plan.primaryMetric,
      }));
    }
  }, [onReady, sshConfig, windowsShellProfile]);

  const handleToolResult = useCallback(async (name: string, result: string) => {
    if (name === 'baseline_extract') {
      markMetricsStep();
      return;
    }

    if (name !== 'bootstrap_finalize') {
      return;
    }

    try {
      const parsed = AutoResearchBootstrapResultSchema.safeParse(JSON.parse(result));
      if (!parsed.success) {
        return;
      }
      setWarnings(parsed.data.warnings);
      setReadyResult(parsed.data);
      await handleReadyResult(parsed.data);
    } catch {
      // Ignore malformed tool content and let the agent continue.
    }
  }, [handleReadyResult, markMetricsStep, setReadyResult, setWarnings]);

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    setError(null);
    const userMessage = createMessage('user', trimmed);
    const assistantShell = createAssistantShell();
    const nextMessages = [...messagesRef.current, userMessage, assistantShell];
    setMessages(nextMessages);
    setIsStreaming(true);

    try {
      await runHeadlessAgentTurn({
        sessionId: `autoresearch-bootstrap-${Date.now()}`,
        initialMessages: toHeadlessMessages(nextMessages),
        systemPrompt: [
          AUTORESEARCH_BOOTSTRAP_TEMPLATE.soulPrompt,
          AUTORESEARCH_BOOTSTRAP_TEMPLATE.taskInstruction,
        ].filter(Boolean).join('\n\n'),
        allowedTools: AUTORESEARCH_BOOTSTRAP_TEMPLATE.allowedTools,
        onTextDelta: (chunk) => appendAssistantChunk(assistantShell.id, chunk),
        onToolCall: async ({ name }) => {
          noteTool(name);
        },
        onToolResult: async ({ name, result }) => {
          await handleToolResult(name, result);
        },
      });
    } catch (runnerError) {
      setError(runnerError instanceof Error ? runnerError.message : String(runnerError));
    } finally {
      setIsStreaming(false);
    }
  }, [appendAssistantChunk, handleToolResult, isStreaming, noteTool]);

  const handleQuickStart = useCallback((templateId: ConversationalTemplateOption['id']) => {
    const opener = CONVERSATIONAL_TEMPLATE_OPENERS[templateId];
    const nextDraftKey = `autoresearch-bootstrap-${Date.now()}`;
    localStorage.setItem(`chat_draft_${nextDraftKey}`, opener);
    setDraftKey(nextDraftKey);
  }, []);

  const summaryCard = useMemo(() => {
    if (!readyResult) {
      return null;
    }

    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p className="font-semibold">{t('autoresearch.bootstrap.readyTitle')}</p>
        <p className="mt-1">{readyResult.plan.primaryMetric} · {readyResult.plan.scaffold.workDir}</p>
        <p className="mt-1 text-xs text-emerald-800">{readyResult.plan.successCriteria}</p>
      </div>
    );
  }, [readyResult]);

  return (
    <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.bootstrap.kicker')}</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">{t('autoresearch.bootstrap.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            {t('autoresearch.bootstrap.description')}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-5 py-5">
          {messages.length === 0 ? (
            <div className="space-y-5">
              <div className="rounded-[24px] border border-dashed border-gray-300 bg-white px-5 py-6 text-sm text-gray-600">
                {t('autoresearch.bootstrap.emptyPrompt')}
              </div>
              <BootstrapQuickStartCards onSelect={handleQuickStart} />
            </div>
          ) : (
            <div className="space-y-0 overflow-hidden rounded-[24px] border border-gray-200 bg-white">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLatest={index === messages.length - 1}
                  isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 bg-white px-4 py-4">
          <div className="space-y-3">
            {summaryCard}
            {handoffSummary && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                {t('autoresearch.bootstrap.started')}: {handoffSummary}
              </div>
            )}
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <ChatInput
              key={draftKey}
              draftKey={draftKey}
              submitMode="callback-only"
              density="compact"
              onSend={(message) => handleSend(message)}
            />
          </div>
        </div>
      </div>

      <BootstrapProgressRail currentStep={currentStep} warnings={warnings} />
    </div>
  );
}

export default BootstrapChatView;
