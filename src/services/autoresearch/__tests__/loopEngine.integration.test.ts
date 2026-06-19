import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ResolvedAgentConfig } from '@/services/agentConfig';

const mockInvoke = jest.fn();
const mockLogExperiment = jest.fn().mockResolvedValue(undefined);
const mockRunHeadlessAgentTurn = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();
const mockGetAgentConfigDiagnostics = jest.fn();
const mockRequestReflectionDecision = jest.fn();
const mockGetDeterministicRecoveryDecision = jest.fn();
const mockBuildFallbackReflectionDecision = jest.fn();
const mockResolveTargetPath = jest.fn();
const mockInspectAutoResearchEnvironment = jest.fn();
const mockNotifier = {
  onExperimentComplete: jest.fn().mockResolvedValue(undefined),
  onLoopStopped: jest.fn().mockResolvedValue(undefined),
  onTrendReport: jest.fn().mockResolvedValue(undefined),
};

let eventListener: any;
jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn().mockImplementation(async (eventName, handler) => {
    if (eventName === 'terminal-output') {
      eventListener = handler;
    }
    return () => {
      if (eventListener === handler) {
        eventListener = undefined;
      }
    };
  }),
}));

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('../expLogger', () => ({
  logExperiment: (...args: unknown[]) => mockLogExperiment(...args),
}));

