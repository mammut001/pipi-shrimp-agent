import { normalizeSuccessCriteria } from '@/services/goal';
import {
  startAutoResearchRun,
  logAutoResearchSetupFailure,
} from '@/services/autoresearch/setupFlow';
import {
  buildAutoResearchRunLockMessage,
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import { uploadBootstrapScaffoldWithRollback } from '@/services/autoresearch/bootstrap/uploadBootstrapScaffold';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import type { SshConfig } from '@/store/autoresearchStore';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { shouldAutoOpenAutoResearchTerminal } from '@/utils/windowsShellProfile';
import {
  resolveBaselineValue,
  resolveBootstrapMetricDirection,
  resolveBootstrapRemoteWorkDir,
} from './bootstrapChatHelpers';

export interface BootstrapChatHandoffHost {
  setError: (error: string | null) => void;
  setHandoffSummary: (summary: string | null) => void;
  bootstrappedAtRef: { current: string | null };
  sshConfig?: SshConfig;
  recipeDirection?: string;
  windowsShellProfile?: string;
  onReady?: () => void;
}

export async function performBootstrapHandoff(
  result: AutoResearchBootstrapResult,
  runIterations: number,
  host: BootstrapChatHandoffHost,
): Promise<void> {
  const {
    setError,
    setHandoffSummary,
    bootstrappedAtRef,
    sshConfig,
    recipeDirection,
    windowsShellProfile,
    onReady,
  } = host;

  if (result.status !== 'ready') {
    setError(
      (result.unresolvedQuestions || []).filter(Boolean).join(' ')
      || 'Bootstrap plan needs confirmation before starting AutoResearch.',
    );
    return;
  }
  // AUDIT-FIX [R5-07]: Block bootstrap handoff while an AutoResearch loop/run
  // is already active (running/paused/non-idle lock). Prevents two concurrent
  // runs and keeps the Start/handoff UI locked with a clear error message.
  const lifecycleState = useAutoResearchStore.getState();
  const handoffLock = getAutoResearchLifecycleLock(lifecycleState);
  if (handoffLock.locked) {
    setError(buildAutoResearchRunLockMessage('start a new run', handoffLock));
    return;
  }
  if (bootstrappedAtRef.current === result.createdAt) {
    return;
  }
  bootstrappedAtRef.current = result.createdAt;

  const workDir = result.plan.scaffold.workDir;
  const isSshMode = sshConfig && sshConfig.mode === 'ssh';
  const remoteWorkDir = isSshMode
    ? resolveBootstrapRemoteWorkDir(sshConfig, workDir)
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
  // AUDIT-FIX [R5-08]: plan.direction wins; recipe next; guess only if both omit.
  const direction = resolveBootstrapMetricDirection({
    planDirection: result.plan.direction,
    recipeDirection,
    primaryMetric: result.plan.primaryMetric,
  });
  const autoResearchState = useAutoResearchStore.getState();

  try {
    // AUDIT-FIX [R5-06]: SSH scaffold upload tracks newly written paths and
    // rolls them back on Nth-file / bootstrap.json / git-init failure so a
    // partial handoff cannot corrupt remote experiment state.
    if (isSshMode) {
      await uploadBootstrapScaffoldWithRollback({
        sshConfig,
        localWorkDir: workDir,
        remoteWorkDir,
        files: result.plan.scaffold.files,
        bootstrapResultJson: JSON.stringify(result, null, 2),
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
      selection: windowsShellProfile === 'powershell' || windowsShellProfile === 'wsl' ? windowsShellProfile : 'auto',
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
      successCriteria: normalizeSuccessCriteria(result.plan.successCriteria),
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
    bootstrappedAtRef.current = null;
    setError(logAutoResearchSetupFailure('bootstrap-handoff', handoffError, {
      workDir: isSshMode ? remoteWorkDir : workDir,
      metric: result.plan.primaryMetric,
    }));
  }
}
