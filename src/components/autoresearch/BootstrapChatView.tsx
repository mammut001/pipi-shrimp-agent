import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { AUTORESEARCH_BOOTSTRAP_TEMPLATE } from '@/services/agents/templates/autoresearchBootstrap';
import { AutoResearchBootstrapResultSchema } from '@/services/autoresearch/bootstrap/schema';
import {
  ConversationalTemplateOption,
} from '@/services/autoresearch/bootstrap/conversationalTemplates';
import type { AutoResearchBootstrapResult, ExtractedBaseline } from '@/services/autoresearch/bootstrap/types';
import { useBootstrapPlanStore, getStepForTool } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';
import {
  BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE,
  buildBootstrapSystemPromptWithFinalizeRequirement,
  shouldRunBootstrapFinalizeNudge,
} from '@/services/autoresearch/bootstrap/finalizeNudge';
import { startAutoResearchRun, logAutoResearchSetupFailure } from '@/services/autoresearch/setupFlow';
import { getAutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';
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
import { BootstrapRecipeBuilder } from './BootstrapRecipeBuilder';
import { RecipeTemplateChooser } from './recipe/RecipeTemplateChooser';
import { type Recipe } from './bootstrapRecipePrompt';
import { AutoResearchSetupPhaseChip } from './AutoResearchSetupPhaseChip';

interface BootstrapChatViewProps {
  onReady?: () => void;
  sshConfig?: SshConfig;
}

/** Shared copy for tests + UI when headless turn omits bootstrap_finalize. */
export const BOOTSTRAP_MISSING_FINALIZE_MESSAGE =
  'Bootstrap agent finished but did not produce a bootstrap_finalize result.';

function parseToolResultError(result: string): { isError: boolean; kind: 'none' | 'failed' | 'blocked' | 'confirmation_required'; reason: string } {
  if (!result || typeof result !== 'string') {
    return { isError: false, kind: 'none', reason: '' };
  }

  const trimmed = result.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.error_kind === 'confirmation_required' || parsed.error === 'confirmation_required') {
        return { isError: true, kind: 'confirmation_required', reason: parsed.message || 'Confirmation required' };
      }
      if (parsed.error_kind === 'permission_denied' || parsed.error === 'permission_denied') {
        return { isError: true, kind: 'blocked', reason: parsed.message || 'Permission denied' };
      }
      if (parsed.error === true || parsed.is_error === true || parsed.error_kind) {
        return { isError: true, kind: 'failed', reason: parsed.message || parsed.cause || 'Tool failed' };
      }
    } catch {
      // not JSON
    }
  }

  if (trimmed.startsWith('Error:') || trimmed.startsWith('error:')) {
    return { isError: true, kind: 'failed', reason: trimmed.slice(0, 120) };
  }

  return { isError: false, kind: 'none', reason: '' };
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
  const [recipe, setRecipe] = useState<Recipe>({
    researchGoal: {
      goalText: '',
      taskType: 'reproduce_paper',
      source: 'template',
    },
    references: {},
    baselineAndMetric: {
      primaryMetric: '',
      direction: 'higher',
      baselineValue: '',
      successCriteria: '',
    },
    workspace: {
      workDir: sshConfig?.remoteWorkDir || '',
      folderName: 'bootstrap-project',
    },
    verification: {
      commands: [],
    },
    outputContract: {
      includeMetrics: true,
      includeArtifacts: true,
      includeCommandsRun: true,
      includeFailureReason: true,
      includeRemainingRisks: true,
    },
  });

  const [recipeDirty, setRecipeDirty] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [agentLogs, setAgentLogs] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffSummary, setHandoffSummary] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<ConversationalTemplateOption['id'] | null>(null);
  const [templatesExpanded, setTemplatesExpanded] = useState(true);
  const [iterations, setIterations] = useState(() => getAutoResearchDefaultConfig().iterations);
  const bootstrappedAtRef = useRef<string | null>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const bootstrapAbortRef = useRef<AbortController | null>(null);

  const [stoppedByUser, setStoppedByUser] = useState(false);
  /** Last compiled prompt — used to offer Retry after missing bootstrap_finalize. */
  const lastCompiledPromptRef = useRef<string | null>(null);
  const [missingFinalize, setMissingFinalize] = useState(false);

  const clearImportedFiles = useSettingsStore((state) => state.clearImportedFiles);

  useEffect(() => {
    clearImportedFiles();
  }, [clearImportedFiles]);

  const currentStep = useBootstrapPlanStore((state) => state.currentStep);
  const failedStep = useBootstrapPlanStore((state) => state.failedStep);
  const failureReason = useBootstrapPlanStore((state) => state.failureReason);
  const warnings = useBootstrapPlanStore((state) => state.warnings);
  const readyResult = useBootstrapPlanStore((state) => state.readyResult);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const importedFiles = useSettingsStore((state) => state.importedFiles);
  const noteTool = useBootstrapPlanStore((state) => state.noteTool);
  const markMetricsStep = useBootstrapPlanStore((state) => state.markMetricsStep);
  const setWarnings = useBootstrapPlanStore((state) => state.setWarnings);
  const setReadyResult = useBootstrapPlanStore((state) => state.setReadyResult);
  const resetPlanStore = useBootstrapPlanStore((state) => state.reset);

  useEffect(() => () => {
    resetPlanStore();
  }, [resetPlanStore]);

  // Sync workspace root if sshConfig changes
  useEffect(() => {
    if (sshConfig?.remoteWorkDir) {
      setRecipe((prev) => ({
        ...prev,
        workspace: {
          ...prev.workspace,
          workDir: sshConfig.remoteWorkDir || '',
        },
      }));
    }
  }, [sshConfig]);

  // Autoscroll console to bottom on update
  useEffect(() => {
    if (consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [agentLogs]);

  const handleReadyResult = useCallback(async (result: AutoResearchBootstrapResult, runIterations: number) => {
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
        iterations: runIterations,
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
    } catch {
      // Ignore malformed tool content and let the agent continue.
    }
  }, [markMetricsStep, setReadyResult, setWarnings]);

  const handleStopBootstrap = useCallback(() => {
    bootstrapAbortRef.current?.abort();
    setStoppedByUser(true);
    setIsStreaming(false);
    setAgentLogs((prev) => prev + '\n[SYSTEM] Bootstrap stopped by user.\n');
  }, []);

  const handleStartBootstrap = useCallback(async (compiledPrompt: string) => {
    if (isStreaming) {
      return;
    }

    lastCompiledPromptRef.current = compiledPrompt;
    setError(null);
    setMissingFinalize(false);
    setStoppedByUser(false);
    setHasStarted(true);
    setIsStreaming(true);
    setAgentLogs(`[SYSTEM] Initializing AutoResearch Bootstrap Setup...\n`);

    bootstrapAbortRef.current = new AbortController();

    const workingFilesList = importedFiles.length > 0
      ? importedFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
      : '';

    const contextFilesSection = workingFilesList
      ? `\n\n## Context Files / Literature & Reference Documents\n\nThe user has attached the following files as references:\n${workingFilesList}\n\nRules:\n- Use these files as references for the research target, code design, baseline, or paper details.\n- Read a file by its exact path using 'pdf_read' (for PDFs) or 'read_file' (for code/text files) before discussing its contents. Do not assume you know its contents. Do not invent details.`
      : '';

    const systemPrompt = buildBootstrapSystemPromptWithFinalizeRequirement(
      [
        AUTORESEARCH_BOOTSTRAP_TEMPLATE.soulPrompt,
        AUTORESEARCH_BOOTSTRAP_TEMPLATE.taskInstruction,
      ].filter(Boolean).join('\n\n') + contextFilesSection,
    );

    const initialMessages = [
      {
        role: 'user' as const,
        content: compiledPrompt,
      },
    ];

    const targetWorkDir = (sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : (recipe.workspace.workDir || '')) || undefined;

    const runBootstrapTurn = async (messages: typeof initialMessages, label: string) => {
      const spawningLabel = t('autoresearch.bootstrap.log.spawning') || label;
      setAgentLogs((prev) => prev + `[SYSTEM] ${spawningLabel}\n\n`);
      await runHeadlessAgentTurn({
        sessionId: `autoresearch-bootstrap-${Date.now()}`,
        initialMessages: messages,
        systemPrompt,
        allowedTools: AUTORESEARCH_BOOTSTRAP_TEMPLATE.allowedTools,
        toolExecutionSource: 'autoresearch_phase',
        permissionMode: 'bypass',
        executionMode: 'bypass',
        workDir: targetWorkDir,
        signal: bootstrapAbortRef.current!.signal,
        onTextDelta: (chunk) => {
          setAgentLogs((prev) => prev + chunk);
        },
        onStatus: (message) => {
          setAgentLogs((prev) => prev + `\n[STATUS] ${message}\n`);
        },
        onToolCall: async ({ name }) => {
          const executingTpl = t('autoresearch.bootstrap.log.executing') || '[TOOL CALL] Executing: {name}';
          const msg = executingTpl.replace('{name}', name);
          setAgentLogs((prev) => prev + `\n${msg}\n`);
        },
        onToolResult: async ({ name, result, durationMs }) => {
          const err = parseToolResultError(result);
          if (err.isError) {
            const isBlocked = err.kind === 'blocked' || err.kind === 'confirmation_required';
            const logTpl = isBlocked
              ? (t('autoresearch.bootstrap.log.blocked') || '[TOOL RESULT] BLOCKED: {name} — {reason} ({duration}ms)')
              : (t('autoresearch.bootstrap.log.failed') || '[TOOL RESULT] FAILED: {name} — {reason} ({duration}ms)');
            const logMsg = logTpl
              .replace('{name}', name)
              .replace('{reason}', err.reason)
              .replace('{duration}', String(durationMs));
            setAgentLogs((prev) => prev + `${logMsg}\n`);
            useBootstrapPlanStore.getState().setStepFailure(getStepForTool(name), err.reason);
          } else {
            const completedTpl = t('autoresearch.bootstrap.log.completed') || '[TOOL RESULT] Completed {name} in {duration}ms.';
            const logMsg = completedTpl
              .replace('{name}', name)
              .replace('{duration}', String(durationMs));
            setAgentLogs((prev) => prev + `${logMsg}\n`);
            noteTool(name);
            await handleToolResult(name, result);
          }
        },
      });
    };

    try {
      await runBootstrapTurn(
        initialMessages,
        'Spawning Headless Research Agent with custom prompt blocks...',
      );
      if (bootstrapAbortRef.current.signal.aborted) {
        return;
      }

      let ready = useBootstrapPlanStore.getState().readyResult;
      // End-of-turn nudge: if the first turn omitted bootstrap_finalize, run one
      // short forced-finalize turn before treating this as a hard failure.
      if (shouldRunBootstrapFinalizeNudge(ready)) {
        setAgentLogs(
          (prev) =>
            prev
            + '\n[SYSTEM] bootstrap_finalize missing after first turn — running finalize nudge turn...\n',
        );
        await runBootstrapTurn(
          [{ role: 'user', content: BOOTSTRAP_FINALIZE_NUDGE_USER_MESSAGE }],
          'Finalize-nudge headless turn (must call bootstrap_finalize)...',
        );
        if (bootstrapAbortRef.current.signal.aborted) {
          return;
        }
        ready = useBootstrapPlanStore.getState().readyResult;
      }

      if (shouldRunBootstrapFinalizeNudge(ready)) {
        const warnMsg = BOOTSTRAP_MISSING_FINALIZE_MESSAGE;
        setMissingFinalize(true);
        setError(
          `${warnMsg} Use “Retry bootstrap” to run again with the same recipe, `
          + 'or “Back to Recipe” to adjust goals/workspace, then start again.',
        );
        setAgentLogs(
          (prev) =>
            prev
            + `\n[WARNING] ${warnMsg}\n`
            + '[RECOVERY] Next steps: Retry bootstrap (same prompt) or Back to Recipe to edit setup.\n',
        );
      } else {
        setMissingFinalize(false);
        setAgentLogs((prev) => prev + `\n[SYSTEM] Headless Research Agent completed successfully.\n`);
      }
    } catch (runnerError) {
      if (bootstrapAbortRef.current?.signal.aborted) {
        return;
      }
      const errMsg = runnerError instanceof Error ? runnerError.message : String(runnerError);
      setMissingFinalize(false);
      setError(errMsg);
      setAgentLogs((prev) => prev + `\n[ERROR] Bootstrap execution error: ${errMsg}\n`);
    } finally {
      setIsStreaming(false);
    }
  }, [handleToolResult, isStreaming, noteTool, importedFiles]);

  const handleRetryBootstrap = useCallback(() => {
    const prompt = lastCompiledPromptRef.current;
    if (!prompt || isStreaming) {
      return;
    }
    void handleStartBootstrap(prompt);
  }, [handleStartBootstrap, isStreaming]);

  const handleQuickStart = useCallback((templateId: ConversationalTemplateOption['id']) => {
    if (recipeDirty) {
      const confirmReset = window.confirm(
        t('autoresearch.recipe.confirmReset') ||
        'Switching templates will overwrite your edited configurations. Are you sure you want to reset the recipe?'
      );
      if (!confirmReset) {
        return;
      }
    }

    setSelectedTemplateId(templateId);
    setTemplatesExpanded(false);

    let taskType: Recipe['researchGoal']['taskType'] = 'reproduce_paper';
    let goalText = '';
    let folderName = 'bootstrap-project';
    let verifyCommands: string[] = [];
    let baselineValue = '';
    let successCriteria = '';

    if (templateId === 'reproduce-paper') {
      taskType = 'reproduce_paper';
      goalText = 'I want to fully reproduce a paper. Please help me identify the paper claims, lock baselines, target primary metric, and construct scaffold files.';
      folderName = 'reproduce-project';
    } else if (templateId === 'beat-baseline') {
      taskType = 'beat_baseline';
      goalText = 'I want to exceed an existing baseline on a known task. Please propose improvements, keep evaluations fair, and setup experiment workspace.';
      folderName = 'baseline-project';
    } else if (templateId === 'ablation') {
      taskType = 'ablation';
      goalText = 'I want to conduct ablation studies on an existing model or method. Please help me isolate ablation parameters, verify metrics, and bootstrap scaffolding.';
      folderName = 'ablation-project';
      baselineValue = '';
      successCriteria = '';
    } else if (templateId === 'from-scratch') {
      taskType = 'from_scratch';
      goalText = 'I want to start a brand new AutoResearch project from scratch. Please propose a concrete research objective and scaffold the project workspace.';
      folderName = 'scratch-project';
      baselineValue = '';
      successCriteria = '';
    }

    setRecipe((prev) => ({
      ...prev,
      researchGoal: {
        taskType,
        goalText,
        source: 'template',
      },
      workspace: {
        ...prev.workspace,
        folderName,
      },
      verification: {
        commands: verifyCommands,
      },
      baselineAndMetric: {
        ...prev.baselineAndMetric,
        baselineValue,
        successCriteria,
      },
    }));
    setRecipeDirty(false);
  }, [recipeDirty]);

  const handleRecipeChange = useCallback((newRecipe: Recipe) => {
    setRecipe(newRecipe);
    setRecipeDirty(true);
  }, []);

  const setupPhaseInput = useMemo(() => ({
    bootstrapKind: 'conversational' as const,
    bootstrapStreaming: isStreaming,
    bootstrapReady: Boolean(readyResult),
    startingRun: false,
    error,
  }), [isStreaming, readyResult, error]);

  const summaryCard = useMemo(() => {
    if (!readyResult || handoffSummary) {
      return null;
    }

    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm animate-fadeIn flex flex-col gap-2 font-sans">
        <div>
          <p className="font-semibold">{t('autoresearch.bootstrap.readyTitle')}</p>
          <p className="mt-1">{readyResult.plan.primaryMetric} · {readyResult.plan.scaffold.workDir}</p>
          <p className="mt-1 text-xs text-emerald-800">{readyResult.plan.successCriteria}</p>
        </div>
        <div className="flex items-center gap-2 border-t border-emerald-200/50 pt-2 flex-wrap">
          <label className="text-xs font-semibold text-emerald-800">Iterations:</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={iterations}
            onChange={(e) => setIterations(parseInt(e.target.value, 10) || 1)}
            className="w-16 rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={() => handleReadyResult(readyResult, iterations)}
            className="ml-auto rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-bold transition-all shadow-sm flex items-center gap-1 font-sans"
          >
            <span>🚀</span> Start AutoResearch
          </button>
        </div>
      </div>
    );
  }, [readyResult, iterations, handoffSummary, handleReadyResult]);

  return (
    <div className={`min-h-0 flex-1 gap-4 p-4 w-full max-w-7xl mx-auto flex flex-col ${hasStarted ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_280px]' : ''}`}>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm w-full">
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500 font-sans">{t('autoresearch.bootstrap.kicker')}</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900 font-sans">{t('autoresearch.bootstrap.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 font-sans">
            {t('autoresearch.bootstrap.description')}
          </p>
        </div>

        <div className="min-h-0 flex-1 flex flex-col bg-gray-50 px-5 py-5 overflow-y-auto w-full">
          {!hasStarted ? (
            <div className="space-y-6 flex-1 flex flex-col w-full">
              <RecipeTemplateChooser
                selectedTemplateId={selectedTemplateId}
                templatesExpanded={templatesExpanded}
                setTemplatesExpanded={setTemplatesExpanded}
                onSelectTemplate={handleQuickStart}
              />

              <div className="space-y-2 flex-1 flex flex-col min-h-0 w-full">
                <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-gray-400 font-sans">
                  {t('autoresearch.recipe.title') || '配置研究配方'}
                </h3>
                <BootstrapRecipeBuilder
                  recipe={recipe}
                  onChange={handleRecipeChange}
                  onSend={handleStartBootstrap}
                  sshConfig={sshConfig}
                  disabled={isStreaming}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-4 min-h-0 animate-fadeIn">
              {/* Status information */}
              {summaryCard}
              {handoffSummary && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm font-sans">
                  {t('autoresearch.bootstrap.started')}: {handoffSummary}
                </div>
              )}
              {error && (
                <div
                  className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm font-sans"
                  data-testid="bootstrap-error-panel"
                >
                  <p>{error}</p>
                  {(missingFinalize || error.includes(BOOTSTRAP_MISSING_FINALIZE_MESSAGE)) && !isStreaming && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="retry-bootstrap"
                        onClick={handleRetryBootstrap}
                        className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-bold transition-all shadow-sm"
                      >
                        Retry bootstrap
                      </button>
                      <button
                        type="button"
                        data-testid="back-to-recipe-from-error"
                        onClick={() => {
                          setHasStarted(false);
                          setError(null);
                          setMissingFinalize(false);
                          setStoppedByUser(false);
                        }}
                        className="rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-800 px-3 py-1.5 text-xs font-bold transition-all"
                      >
                        Back to Recipe
                      </button>
                    </div>
                  )}
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
                    <AutoResearchSetupPhaseChip
                      input={setupPhaseInput}
                      className="ml-1 border-neutral-700 bg-neutral-800/80 text-neutral-300"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {isStreaming ? (
                      <>
                        <button
                          type="button"
                          onClick={handleStopBootstrap}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-red-700 bg-red-900/40 hover:bg-red-800/60 hover:text-white transition-all text-red-200 font-sans"
                        >
                          Stop bootstrap
                        </button>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] text-neutral-400">Bootstrap in progress...</span>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setHasStarted(false);
                            setError(null);
                            setStoppedByUser(false);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 hover:text-white transition-all text-neutral-300 font-sans"
                        >
                          ← Back to Recipe
                        </button>
                        {stoppedByUser ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            <span className="text-[10px] text-amber-400 font-bold">Stopped</span>
                          </>
                        ) : error ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                            <span className="text-[10px] text-red-400 font-bold">Failed</span>
                          </>
                        ) : readyResult?.status === 'ready' ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span className="text-[10px] text-emerald-400 font-bold">Finished</span>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            <span className="text-[10px] text-amber-400 font-bold">Incomplete</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1.5 selection:bg-neutral-800 min-w-0 max-w-full" ref={consoleScrollRef}>
                  <pre className="whitespace-pre-wrap leading-relaxed break-all overflow-x-auto max-w-full">{agentLogs || 'Initializing bootstrap process...'}</pre>
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

      {hasStarted && (
        <div className="flex flex-col gap-4 overflow-y-auto min-w-0 max-w-full">
          <BootstrapProgressRail
            currentStep={currentStep}
            failedStep={failedStep}
            failureReason={failureReason}
            warnings={warnings}
            onRetry={() => {
              if (lastCompiledPromptRef.current) {
                void handleStartBootstrap(lastCompiledPromptRef.current);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

export default BootstrapChatView;