jest.mock('../notifier', () => ({
  createNotifier: () => mockNotifier,
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
  validateResolvedAgentConfig: (...args: unknown[]) => mockValidateResolvedAgentConfig(...args),
  formatAgentConfigValidationError: (...args: unknown[]) => mockFormatAgentConfigValidationError(...args),
  getAgentConfigDiagnostics: (...args: unknown[]) => mockGetAgentConfigDiagnostics(...args),
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

jest.mock('../reflection', () => {
  const actual = jest.requireActual('../reflection') as typeof import('../reflection');
  return {
    ...actual,
    requestReflectionDecision: (...args: unknown[]) => mockRequestReflectionDecision(...args),
    getDeterministicRecoveryDecision: (...args: unknown[]) => mockGetDeterministicRecoveryDecision(...args),
    buildFallbackReflectionDecision: (...args: unknown[]) => mockBuildFallbackReflectionDecision(...args),
  };
});

jest.mock('../preflight', () => ({
  resolveTargetPath: (...args: unknown[]) => mockResolveTargetPath(...args),
  inspectAutoResearchEnvironment: (...args: unknown[]) => mockInspectAutoResearchEnvironment(...args),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { getAutoResearchTestTmpDir } from './tmpRoot';
import { createAutoResearchSendMessage } from '../chatAdapter';
import { startExperimentLoop } from '../loopEngine';
import { getCurrentRunDir } from '../terminalRunner';
import { getSessionRunPaths, listIterations, readTargetText } from '../runDir';
import { AutoResearchReflectionFailureError } from '../reflection';
import { formatAutoResearchToolCatalog } from '../toolCatalog';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import {
  deepseekBudgetExhaustedAfterMetricsFixture,
  deepseekMixedFailureTranscriptFixture,
  deepseekThreeConsecutiveApiFailuresFixture,
} from './fixtures/deepseekMixedFailureTranscript.fixture';
import { installDynamicTranscriptFixture } from './transcriptHarness';

const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';

const PROJECT_TMP_DIR = getAutoResearchTestTmpDir();

function projectTmpDir(): string {
  return PROJECT_TMP_DIR;
}

const activeConfig: ResolvedAgentConfig = {
  configId: 'cfg-deepseek',
  name: 'DeepSeek Default',
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  apiFormat: 'openai',
  hasApiKey: true,
  hasBaseUrl: true,
  apiKey: 'test-key',
};

function buildChatAdapterSendMessage(experimentDir: string) {
  return createAutoResearchSendMessage(experimentDir, activeConfig, {
    environmentSummary: {
      experimentDir,
      gitRepo: true,
      repoStatus: 'clean',
      dirtyFileCount: 0,
      preferredPythonCommand: 'python3',
      worktreeWritable: true,
      runScriptPath: path.join(experimentDir, 'run_experiment.py'),
      notesPath: path.join(experimentDir, 'AUTORESEARCH.md'),
      recommendedRunCommand: 'python3 run_experiment.py',
    },
    metricName: 'cv_accuracy',
    direction: 'higher',
    maxIterations: 1,
  });
}

jest.setTimeout(30000);

describe('loopEngine integration', () => {
  let workDir: string;
  let sessionFilePath: string;
  let unsubStore: () => void;
  const extraCleanupDirs = new Set<string>();

  beforeEach(async () => {
    await fs.mkdir(projectTmpDir(), { recursive: true });
    workDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-loop-'));
    sessionFilePath = path.join(workDir, 'session.md');
    installLocalInvokeMock(mockInvoke);
    mockRunHeadlessAgentTurn.mockReset();
    mockResolveActiveAgentConfig.mockReset();
    mockValidateResolvedAgentConfig.mockReset();
    mockFormatAgentConfigValidationError.mockReset();
    mockGetAgentConfigDiagnostics.mockReset();
    mockRequestReflectionDecision.mockReset();
    mockGetDeterministicRecoveryDecision.mockReset();
    mockBuildFallbackReflectionDecision.mockReset();
    mockResolveTargetPath.mockReset();
    mockInspectAutoResearchEnvironment.mockReset();
    mockResolveActiveAgentConfig.mockReturnValue(activeConfig);
    mockValidateResolvedAgentConfig.mockReturnValue([]);
    mockFormatAgentConfigValidationError.mockReturnValue('invalid config');
    mockGetAgentConfigDiagnostics.mockReturnValue({
      selectedConfigName: 'DeepSeek Default',
      selectedProvider: 'deepseek',
      selectedModel: 'deepseek-chat',
      hasApiKey: true,
      hasBaseURL: true,
      adapterName: 'deepseek-openai',
      authorizationHeaderPresent: true,
    });
    mockGetDeterministicRecoveryDecision.mockReturnValue(null);
    mockBuildFallbackReflectionDecision.mockImplementation((_input: unknown, error: unknown) => ({
      action: 'stop_tool_exhausted',
      summary: error instanceof Error ? error.message : 'fallback stop',
      userMessage: error instanceof Error ? error.message : 'fallback stop',
      shouldRetry: false,
      confidence: 'medium',
    }));
    mockResolveTargetPath.mockImplementation(async (_cfg: unknown, _fieldName: string, value: string) => {
      const os = require('node:os');
      const path = require('node:path');
      const trimmed = String(value).trim();
      if (trimmed === '~') {
        return os.homedir();
      }
      if (trimmed.startsWith('~/')) {
        return path.join(os.homedir(), trimmed.slice(2));
      }
      return trimmed;
    });
    mockInspectAutoResearchEnvironment.mockImplementation(async (_cfg: unknown, experimentDir: string) => ({
      experimentDir,
      gitRepo: true,
      repoStatus: 'clean',
      dirtyFileCount: 0,
      preferredPythonCommand: 'python3',
      worktreeWritable: true,
      runScriptPath: `${experimentDir}/run_experiment.py`,
      notesPath: `${experimentDir}/AUTORESEARCH.md`,
      recommendedRunCommand: 'python3 run_experiment.py',
    }));
    await initGitRepo(workDir, {
      'train.py': 'print("train")\n',
      'session.md': '# Objective\nImprove validation loss.\n',
    });
    await fs.writeFile(sessionFilePath, '# Objective\nImprove validation loss.\n', 'utf8');
    useAutoResearchStore.getState().resetSession();
    unsubStore = useAutoResearchStore.subscribe((state) => {
      if (state.terminalSessionId && !state.terminalReady) {
        Promise.resolve().then(() => {
          useAutoResearchStore.getState().setTerminalReady(true);
        });
      }
    });

    const originalImplementation = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'terminal_input') {
        const data = String(args.data ?? '');
        const tokenMatch = data.match(/__PIPI_AUTORESEARCH_EXIT__:(.+?):%s/);
        if (tokenMatch?.[1]) {
          const token = tokenMatch[1];
          Promise.resolve().then(() => {
            if (eventListener) {
              eventListener({
                payload: {
                  session_id: String(args.sessionId ?? ''),
                  data: `__PIPI_AUTORESEARCH_EXIT__:${token}:0\n`,
                },
              });
            }
          });
        }
        return;
      }
      return originalImplementation ? originalImplementation(command, args) : undefined;
    });
  });

  afterEach(async () => {
    mockInvoke.mockReset();
    mockLogExperiment.mockClear();
    mockNotifier.onExperimentComplete.mockClear();
    mockNotifier.onLoopStopped.mockClear();
    mockNotifier.onTrendReport.mockClear();
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort: never let cleanup mask the actual test failure.
    }
    try {
      await Promise.all(
        [...extraCleanupDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })),
      );
    } catch {
      // Same as above.
    }
    extraCleanupDirs.clear();
    unsubStore?.();
    useAutoResearchStore.getState().resetSession();
  });

  afterAll(async () => {
    try {
      await fs.rm(PROJECT_TMP_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort sweep; failures here are non-fatal.
    }
  });

  it('records iterations, rebuilds autoresearch.md, and stops after three consecutive failures', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-integration',
      maxIterations: 10,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sequence: Array<{
      status: 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED';
      metricValue: number | null;
      hypothesis: string;
      failReason?: string;
    }> = [
      { status: 'IMPROVED', metricValue: 0.9, hypothesis: 'lower learning rate' },
      { status: 'NOT_IMPROVED', metricValue: 1.0, hypothesis: 'bigger batch size' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup', failReason: 'NaN' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup more', failReason: 'timeout' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup again', failReason: 'OOM' },
    ];

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }
      const next = sequence[runDir.iter - 1];
      await fs.writeFile(runDir.hypothesisPath, `${next.hypothesis}\n`, 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'val_loss',
          metricValue: next.metricValue,
          status: next.status,
          hypothesis: next.hypothesis,
          failReason: next.failReason,
        }, null, 2),
        'utf8',
      );
      return `EXPERIMENT_RESULT: metric_value=${next.metricValue ?? 'null'} status=${next.status}${next.failReason ? ` fail_reason="${next.failReason}"` : ''} hypothesis="${next.hypothesis}"`;
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    expect(store.experiments).toHaveLength(5);
    expect(store.consecutiveFailures).toBe(3);
    expect(store.loopState).toBe('stopped');

    const sessionPaths = getSessionRunPaths(cfg, 'autoresearch-integration');
    const metricsJsonl = await readTargetText(cfg, sessionPaths.metricsJsonlPath);
    const metricRows = (metricsJsonl || '').trim().split('\n').filter(Boolean);
    expect(metricRows).toHaveLength(5);

    const livingDoc = await readTargetText(cfg, sessionPaths.livingDocPath);
    expect(livingDoc).toContain('## Tried (kept)');
    expect(livingDoc).toContain('- iter-001: lower learning rate - IMPROVED');
    expect(livingDoc).toContain('## Tried (reverted)');

    const [firstRun] = await listIterations(cfg, 'autoresearch-integration');
    const firstSystemPrompt = await readTargetText(cfg, firstRun.systemPromptPath);
    expect(firstSystemPrompt).toContain(`Only permitted experiment tools for this run: ${formatAutoResearchToolCatalog(cfg)}`);
    expect(firstSystemPrompt).toContain('## WORKSPACE CONTRACT');
    expect(firstSystemPrompt).toContain(`Modify run_experiment.py in ${firstRun.iterDir}/code, NOT in the original experiment dir`);
    expect(firstSystemPrompt).toContain(`Run the experiment from ${firstRun.iterDir}/code using `);
    expect(firstSystemPrompt).toContain('Never call ssh_exec, ssh_read_file, or ssh_upload_file in this local run.');
    expect(firstSystemPrompt).toContain('If the metric is missing, the command crashes, or the run times out, still write the JSON object with status FAILED, metricValue null, and a concrete failReason.');

    expect(mockNotifier.onLoopStopped).toHaveBeenCalledWith('3 consecutive failures', expect.any(Object));
  });

  it('resolves ~/ workdir, initializes a missing session file, and logs primitive startup paths', async () => {
    const relativeWorkDir = `.pipi-autoresearch-startup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startupWorkDir = path.join(os.homedir(), relativeWorkDir);
    const startupWorkDirInput = `~/${relativeWorkDir}`;
    extraCleanupDirs.add(startupWorkDir);
    await fs.rm(startupWorkDir, { recursive: true, force: true });

    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-experiment-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'train.py': 'print("train")\n',
      'README.md': '# Demo experiment\n',
    });

    const startupSessionId = 'autoresearch-startup';
    const startupConsoleSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    useAutoResearchStore.getState().initSession({
      id: startupSessionId,
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: createLocalSshConfig(startupWorkDirInput),
      experimentDir,
      sessionFilePath: `${startupWorkDirInput}/session.md`,
      livingDocPath: `${startupWorkDirInput}/runs/${startupSessionId}/autoresearch.md`,
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }
      await fs.writeFile(runDir.hypothesisPath, 'improve accuracy\n', 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: 0.91,
          status: 'IMPROVED',
          hypothesis: 'improve accuracy',
        }, null, 2),
        'utf8',
      );
      return 'EXPERIMENT_RESULT: metric_value=0.91 status=IMPROVED hypothesis="improve accuracy"';
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const expectedSessionFilePath = path.join(startupWorkDir, 'session.md');
    const expectedLivingDocPath = path.join(startupWorkDir, 'runs', startupSessionId, 'autoresearch.md');

    expect(store.errorMessage).toBeUndefined();
    expect(store.currentIteration).toBe(1);
    expect(store.sessionFilePath).toBe(expectedSessionFilePath);
    expect(store.experimentDir).toBe(experimentDir);
    expect(store.livingDocPath).toBe(expectedLivingDocPath);
    await expect(fs.readFile(expectedSessionFilePath, 'utf8')).resolves.toContain('# AutoResearch Session');

    expect(startupConsoleSpy).toHaveBeenCalledWith('[AutoResearch] Startup paths', expect.objectContaining({
      resolvedWorkdir: startupWorkDir,
      experimentDir,
      sessionFilePath: expectedSessionFilePath,
      livingDocPath: expectedLivingDocPath,
      metricName: 'cv_accuracy',
      direction: 'higher',
      iterations: 1,
      typeofSessionFilePath: 'string',
      typeofExperimentDir: 'string',
    }));

    startupConsoleSpy.mockRestore();
  });

  it('backs off and retries the same iteration on provider rate limits', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-rate-limit',
      maxIterations: 1,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    let attempts = 0;
    const sendMessage = jest.fn(async () => {
      attempts += 1;
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      if (attempts === 1) {
        throw new Error('phase=agent_execution; config=MiniMax; provider=minimax; model=MiniMax-M2.7; message=Rate limited. Retry after 0s');
      }

      await fs.writeFile(runDir.hypothesisPath, 'retry with same iteration\n', 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'val_loss',
          metricValue: 0.7,
          status: 'IMPROVED',
          hypothesis: 'retry with same iteration',
        }, null, 2),
        'utf8',
      );
      return 'EXPERIMENT_RESULT: metric_value=0.7 status=IMPROVED hypothesis="retry with same iteration"';
    });

    const loopPromise = startExperimentLoop(sendMessage);
    await loopPromise;

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-rate-limit');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(store.experiments).toHaveLength(1);
    expect(store.currentIteration).toBe(1);
    expect(store.consecutiveFailures).toBe(0);
    expect(store.statusMessage).toBeUndefined();
    expect(store.experiments[0]?.iteration).toBe(1);
    expect(run?.iterations).toHaveLength(1);
    expect(run?.iterations[0]).toEqual(expect.objectContaining({
      index: 1,
      status: 'completed',
    }));
    expect(run?.iterations.some((record) => record.status === 'running')).toBe(false);
  });

  it('carries forward improved code into the next iteration and rolls back not-improved workspaces', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-carry-forward-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
      'model.py': 'BASELINE = "base"\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-carry-forward',
      maxIterations: 2,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const iterationDirs: string[] = [];
    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      iterationDirs[runDir.iter - 1] = runDir.codeDir;
      const modelPath = path.join(runDir.codeDir, 'model.py');
      const currentModel = await fs.readFile(modelPath, 'utf8');

      if (runDir.iter === 1) {
        expect(currentModel).toBe('BASELINE = "base"\n');
        await fs.writeFile(modelPath, 'BASELINE = "iter-001-best"\n', 'utf8');
        await fs.writeFile(runDir.hypothesisPath, 'keep the first change\n', 'utf8');
        await fs.writeFile(
          runDir.metricsPath,
          JSON.stringify({
            metricName: 'cv_accuracy',
            metricValue: 0.81,
            status: 'IMPROVED',
            hypothesis: 'keep the first change',
            change: 'set baseline to iter-001-best',
          }, null, 2),
          'utf8',
        );
        return 'EXPERIMENT_RESULT: metric_value=0.81 status=IMPROVED hypothesis="keep the first change"';
      }

      expect(currentModel).toBe('BASELINE = "iter-001-best"\n');
      await fs.writeFile(modelPath, 'BASELINE = "iter-002-temp"\n', 'utf8');
      await fs.writeFile(runDir.hypothesisPath, 'temporary second change\n', 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: 0.79,
          status: 'NOT_IMPROVED',
          hypothesis: 'temporary second change',
          change: 'set baseline to iter-002-temp',
        }, null, 2),
        'utf8',
      );
      return 'EXPERIMENT_RESULT: metric_value=0.79 status=NOT_IMPROVED hypothesis="temporary second change"';
    });

    await startExperimentLoop(sendMessage);

    await expect(fs.readFile(path.join(experimentDir, 'model.py'), 'utf8')).resolves.toBe('BASELINE = "base"\n');
    await expect(fs.readFile(path.join(iterationDirs[1]!, 'model.py'), 'utf8')).resolves.toBe('BASELINE = "iter-001-best"\n');
    expect(useAutoResearchStore.getState().experiments.map((entry) => entry.status)).toEqual(['IMPROVED', 'NOT_IMPROVED']);
  });

  it('stops after three consecutive provider rate limits and preserves recovery context', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-rate-limit-stop',
      maxIterations: 1,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      throw new Error('phase=agent_execution; config=MiniMax; provider=minimax; model=MiniMax-M2.7; message=Rate limited. Retry after 0s');
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-rate-limit-stop');

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(store.loopState).toBe('stopped');
    expect(store.statusMessage).toBeUndefined();
    expect(run?.status).toBe('failed');
    expect(run?.summary).toContain('Provider rate limited the run 3 times consecutively');
    expect(run?.events.some((event) => event.message.includes('Provider rate limited the run 3 times consecutively'))).toBe(true);
  });

  it('completes two local cv_accuracy iterations and records iter-002 metrics', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-cv-accuracy-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-cv-accuracy',
      maxIterations: 2,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const metrics = [0.9633, 0.9684];
    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      const metricValue = metrics[runDir.iter - 1];
      const hypothesis = `improve cv_accuracy iteration ${runDir.iter}`;
      await fs.writeFile(runDir.hypothesisPath, `${hypothesis}\n`, 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue,
          status: 'IMPROVED',
          hypothesis,
        }, null, 2),
        'utf8',
      );

      return `EXPERIMENT_RESULT: metric_value=${metricValue} status=IMPROVED hypothesis="${hypothesis}"`;
    });

    await startExperimentLoop(sendMessage);

    const runs = await listIterations(cfg, 'autoresearch-cv-accuracy');
    expect(runs).toHaveLength(2);

    const secondRun = runs[1];
    const hypothesis = await readTargetText(cfg, secondRun.hypothesisPath);
    const metricsJson = await readTargetText(cfg, secondRun.metricsPath);
    expect(hypothesis?.trim().length).toBeGreaterThan(0);
    expect(metricsJson).toContain('"metricName": "cv_accuracy"');
    expect(metricsJson).toContain('"metricValue": 0.9684');
  });

  it('replays the mixed DeepSeek failure transcript through chatAdapter and loopEngine end-to-end', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-chat-adapter-e2e-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-chat-adapter-mixed-fixture',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'retry_with_plan',
      summary: 'Use execute_command for directory inspection.',
      nextPlan: 'Use execute_command with ls -la instead of list_files.',
      shouldRetry: true,
      confidence: 'high',
    });
    const { getMaterializedFixture } = installDynamicTranscriptFixture({
      target: mockRunHeadlessAgentTurn,
      fixture: deepseekMixedFailureTranscriptFixture,
      getRunDir: () => getCurrentRunDir(),
      options: {
        onWriteFile: async ({ path: targetPath, content }) => {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
        },
      },
    });

    const sendMessage = buildChatAdapterSendMessage(experimentDir);

    await startExperimentLoop(sendMessage);

    const resolvedFixture = getMaterializedFixture();
    const runs = await listIterations(cfg, 'autoresearch-chat-adapter-mixed-fixture');
    expect(runs).toHaveLength(1);
    const [firstRun] = runs;
    const metricsJson = await readTargetText(cfg, firstRun.metricsPath);
    const transcript = await readTargetText(cfg, firstRun.transcriptPath);
    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-chat-adapter-mixed-fixture');
    const thirdCallInput = mockRunHeadlessAgentTurn.mock.calls[2]?.[0] as {
      workDir: string;
      allowedTools: string[];
      systemPrompt: string;
      initialMessages: Array<{ role: string; content: string }>;
    };

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(3);
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(resolvedFixture?.runDir.metricsPath).toBe(firstRun.metricsPath);
    expect(thirdCallInput.workDir).toBe(firstRun.iterDir);
    expect(thirdCallInput.allowedTools).toContain('execute_command');
    expect(thirdCallInput.allowedTools).not.toContain('list_files');
    expect(thirdCallInput.systemPrompt).toContain('HARD CONSTRAINT: do not call list_files.');
    expect(thirdCallInput.systemPrompt).toContain(firstRun.metricsPath);
    expect(thirdCallInput.initialMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(deepseekMixedFailureTranscriptFixture.expected.recoveryHint),
      }),
    ]));
    expect(metricsJson).toContain('"metricName": "cv_accuracy"');
    expect(metricsJson).toContain('"status": "FAILED"');
    expect(metricsJson).toContain('"failReason": "list_files disabled for this AutoResearch run"');
    expect(transcript).toContain('## Tool Call: list_files');
    expect(transcript).toContain('## Tool Call: write_file');
    expect(transcript).toContain('## Reflection Decision');
    expect(run?.iterations[0]?.status).toBe('failed');
    expect(run?.events.some((event) => event.message.includes('API request failed (1/3)'))).toBe(true);
    expect(run?.events.some((event) => event.message.includes('Escalated disabled tool constraint: list_files'))).toBe(true);
  });

  it('keeps using metrics.json after budget exhaustion when the transcript already wrote the artifact', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-budget-metrics-fixture-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-budget-metrics-fixture',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    mockGetDeterministicRecoveryDecision.mockImplementation((input: { lastError?: string }) => (
      input.lastError?.includes('Exceeded maximum tool rounds')
        ? {
          action: 'stop_tool_exhausted',
          summary: 'Tool budget exhausted after metrics were already written.',
          userMessage: 'Tool budget exhausted after metrics were already written.',
          shouldRetry: false,
          confidence: 'high',
        }
        : null
    ));
    const { getMaterializedFixture } = installDynamicTranscriptFixture({
      target: mockRunHeadlessAgentTurn,
      fixture: deepseekBudgetExhaustedAfterMetricsFixture,
      getRunDir: () => getCurrentRunDir(),
      options: {
        onWriteFile: async ({ path: targetPath, content }) => {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
        },
      },
    });

    const sendMessage = buildChatAdapterSendMessage(experimentDir);

    await startExperimentLoop(sendMessage);

    const resolvedFixture = getMaterializedFixture();
    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-budget-metrics-fixture');
    const runs = await listIterations(cfg, 'autoresearch-budget-metrics-fixture');
    expect(runs).toHaveLength(1);
    const [firstRun] = runs;
    const metricsJson = await readTargetText(cfg, firstRun.metricsPath);
    const transcript = await readTargetText(cfg, firstRun.transcriptPath);

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(resolvedFixture?.runDir.metricsPath).toBe(firstRun.metricsPath);
    expect(store.experiments[0]?.status).toBe('IMPROVED');
    expect(store.experiments[0]?.metricValue).toBe(0.9777);
    expect(run?.status).toBe('completed');
    expect(run?.status).not.toBe('reflection_failed');
    expect(metricsJson).toContain('"metricValue": 0.9777');
    expect(transcript).toContain('## Tool Call: write_file');
    expect(run?.events.some((event) => event.message.includes('evaluation_fallback_from_metrics'))).toBe(true);
  });

  it('marks the iteration as FAILED after three consecutive provider API request failures', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-api-failures-fixture-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-api-failures-fixture',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    installDynamicTranscriptFixture({
      target: mockRunHeadlessAgentTurn,
      fixture: deepseekThreeConsecutiveApiFailuresFixture,
      getRunDir: () => getCurrentRunDir(),
    });

    const sendMessage = buildChatAdapterSendMessage(experimentDir);

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-api-failures-fixture');
    const runs = await listIterations(cfg, 'autoresearch-api-failures-fixture');
    expect(runs).toHaveLength(1);
    const [firstRun] = runs;
    const metricsJson = await readTargetText(cfg, firstRun.metricsPath);
    const transcript = await readTargetText(cfg, firstRun.transcriptPath);

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(3);
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(metricsJson).toBeNull();
    expect(transcript).toContain('## User Message');
    expect(store.experiments[0]?.status).toBe('FAILED');
    expect(store.experiments[0]?.failReason).toContain('Provider API request failed 3 times consecutively');
    expect(run?.status).toBe('failed');
    expect(run?.status).not.toBe('reflection_failed');
    expect(run?.events.some((event) => event.message.includes('API request failed (3/3)'))).toBe(true);
  });

  it('stores structured iteration facts from metrics.json into the run record', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-structured-facts-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-structured-facts',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath: sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      const reportPath = path.join(runDir.iterDir, 'analysis.md');
      await fs.writeFile(runDir.hypothesisPath, 'introduce cached preprocessing\n', 'utf8');
      await fs.writeFile(reportPath, '# Analysis\n', 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: 0.9721,
          status: 'IMPROVED',
          hypothesis: 'introduce cached preprocessing',
          change: 'Cache fold-local transformed batches',
          reasoning: 'The profile showed repeated preprocessing dominating each fold, so caching should cut redundant work.',
          artifactPaths: [reportPath],
        }, null, 2),
        'utf8',
      );

      return 'EXPERIMENT_RESULT: metric_value=0.9721 status=IMPROVED hypothesis="introduce cached preprocessing"';
    });

    await startExperimentLoop(sendMessage);

    const run = useAutoResearchStore.getState().runHistory.find((entry) => entry.id === 'autoresearch-structured-facts');
    expect(run?.iterations[0]?.change).toBe('Cache fold-local transformed batches');
    expect(run?.iterations[0]?.reasoning).toContain('repeated preprocessing');
    expect(run?.iterations[0]?.artifactPaths).toEqual(expect.arrayContaining([expect.stringContaining('analysis.md')]));
  });

  it('parses plain JSON agent output when metrics.json is missing', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-agent-json',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => JSON.stringify({
      metricName: 'cv_accuracy',
      metricValue: 0.9732,
      status: 'IMPROVED',
      hypothesis: 'cache folds before training',
      change: 'Cache per-fold datasets before each run',
      reasoning: 'This removes repeated preprocessing work across folds.',
      artifactPaths: ['analysis.md'],
    }));

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-agent-json');
    expect(store.experiments[0]?.status).toBe('IMPROVED');
    expect(store.experiments[0]?.metricValue).toBe(0.9732);
    expect(run?.iterations[0]?.change).toBe('Cache per-fold datasets before each run');
    expect(run?.iterations[0]?.reasoning).toContain('repeated preprocessing');
  });

  it('parses fenced JSON agent output with quoted fields when metrics.json is missing', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-fenced-json',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const payload = {
      metricName: 'cv_accuracy',
      metricValue: 0.9755,
      status: 'IMPROVED' as const,
      hypothesis: 'tune the "dropout" schedule',
      change: 'Set "dropout" to 0.2 and keep "warmup" short',
      reasoning: 'The "variance" spike suggested over-regularization, so a smaller dropout should help.',
    };
    const fencedPayload = ['Final result:', '', '```json', JSON.stringify(payload, null, 2), '```'].join('\n');
    const sendMessage = jest.fn(async () => fencedPayload);

    await startExperimentLoop(sendMessage);

    const run = useAutoResearchStore.getState().runHistory.find((entry) => entry.id === 'autoresearch-fenced-json');
    expect(run?.iterations[0]?.hypothesis).toBe('tune the "dropout" schedule');
    expect(run?.iterations[0]?.change).toBe('Set "dropout" to 0.2 and keep "warmup" short');
    expect(run?.iterations[0]?.reasoning).toContain('"variance" spike');
  });

  it('records an explicit parse error when structured output uses an invalid status', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-invalid-status',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => JSON.stringify({
      metricName: 'cv_accuracy',
      metricValue: 0.9701,
      status: 'BROKEN',
      hypothesis: 'invalid status should fail loudly',
    }));

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    expect(store.experiments[0]?.status).toBe('FAILED');
    expect(store.experiments[0]?.failReason).toContain('Invalid structured result status "BROKEN"');
  });

  it('keeps EXPERIMENT_RESULT as a deprecated fallback and emits a warning event', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-legacy-fallback',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => (
      'EXPERIMENT_RESULT: metric_value=0.9711 status=IMPROVED hypothesis="legacy fallback path"'
    ));

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-legacy-fallback');
    expect(store.experiments[0]?.metricValue).toBe(0.9711);
    expect(run?.events.some((event) => event.message.includes('deprecated EXPERIMENT_RESULT fallback'))).toBe(true);
  });

  it('completes an iteration from metrics.json after tool budget exhaustion without entering reflection_failed', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-budget-metrics-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("baseline")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-budget-metrics',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: 0.9777,
          status: 'IMPROVED',
          hypothesis: 'budget exhausted after metrics were already written',
          change: 'keep the written metrics artifact',
          reasoning: 'The host should trust metrics.json first after budget exhaustion.',
        }, null, 2),
        'utf8',
      );

      return `${TOOL_BUDGET_EXHAUSTED_MARKER}\n${JSON.stringify({
        metricName: 'cv_accuracy',
        metricValue: null,
        status: 'FAILED',
        hypothesis: 'tool budget exhausted before evaluation completed',
        change: '',
        reasoning: 'synthetic fallback',
        artifactPaths: [],
        failReason: 'tool budget exhausted before evaluation completed',
      }, null, 2)}`;
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-budget-metrics');
    expect(store.experiments[0]?.status).toBe('IMPROVED');
    expect(store.experiments[0]?.metricValue).toBe(0.9777);
    expect(run?.status).not.toBe('reflection_failed');
    expect(run?.events.some((event) => event.message.includes('evaluation_fallback_from_metrics'))).toBe(true);
  });

  it('fails a budget-exhausted iteration, rolls back its workspace, and continues the run', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-budget-continue-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("baseline")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-budget-continue',
      maxIterations: 3,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      if (runDir.iter === 1) {
        await fs.writeFile(
          runDir.metricsPath,
          JSON.stringify({
            metricName: 'cv_accuracy',
            metricValue: 0.963,
            status: 'IMPROVED',
            hypothesis: 'first success',
          }, null, 2),
          'utf8',
        );
        return 'EXPERIMENT_RESULT: metric_value=0.963 status=IMPROVED hypothesis="first success"';
      }

      if (runDir.iter === 2) {
        await fs.writeFile(path.join(runDir.codeDir, 'run_experiment.py'), 'print("budget changed")\n', 'utf8');
        return `${TOOL_BUDGET_EXHAUSTED_MARKER}\n${JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: null,
          status: 'FAILED',
          hypothesis: 'tool budget exhausted before evaluation completed',
          change: '',
          reasoning: 'budget exhausted after the experiment attempt',
          artifactPaths: [],
          failReason: 'tool budget exhausted before evaluation completed',
        }, null, 2)}`;
      }

      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: 0.971,
          status: 'IMPROVED',
          hypothesis: 'final recovery iteration',
        }, null, 2),
        'utf8',
      );
      return 'EXPERIMENT_RESULT: metric_value=0.971 status=IMPROVED hypothesis="final recovery iteration"';
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-budget-continue');
    const runs = await listIterations(cfg, 'autoresearch-budget-continue');
    const rolledBackCode = await readTargetText(cfg, path.join(runs[1].iterDir, 'code', 'run_experiment.py'));

    expect(store.experiments.map((entry) => entry.status)).toEqual(['IMPROVED', 'FAILED', 'IMPROVED']);
    expect(rolledBackCode).toBe('print("baseline")\n');
    expect(run?.status).toBe('completed');
    expect(run?.events.some((event) => event.message.includes('iteration_failed_due_to_budget'))).toBe(true);
    expect(run?.events.some((event) => event.message.includes('rollback_completed'))).toBe(true);
  });

  it('stops after three consecutive budget-exhausted failures', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-budget-threshold-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("baseline")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-budget-threshold',
      maxIterations: 5,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => `${TOOL_BUDGET_EXHAUSTED_MARKER}\n${JSON.stringify({
      metricName: 'cv_accuracy',
      metricValue: null,
      status: 'FAILED',
      hypothesis: 'tool budget exhausted before evaluation completed',
      change: '',
      reasoning: 'budget exhausted repeatedly',
      artifactPaths: [],
      failReason: 'tool budget exhausted before evaluation completed',
    }, null, 2)}`);

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-budget-threshold');
    expect(store.experiments).toHaveLength(3);
    expect(store.consecutiveFailures).toBe(3);
    expect(store.loopState).toBe('stopped');
    expect(run?.status).toBe('failed');
  });

  it('captures diffs from the iteration workspace without mutating the source experiment repo', async () => {
    const worktreeRoot = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-iter-workspace-'));
    extraCleanupDirs.add(worktreeRoot);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-source-experiment-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("original")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    const cfg = createLocalSshConfig(worktreeRoot);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-iter-workspace',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath: path.join(worktreeRoot, 'session.md'),
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      await fs.writeFile(path.join(runDir.codeDir, 'run_experiment.py'), 'print("iteration change")\n', 'utf8');
      await fs.writeFile(runDir.hypothesisPath, 'change only the iteration snapshot\n', 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: null,
          status: 'FAILED',
          hypothesis: 'change only the iteration snapshot',
          failReason: 'expected failure for rollback path',
        }, null, 2),
        'utf8',
      );

      return 'EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="expected failure for rollback path" hypothesis="change only the iteration snapshot"';
    });

    await startExperimentLoop(sendMessage);

    const [firstRun] = await listIterations(cfg, 'autoresearch-iter-workspace');
    const diff = await readTargetText(cfg, firstRun.diffPath);
    const sourceExperiment = await fs.readFile(path.join(experimentDir, 'run_experiment.py'), 'utf8');

    expect(diff).toContain('-print("original")');
    expect(diff).toContain('+print("iteration change")');
    expect(sourceExperiment).toBe('print("original")\n');
  });

  it('refuses to start when the source experiment repo is already dirty', async () => {
    const worktreeRoot = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-dirty-workspace-'));
    extraCleanupDirs.add(worktreeRoot);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-dirty-source-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("baseline")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });
    await fs.writeFile(path.join(experimentDir, 'run_experiment.py'), 'print("dirty local edit")\n', 'utf8');

    const cfg = createLocalSshConfig(worktreeRoot);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-dirty-source',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath: path.join(worktreeRoot, 'session.md'),
    });

    const sendMessage = jest.fn(async () => 'should not run');

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === 'autoresearch-dirty-source');
    const dirtySource = await fs.readFile(path.join(experimentDir, 'run_experiment.py'), 'utf8');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.errorMessage).toContain('AutoResearch will not reset a dirty repository automatically');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.status).not.toBe('running');
    expect(dirtySource).toBe('print("dirty local edit")\n');
  });

  it('marks the run failed when startup path resolution fails after run_started', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-startup-path-failure',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    mockResolveTargetPath.mockRejectedValueOnce(new Error('could not resolve workdir'));
    const sendMessage = jest.fn(async () => 'should not run');

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === 'autoresearch-startup-path-failure');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.errorMessage).toContain('could not resolve workdir');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.status).not.toBe('running');
  });

  it('marks the run failed when environment inspection throws after run_started', async () => {
    const cfg = createLocalSshConfig(workDir);
    const experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-inspect-failure-'));
    extraCleanupDirs.add(experimentDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("run")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-inspect-failure',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    mockInspectAutoResearchEnvironment.mockRejectedValueOnce(new Error('git status failed'));
    const sendMessage = jest.fn(async () => 'should not run');

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === 'autoresearch-inspect-failure');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.errorMessage).toContain('git status failed');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.status).not.toBe('running');
  });

  it('marks the run failed when the session id is not path-safe after run_started', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: '../escape-run',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => 'should not run');

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === '../escape-run');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.errorMessage).toContain('Invalid AutoResearch sessionId');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.status).not.toBe('running');
  });

  it('marks the iteration as FAILED when no metrics artifact or structured output can be parsed', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-missing-metrics',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => 'finished without writing metrics');

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-missing-metrics');
    expect(store.experiments[0]?.status).toBe('FAILED');
    expect(store.experiments[0]?.failReason).toContain('Could not parse metrics.json or structured agent output');
    expect(run?.status).not.toBe('running');
  });

  it('accepts FAILED metrics artifacts with failReason and exits cleanly', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-failed-metrics-artifact',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'cv_accuracy',
          metricValue: null,
          status: 'FAILED',
          hypothesis: 'capture the failure reason',
          failReason: 'evaluation timed out',
        }, null, 2),
        'utf8',
      );

      return JSON.stringify({
        metricName: 'cv_accuracy',
        metricValue: null,
        status: 'FAILED',
        hypothesis: 'capture the failure reason',
        failReason: 'evaluation timed out',
      });
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === 'autoresearch-failed-metrics-artifact');
    expect(store.experiments[0]?.status).toBe('FAILED');
    expect(store.experiments[0]?.failReason).toBe('evaluation timed out');
    expect(run?.status).not.toBe('running');
    expect(run?.events.some((event) => event.phase === 'FAILED')).toBe(true);
  });

  it('marks the run as failed instead of leaving it running after agent execution errors', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-terminal-failure',
      maxIterations: 1,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      throw new Error('Timed out waiting for AutoResearch terminal');
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === 'autoresearch-terminal-failure');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.events.some((event) => event.phase === 'terminal')).toBe(true);
  });

  it('transitions the run to reflection_failed instead of surfacing a fake terminal timeout', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-reflection-failure',
      maxIterations: 1,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sendMessage = jest.fn(async () => {
      throw new AutoResearchReflectionFailureError('Reflection did not provide a summary.', {
        decision: {
          action: 'mark_iteration_failed',
          summary: 'Reflection did not provide a summary.',
          userMessage: 'Reflection did not provide a summary.',
          shouldRetry: false,
          confidence: 'low',
        },
        rawText: 'not json',
        parserPath: null,
        retryCount: 2,
        request: {
          systemPrompt: 'system',
          messages: [{ role: 'user', content: 'reflect' }],
          responseFormat: { type: 'json_object' },
        },
        parseFailedAttempts: [
          {
            retryCount: 0,
            rawText: 'not json',
            preview: 'not json',
          },
        ],
      });
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const failedRun = store.runHistory.find((run) => run.id === 'autoresearch-reflection-failure');
    expect(store.loopState).toBe('error');
    expect(store.reason).toBe('Reflection did not provide a summary.');
    expect(failedRun?.status).toBe('reflection_failed');
    expect(failedRun?.reason).toBe('Reflection did not provide a summary.');
    expect(failedRun?.events.some((event) => event.phase === 'terminal' && event.message.includes('Timed out waiting for AutoResearch terminal'))).toBe(false);
    expect(failedRun?.events.some((event) => event.phase === 'agent_execution' && event.metadata?.failureKind === 'reflection_failed')).toBe(true);
  });
});
