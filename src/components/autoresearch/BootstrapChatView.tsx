import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import {
  ConversationalTemplateOption,
} from '@/services/autoresearch/bootstrap/conversationalTemplates';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';
import { useAutoResearchLifecycleLock } from '@/services/autoresearch/runLock';
import { getAutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';
import type { SshConfig } from '@/store/autoresearchStore';
import { useAutoResearchStore, getSelectedAutoResearchRunContext } from '@/store/autoresearchStore';
import { BootstrapProgressRail } from './BootstrapProgressRail';
import { AutoResearchRunProgressRail } from './AutoResearchRunProgressRail';
import { useSettingsStore } from '@/store';
import { BootstrapRecipeBuilder } from './BootstrapRecipeBuilder';
import { RecipeTemplateChooser } from './recipe/RecipeTemplateChooser';
import { type Recipe } from './bootstrapRecipePrompt';
import {
  BOOTSTRAP_MISSING_FINALIZE_MESSAGE,
  createDefaultRecipe,
  resolveBootstrapMetricDirection,
} from './bootstrapChatHelpers';
import {
  clearPersistedBootstrapSession,
  loadPersistedBootstrapSession,
  persistBootstrapSession,
} from '@/services/autoresearch/bootstrap/bootstrapSessionPersist';
import { performBootstrapHandoff } from './bootstrapChatHandoff';
import {
  applyQuickStartTemplateToRecipe,
  runBootstrapStart,
} from './bootstrapChatStart';
import { BootstrapChatStartedPanels } from './BootstrapChatStartedPanels';

// Re-export pure helpers for existing test / consumer import paths.
export {
  BOOTSTRAP_MISSING_FINALIZE_MESSAGE,
  resolveBootstrapMetricDirection,
} from './bootstrapChatHelpers';

interface BootstrapChatViewProps {
  onReady?: () => void;
  sshConfig?: SshConfig;
}

export function BootstrapChatView({ onReady, sshConfig }: BootstrapChatViewProps) {
  const persistedSession = useMemo(() => loadPersistedBootstrapSession(), []);
  const [recipe, setRecipe] = useState<Recipe>(() => persistedSession?.recipe ?? createDefaultRecipe(sshConfig));
  const [recipeDirty, setRecipeDirty] = useState(() => Boolean(persistedSession?.recipeDirty));
  const [hasStarted, setHasStarted] = useState(() => Boolean(persistedSession?.hasStarted));
  const [agentLogs, setAgentLogs] = useState(() => persistedSession?.agentLogs ?? '');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(() => persistedSession?.error ?? null);
  const [handoffSummary, setHandoffSummary] = useState<string | null>(() => persistedSession?.handoffSummary ?? null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<ConversationalTemplateOption['id'] | null>(
    () => (persistedSession?.selectedTemplateId as ConversationalTemplateOption['id'] | null) ?? null,
  );
  const [templatesExpanded, setTemplatesExpanded] = useState(() => persistedSession?.templatesExpanded ?? true);
  const [iterations, setIterations] = useState(() => persistedSession?.iterations ?? getAutoResearchDefaultConfig().iterations);
  const bootstrappedAtRef = useRef<string | null>(persistedSession?.handoffSummary ? persistedSession.readyResult?.createdAt ?? null : null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const bootstrapAbortRef = useRef<AbortController | null>(null);

  const [stoppedByUser, setStoppedByUser] = useState(false);
  /** Last compiled prompt — used to offer Retry after missing bootstrap_finalize. */
  const lastCompiledPromptRef = useRef<string | null>(persistedSession?.lastCompiledPrompt ?? null);
  const [missingFinalize, setMissingFinalize] = useState(() => Boolean(persistedSession?.missingFinalize));

  const clearImportedFiles = useSettingsStore((state) => state.clearImportedFiles);

  useEffect(() => {
    clearImportedFiles();
  }, [clearImportedFiles]);

  const currentStep = useBootstrapPlanStore((state) => state.currentStep);
  const warnings = useBootstrapPlanStore((state) => state.warnings);
  const readyResult = useBootstrapPlanStore((state) => state.readyResult);
  const storeLoopState = useAutoResearchStore((state) => state.loopState);
  // AUDIT-FIX [R5-07]: reactive lock so Start stays disabled while another run is live.
  const lifecycleLock = useAutoResearchLifecycleLock();
  const storeCurrentIteration = useAutoResearchStore((state) => state.currentIteration);
  const storeMaxIterations = useAutoResearchStore((state) => state.maxIterations);
  const selectedRunContext = useAutoResearchStore(getSelectedAutoResearchRunContext);
  const storeCurrentPhase = selectedRunContext.run?.currentPhase ?? 'PREFLIGHT';
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const importedFiles = useSettingsStore((state) => state.importedFiles);
  const noteTool = useBootstrapPlanStore((state) => state.noteTool);
  const markMetricsStep = useBootstrapPlanStore((state) => state.markMetricsStep);
  const setWarnings = useBootstrapPlanStore((state) => state.setWarnings);
  const setReadyResult = useBootstrapPlanStore((state) => state.setReadyResult);
  const setCurrentStep = useCallback((step: typeof currentStep) => {
    useBootstrapPlanStore.setState({ currentStep: step });
  }, []);

  useEffect(() => {
    if (!persistedSession || !persistedSession.hasStarted) {
      return;
    }
    const store = useBootstrapPlanStore.getState();
    if (persistedSession.readyResult?.status === 'ready' && !store.readyResult) {
      setReadyResult(persistedSession.readyResult);
    }
    if (persistedSession.warnings.length > 0) {
      setWarnings(persistedSession.warnings);
    }
    if (persistedSession.currentStep && persistedSession.currentStep !== 'goal') {
      setCurrentStep(persistedSession.currentStep);
    }
    if (persistedSession.observedTools.length > 0) {
      useBootstrapPlanStore.setState({ observedTools: persistedSession.observedTools });
    }
  }, [persistedSession, setCurrentStep, setReadyResult, setWarnings]);

  useEffect(() => {
    if (!hasStarted) {
      persistBootstrapSession({
        version: 1,
        recipe,
        recipeDirty,
        selectedTemplateId,
        templatesExpanded,
        hasStarted: false,
        readyResult: null,
        currentStep: 'goal',
        observedTools: [],
        warnings: [],
        iterations,
        agentLogs: '',
        handoffSummary: null,
        lastCompiledPrompt: null,
        missingFinalize: false,
        error: null,
      });
      return;
    }
    persistBootstrapSession({
      version: 1,
      recipe,
      recipeDirty,
      selectedTemplateId,
      templatesExpanded,
      hasStarted,
      readyResult,
      currentStep,
      observedTools: useBootstrapPlanStore.getState().observedTools,
      warnings,
      iterations,
      agentLogs,
      handoffSummary,
      lastCompiledPrompt: lastCompiledPromptRef.current,
      missingFinalize,
      error,
    });
  }, [
    agentLogs,
    currentStep,
    error,
    handoffSummary,
    hasStarted,
    iterations,
    missingFinalize,
    readyResult,
    recipe,
    recipeDirty,
    selectedTemplateId,
    templatesExpanded,
    warnings,
  ]);

  // Sync workspace root if sshConfig changes
  useEffect(() => {
    if (sshConfig?.mode === 'ssh' && sshConfig.remoteWorkDir) {
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
    await performBootstrapHandoff(result, runIterations, {
      setError,
      setHandoffSummary,
      bootstrappedAtRef,
      sshConfig,
      recipeDirection: recipe.baselineAndMetric.direction,
      windowsShellProfile,
      onReady,
    });
  }, [onReady, recipe.baselineAndMetric.direction, sshConfig, windowsShellProfile]);

  const handleStopBootstrap = useCallback(() => {
    bootstrapAbortRef.current?.abort();
    setStoppedByUser(true);
    setIsStreaming(false);
    setAgentLogs((prev) => prev + '\n[SYSTEM] Bootstrap stopped by user.\n');
  }, []);

  const handleResetToRecipe = useCallback(() => {
    useBootstrapPlanStore.getState().reset();
    setReadyResult(null);
    setHasStarted(false);
    setError(null);
    setMissingFinalize(false);
    setStoppedByUser(false);
    setHandoffSummary(null);
    bootstrappedAtRef.current = null;
    setAgentLogs('');
    clearPersistedBootstrapSession();
  }, [setReadyResult]);

  const handleStartBootstrap = useCallback(async (compiledPrompt: string) => {
    await runBootstrapStart(compiledPrompt, {
      isStreaming,
      recipe,
      sshConfig,
      importedFiles,
      setReadyResult,
      lastCompiledPromptRef,
      setError,
      setMissingFinalize,
      setStoppedByUser,
      setHandoffSummary,
      bootstrappedAtRef,
      setHasStarted,
      setIsStreaming,
      setAgentLogs,
      bootstrapAbortRef,
      noteTool,
      setWarnings,
      markMetricsStep,
    });
  }, [importedFiles, isStreaming, markMetricsStep, noteTool, recipe, setReadyResult, setWarnings, sshConfig]);

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
    useBootstrapPlanStore.getState().reset();
    setReadyResult(null);
    setHandoffSummary(null);
    bootstrappedAtRef.current = null;
    setError(null);
    setMissingFinalize(false);
    setStoppedByUser(false);

    setRecipe((prev) => applyQuickStartTemplateToRecipe(prev, templateId));
    setRecipeDirty(false);
  }, [recipeDirty, setReadyResult]);

  const handleRecipeChange = useCallback((newRecipe: Recipe) => {
    setRecipe(newRecipe);
    setRecipeDirty(true);
  }, []);

  const setupPhaseInput = useMemo(() => ({
    bootstrapKind: 'conversational' as const,
    bootstrapStreaming: isStreaming,
    bootstrapReady: readyResult?.status === 'ready',
    startingRun: false,
    error,
  }), [isStreaming, readyResult, error]);

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
            <BootstrapChatStartedPanels
              readyResult={readyResult}
              handoffSummary={handoffSummary}
              sshConfig={sshConfig}
              iterations={iterations}
              onChangeIterations={setIterations}
              lifecycleLock={lifecycleLock}
              onStartHandoff={handleReadyResult}
              onBackToRecipe={handleResetToRecipe}
              error={error}
              missingFinalize={missingFinalize}
              isStreaming={isStreaming}
              onRetryBootstrap={handleRetryBootstrap}
              stoppedByUser={stoppedByUser}
              agentLogs={agentLogs}
              consoleScrollRef={consoleScrollRef}
              setupPhaseInput={setupPhaseInput}
              onStopBootstrap={handleStopBootstrap}
            />
          )}
        </div>
      </div>

      {hasStarted && (
        <div className="flex flex-col gap-4 overflow-y-auto min-w-0">
          {storeLoopState === 'running' || storeLoopState === 'paused' ? (
            <AutoResearchRunProgressRail
              currentIteration={storeCurrentIteration}
              maxIterations={storeMaxIterations}
              phase={storeCurrentPhase}
              loopState={storeLoopState}
            />
          ) : (
            <BootstrapProgressRail currentStep={currentStep} warnings={warnings} />
          )}
        </div>
      )}
    </div>
  );
}

export default BootstrapChatView;
