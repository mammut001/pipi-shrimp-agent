import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { AUTORESEARCH_BOOTSTRAP_TEMPLATE } from '@/services/agents/templates/autoresearchBootstrap';
import { AutoResearchBootstrapResultSchema } from '@/services/autoresearch/bootstrap/schema';
import {
  ConversationalTemplateOption,
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
import { open } from '@tauri-apps/plugin-dialog';
import { type ComposerBlock } from '@/components/chatInput/blocks/types';
import { BlockComposer } from '@/components/chatInput/BlockComposer';

const INITIAL_BOOTSTRAP_BLOCKS: ComposerBlock[] = [
  {
    id: 'b-initial-intent',
    type: 'intent',
    intentType: 'autoresearch',
    detail: 'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.',
  },
  {
    id: 'b-initial-mode',
    type: 'mode',
    executionMode: 'agent',
  },
];

const templateBlocks: Record<string, ComposerBlock[]> = {
  'reproduce-paper': [
    {
      id: 'b-reproduce-intent',
      type: 'intent',
      intentType: 'autoresearch',
      detail: 'I want to fully reproduce a paper. Please help me identify the paper claims, lock baselines, target primary metric, and construct scaffold files.',
    },
    {
      id: 'b-reproduce-mode',
      type: 'mode',
      executionMode: 'agent',
    },
    {
      id: 'b-reproduce-output',
      type: 'output',
      outputType: 'test_report',
      includeFilesChanged: true,
      includeCommandsRun: true,
      includeRemainingRisks: true,
      includeManualQA: false,
      customOutput: 'Reproduced metrics and comparison statistics table',
    },
  ],
  'beat-baseline': [
    {
      id: 'b-baseline-intent',
      type: 'intent',
      intentType: 'autoresearch',
      detail: 'I want to exceed an existing baseline on a known task. Please propose improvements, keep evaluations fair, and setup experiment workspace.',
    },
    {
      id: 'b-baseline-mode',
      type: 'mode',
      executionMode: 'agent',
    },
    {
      id: 'b-baseline-constraints',
      type: 'constraints',
      noBroadRefactor: true,
      preservePublicApi: true,
      noDestructiveCommands: true,
      readOnly: false,
      customConstraints: [],
    },
    {
      id: 'b-baseline-output',
      type: 'output',
      outputType: 'test_report',
      includeFilesChanged: true,
      includeCommandsRun: true,
      includeRemainingRisks: true,
      includeManualQA: false,
    },
  ],
  'ablation': [
    {
      id: 'b-ablation-intent',
      type: 'intent',
      intentType: 'autoresearch',
      detail: 'I want to conduct ablation studies on an existing model or method. Please help me isolate ablation parameters, verify metrics, and bootstrap scaffolding.',
    },
    {
      id: 'b-ablation-mode',
      type: 'mode',
      executionMode: 'agent',
    },
    {
      id: 'b-ablation-constraints',
      type: 'constraints',
      noBroadRefactor: true,
      preservePublicApi: true,
      noDestructiveCommands: true,
      readOnly: false,
      customConstraints: [],
    },
    {
      id: 'b-ablation-output',
      type: 'output',
      outputType: 'test_report',
      includeFilesChanged: false,
      includeCommandsRun: true,
      includeRemainingRisks: true,
      includeManualQA: false,
    },
  ],
  'from-scratch': [
    {
      id: 'b-scratch-intent',
      type: 'intent',
      intentType: 'autoresearch',
      detail: 'I want to start a brand new AutoResearch project from scratch. Please propose a concrete research objective and scaffold the project workspace.',
    },
    {
      id: 'b-scratch-mode',
      type: 'mode',
      executionMode: 'agent',
    },
    {
      id: 'b-scratch-output',
      type: 'output',
      outputType: 'patch',
      includeFilesChanged: true,
      includeCommandsRun: true,
      includeRemainingRisks: false,
      includeManualQA: false,
    },
  ],
};

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

export function BootstrapChatView({ onReady, sshConfig }: BootstrapChatViewProps) {
  const [composerBlocks, setComposerBlocks] = useState<ComposerBlock[]>(INITIAL_BOOTSTRAP_BLOCKS);
  const [hasStarted, setHasStarted] = useState(false);
  const [agentLogs, setAgentLogs] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffSummary, setHandoffSummary] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<ConversationalTemplateOption['id'] | null>(null);
  const bootstrappedAtRef = useRef<string | null>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);

  const currentStep = useBootstrapPlanStore((state) => state.currentStep);
  const warnings = useBootstrapPlanStore((state) => state.warnings);
  const readyResult = useBootstrapPlanStore((state) => state.readyResult);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const importedFiles = useSettingsStore((state) => state.importedFiles);
  const addImportedFiles = useSettingsStore((state) => state.addImportedFiles);
  const removeImportedFile = useSettingsStore((state) => state.removeImportedFile);
  const noteTool = useBootstrapPlanStore((state) => state.noteTool);
  const markMetricsStep = useBootstrapPlanStore((state) => state.markMetricsStep);
  const setWarnings = useBootstrapPlanStore((state) => state.setWarnings);
  const setReadyResult = useBootstrapPlanStore((state) => state.setReadyResult);
  const resetPlanStore = useBootstrapPlanStore((state) => state.reset);

  useEffect(() => () => {
    resetPlanStore();
  }, [resetPlanStore]);

  // Autoscroll console to bottom on update
  useEffect(() => {
    if (consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [agentLogs]);

  const composerContext = useMemo(() => ({
    projectFolder: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : undefined,
    contextFiles: importedFiles.map((file) => file.path),
  }), [sshConfig, importedFiles]);

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

  const handleAddFiles = useCallback(async () => {
    try {
      const selection = await open({
        directory: false,
        multiple: true,
        title: 'Select Literature or Code Reference Files',
        filters: [
          {
            name: 'Supported Documents',
            extensions: ['pdf', 'py', 'ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'txt', 'md', 'json', 'yaml', 'yml'],
          },
        ],
      });

      if (!selection) return;

      const paths = Array.isArray(selection) ? selection : [selection];
      const newFiles = paths.map((p) => ({
        name: p.split(/[\\/]/).pop() || p,
        path: p,
      }));

      addImportedFiles(newFiles);
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }, [addImportedFiles]);

  const handleStartBootstrap = useCallback(async (compiledPrompt: string) => {
    if (isStreaming) {
      return;
    }

    setError(null);
    setHasStarted(true);
    setIsStreaming(true);
    setAgentLogs(`[SYSTEM] Initializing AutoResearch Bootstrap Setup...\n`);

    const workingFilesList = importedFiles.length > 0
      ? importedFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
      : '';

    const contextFilesSection = workingFilesList
      ? `\n\n## Context Files / Literature & Reference Documents\n\nThe user has attached the following files as references:\n${workingFilesList}\n\nRules:\n- Use these files as references for the research target, code design, baseline, or paper details.\n- Read a file by its exact path using 'pdf_read' (for PDFs) or 'read_file' (for code/text files) before discussing its contents. Do not assume you know its contents. Do not invent details.`
      : '';

    const systemPrompt = [
      AUTORESEARCH_BOOTSTRAP_TEMPLATE.soulPrompt,
      AUTORESEARCH_BOOTSTRAP_TEMPLATE.taskInstruction,
    ].filter(Boolean).join('\n\n') + contextFilesSection;

    const initialMessages = [
      {
        role: 'user' as const,
        content: compiledPrompt,
      },
    ];

    try {
      setAgentLogs((prev) => prev + `[SYSTEM] Spawning Headless Research Agent with custom prompt blocks...\n\n`);
      await runHeadlessAgentTurn({
        sessionId: `autoresearch-bootstrap-${Date.now()}`,
        initialMessages,
        systemPrompt,
        allowedTools: AUTORESEARCH_BOOTSTRAP_TEMPLATE.allowedTools,
        onTextDelta: (chunk) => {
          setAgentLogs((prev) => prev + chunk);
        },
        onStatus: (message) => {
          setAgentLogs((prev) => prev + `\n[STATUS] ${message}\n`);
        },
        onToolCall: async ({ name }) => {
          setAgentLogs((prev) => prev + `\n[TOOL CALL] Executing: ${name}\n`);
          noteTool(name);
        },
        onToolResult: async ({ name, result, durationMs }) => {
          setAgentLogs((prev) => prev + `[TOOL RESULT] Completed ${name} in ${durationMs}ms.\n`);
          await handleToolResult(name, result);
        },
      });
      setAgentLogs((prev) => prev + `\n[SYSTEM] Headless Research Agent completed successfully.\n`);
    } catch (runnerError) {
      const errMsg = runnerError instanceof Error ? runnerError.message : String(runnerError);
      setError(errMsg);
      setAgentLogs((prev) => prev + `\n[ERROR] Bootstrap execution error: ${errMsg}\n`);
    } finally {
      setIsStreaming(false);
    }
  }, [handleToolResult, isStreaming, noteTool, importedFiles]);

  const handleQuickStart = useCallback((templateId: ConversationalTemplateOption['id']) => {
    setSelectedTemplateId(templateId);
    const presetBlocks = templateBlocks[templateId] || [];
    setComposerBlocks(presetBlocks);
  }, []);

  const summaryCard = useMemo(() => {
    if (!readyResult) {
      return null;
    }

    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm animate-fadeIn">
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

        <div className="min-h-0 flex-1 flex flex-col bg-gray-50 px-5 py-5 overflow-y-auto">
          {!hasStarted ? (
            <div className="space-y-6 flex-1 flex flex-col">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-gray-400">
                  Select a template preset
                </h3>
                <BootstrapQuickStartCards selectedId={selectedTemplateId} onSelect={handleQuickStart} />
              </div>

              <div className="space-y-2 flex-1 flex flex-col min-h-0">
                <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-gray-400">
                  Configure Task Blocks
                </h3>
                <BlockComposer
                  blocks={composerBlocks}
                  onChange={setComposerBlocks}
                  onSend={handleStartBootstrap}
                  context={composerContext}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 min-h-0 animate-fadeIn">
              {/* Status information */}
              {summaryCard}
              {handoffSummary && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">
                  {t('autoresearch.bootstrap.started')}: {handoffSummary}
                </div>
              )}
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
                  {error}
                </div>
              )}

              {/* Live console terminal */}
              <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 text-neutral-200 font-mono text-xs rounded-2xl overflow-hidden border border-neutral-800 shadow-xl">
                <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
                      <span className="w-3 h-3 rounded-full bg-yellow-500/80"></span>
                      <span className="w-3 h-3 rounded-full bg-green-500/80"></span>
                    </div>
                    <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider ml-2">Developer Console</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isStreaming && (
                      <button
                        onClick={() => {
                          setHasStarted(false);
                          setError(null);
                        }}
                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 hover:text-white transition-all text-neutral-300"
                      >
                        ← Back to Composer
                      </button>
                    )}
                    {isStreaming ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] text-neutral-400">Bootstrap in progress...</span>
                      </>
                    ) : error ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        <span className="text-[10px] text-red-400 font-bold">Failed</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-[10px] text-emerald-400 font-bold">Finished</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1.5 selection:bg-neutral-800" ref={consoleScrollRef}>
                  <pre className="whitespace-pre-wrap leading-relaxed">{agentLogs || 'Initializing bootstrap process...'}</pre>
                  {isStreaming && (
                    <div className="inline-flex items-center gap-1 text-[10px] text-neutral-500 animate-pulse font-sans">
                      <span>▋</span>
                      <span>Streaming logs...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto min-w-0">
        <BootstrapProgressRail currentStep={currentStep} warnings={warnings} />

        {/* Literature & Reference Documents Section */}
        <aside className="rounded-[24px] border border-gray-200 bg-white p-5 flex flex-col min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
            {t('autoresearch.bootstrap.referenceDocsTitle')}
          </p>

          <div className="mt-3 flex-1 overflow-y-auto space-y-2 max-h-[250px] min-h-[60px]">
            {importedFiles.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                {t('autoresearch.bootstrap.noReference')}
              </p>
            ) : (
              importedFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors group">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm shrink-0">
                      {file.name.endsWith('.pdf') ? '📕' : '📄'}
                    </span>
                    <span className="text-xs font-medium text-gray-700 truncate" title={file.path}>
                      {file.name}
                    </span>
                  </div>
                  <button
                    onClick={() => removeImportedFile(file.id)}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Remove"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            onClick={handleAddFiles}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold border border-gray-200 hover:border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98]"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('autoresearch.bootstrap.addReference')}
          </button>
        </aside>
      </div>
    </div>
  );
}

export default BootstrapChatView;
