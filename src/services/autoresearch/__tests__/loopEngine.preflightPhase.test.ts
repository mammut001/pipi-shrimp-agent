/**
 * Tests for `runExperimentLoopPreflight` extracted from
 * `startExperimentLoop` as part of AG-02 PR2a.
 *
 * The preflight is side-effect-heavy (mutates the store, makes IO
 * calls), so the test surface uses `jest.mock` to stub the store
 * and IO modules. The function under test returns a discriminated
 * union; we assert the union shape for every branch.
 *
 * The preflight covers:
 *   1. sshConfig missing          -> { ok: false, kind: 'no_ssh_config' }
 *   2. assertSupportedPlatform    -> { ok: false, kind: 'unsupported_platform' }
 *   3. setRunStatus('running') + emit run_started
 *   4. assertRemoteLinux          -> { ok: false, kind: 'remote_not_linux' }
 *   5. ensureSshpassAvailable (ssh+password only)
 *                                  -> { ok: false, kind: 'sshpass_unavailable' }
 *   6. applyBootstrapIfPresent    -> best-effort, non-fatal
 *   7. prepareLoopStartupContext  -> { ok: false, kind: 'startup_failed' }
 *   8. getSessionRunPaths         -> { ok: false, kind: 'session_paths_failed' }
 *   9. hydrateSessionFromDisk + writeTargetText + rebuildLivingDoc
 *                                  -> { ok: false, kind: 'artifacts_init_failed' }
 *  10. inspectAutoResearchEnvironment + clean-repo check
 *                                  -> { ok: false, kind: 'dirty_repo' }
 *                                  -> { ok: false, kind: 'env_unreachable' }
 *                                  -> { ok: true, ctx } success
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: jest.fn(),
  },
}));

jest.mock('@/utils/remoteExec', () => ({
  ensureSshpassAvailable: jest.fn(async () => ({ ok: true, hint: undefined })),
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn(async () => undefined),
}));

jest.mock('../bootstrap/applyBootstrap', () => ({
  applyBootstrapIfPresent: jest.fn(async () => undefined),
}));

jest.mock('../preflight', () => ({
  prepareLoopStartupContext: jest.fn(),
  inspectAutoResearchEnvironment: jest.fn(),
}));

jest.mock('../runDir', () => ({
  getSessionRunPaths: jest.fn(),
  writeTargetText: jest.fn(async () => undefined),
  executeTargetCommand: jest.fn(),
}));

jest.mock('../livingDoc', () => ({
  rebuildLivingDoc: jest.fn(async () => undefined),
}));

jest.mock('../terminalRunner', () => ({
  clearCurrentRunDir: jest.fn(),
  setCurrentRunDir: jest.fn(),
}));

jest.mock('../runtimeEvents', () => ({
  emitAutoResearchRuntimeEvent: jest.fn(),
  setAutoResearchPhase: jest.fn(),
}));

jest.mock('../notifier', () => ({
  createNotifier: jest.fn(() => ({
    onExperimentComplete: jest.fn(async () => undefined),
    onLoopStopped: jest.fn(async () => undefined),
    onTrendReport: jest.fn(async () => undefined),
  })),
}));

jest.mock('../metricsStore', () => ({
  readAllMetrics: jest.fn(async () => []),
  summarize: jest.fn(() => ({ best: undefined })),
}));

import { useAutoResearchStore } from '@/store/autoresearchStore';
import * as remoteExecModule from '@/utils/remoteExec';
import { assertSupportedPlatform } from '../platformGuard';
import { applyBootstrapIfPresent } from '../bootstrap/applyBootstrap';
import {
  inspectAutoResearchEnvironment,
  prepareLoopStartupContext,
} from '../preflight';
import {
  getSessionRunPaths,
  writeTargetText,
  executeTargetCommand,
} from '../runDir';
import { rebuildLivingDoc } from '../livingDoc';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from '../runtimeEvents';
import { createNotifier } from '../notifier';
import { runExperimentLoopPreflight } from '../loopEngine.preflightPhase';

const ensureSshpassAvailable = remoteExecModule.ensureSshpassAvailable as jest.MockedFunction<
  typeof remoteExecModule.ensureSshpassAvailable
>;

const getStateMock = useAutoResearchStore.getState as jest.MockedFunction<
  typeof useAutoResearchStore.getState
>;

interface MockStore {
  sshConfig: unknown;
  telegramConfig: unknown;
  id: string;
  metricDirection: 'lower' | 'higher';
  startedAt: string;
  metricName: string;
  setError: jest.Mock;
  setRunStatus: jest.Mock;
  setCurrentPhase: jest.Mock;
  addRunEvent: jest.Mock;
  setExperiments: jest.Mock;
  setBestMetric: jest.Mock;
  setCurrentIterationValue: jest.Mock;
  [key: string]: unknown;
}

function buildStore(overrides: Partial<MockStore> = {}): MockStore {
  return {
    sshConfig: {
      mode: 'ssh',
      authMode: 'key',
      host: 'h',
      port: 22,
      user: 'u',
      identityFile: '/tmp/key',
      remoteWorkDir: '/work',
    },
    telegramConfig: null,
    id: 'session-1',
    metricDirection: 'higher',
    startedAt: '2026-01-01T00:00:00.000Z',
    metricName: 'cv_accuracy',
    setError: jest.fn(),
    setRunStatus: jest.fn(),
    setCurrentPhase: jest.fn(),
    addRunEvent: jest.fn(),
    setExperiments: jest.fn(),
    setBestMetric: jest.fn(),
    setCurrentIterationValue: jest.fn(),
    ...overrides,
  } as MockStore;
}

const startup = {
  artifactCfg: { mode: 'ssh' },
  experimentCfg: { mode: 'ssh', authMode: 'key' },
  sessionContent: 'SESSION CONTENT',
  workDir: '/work',
  experimentDir: '/work/exp',
};

const sessionPaths = {
  sessionFilePath: '/work/session.md',
  sessionDir: '/work',
};

const environment = {
  repoStatus: 'clean',
  preferredPythonCommand: 'python3',
  recommendedRunCommand: 'python3 train.py',
  dirtyFileCount: 0,
  experimentDir: '/work/exp',
};

beforeEach(() => {
  jest.clearAllMocks();
  getStateMock.mockReturnValue(buildStore() as unknown as ReturnType<typeof useAutoResearchStore.getState>);
  (assertSupportedPlatform as jest.Mock).mockResolvedValue(undefined);
  (applyBootstrapIfPresent as jest.Mock).mockResolvedValue(undefined);
  (ensureSshpassAvailable as jest.Mock).mockResolvedValue({ ok: true, hint: undefined });
  (prepareLoopStartupContext as jest.Mock).mockResolvedValue(startup);
  (getSessionRunPaths as jest.Mock).mockReturnValue(sessionPaths);
  (writeTargetText as jest.Mock).mockResolvedValue(undefined);
  (rebuildLivingDoc as jest.Mock).mockResolvedValue(undefined);
  (inspectAutoResearchEnvironment as jest.Mock).mockResolvedValue(environment);
  (executeTargetCommand as jest.Mock).mockResolvedValue({ stdout: 'Linux\n', stderr: '', exitCode: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('runExperimentLoopPreflight (AG-02 PR2a)', () => {
  it('returns { ok: false, kind: "no_ssh_config" } when sshConfig is missing', async () => {
    getStateMock.mockReturnValue(
      buildStore({ sshConfig: null }) as unknown as ReturnType<typeof useAutoResearchStore.getState>,
    );
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('no_ssh_config');
    }
    expect(emitAutoResearchRuntimeEvent).not.toHaveBeenCalled();
  });

  it('returns { ok: false, kind: "unsupported_platform" } when assertSupportedPlatform throws', async () => {
    (assertSupportedPlatform as jest.Mock).mockRejectedValueOnce(new Error('mac not allowed'));
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('unsupported_platform');
      expect(r.error).toMatch(/mac not allowed/);
    }
  });

  it('emits run_started and calls setRunStatus("running") after the platform check passes', async () => {
    await runExperimentLoopPreflight();
    const store = getStateMock.mock.results[0]?.value as MockStore;
    expect(store.setRunStatus).toHaveBeenCalledWith('running', expect.objectContaining({ summary: 'Run started.' }));
    expect(emitAutoResearchRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run_started' }),
    );
  });

  it('returns { ok: false, kind: "remote_not_linux" } when uname -s is not Linux', async () => {
    (executeTargetCommand as jest.Mock).mockResolvedValueOnce({ stdout: 'Darwin\n', stderr: '', exitCode: 0 });
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('remote_not_linux');
    }
  });

  it('returns { ok: false, kind: "sshpass_unavailable" } for ssh+password when sshpass is missing', async () => {
    getStateMock.mockReturnValue(
      buildStore({
        sshConfig: {
          mode: 'ssh',
          authMode: 'password',
          host: 'h',
          port: 22,
          user: 'u',
          password: 'p',
          remoteWorkDir: '/work',
        },
      }) as unknown as ReturnType<typeof useAutoResearchStore.getState>,
    );
    (ensureSshpassAvailable as jest.Mock).mockResolvedValueOnce({
      ok: false,
      hint: 'install sshpass',
    });
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('sshpass_unavailable');
      expect(r.error).toMatch(/sshpass/);
    }
  });

  it('does not check sshpass for non-ssh modes', async () => {
    getStateMock.mockReturnValue(
      buildStore({ sshConfig: { mode: 'local' } }) as unknown as ReturnType<typeof useAutoResearchStore.getState>,
    );
    (prepareLoopStartupContext as jest.Mock).mockResolvedValue({
      ...startup,
      experimentCfg: { mode: 'local' },
    });
    await runExperimentLoopPreflight();
    expect(ensureSshpassAvailable).not.toHaveBeenCalled();
  });

  it('records a warn run event when applyBootstrapIfPresent throws, then continues', async () => {
    (applyBootstrapIfPresent as jest.Mock).mockRejectedValueOnce(new Error('bad json'));
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(true);
    const store = getStateMock.mock.results.at(-1)?.value as MockStore;
    expect(store.addRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', phase: 'preflight' }),
    );
  });

  it('returns { ok: false, kind: "startup_failed" } when prepareLoopStartupContext throws', async () => {
    (prepareLoopStartupContext as jest.Mock).mockRejectedValueOnce(new Error('no home'));
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('startup_failed');
    }
  });

  it('returns { ok: false, kind: "session_paths_failed" } when getSessionRunPaths throws', async () => {
    (getSessionRunPaths as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad session id');
    });
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('session_paths_failed');
    }
  });

  it('returns { ok: false, kind: "artifacts_init_failed" } when hydrateSessionFromDisk throws', async () => {
    // hydrateSessionFromDisk is a private helper inside the
    // preflight module. To exercise its failure path we make its
    // only IO dependency (readAllMetrics) reject.
    const metricsStoreMock = jest.requireMock('../metricsStore') as { readAllMetrics: jest.Mock };
    metricsStoreMock.readAllMetrics.mockRejectedValueOnce(new Error('disk full'));
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('artifacts_init_failed');
      expect(r.error).toMatch(/disk full/);
    }
  });

  it('writes the session file and rebuilds the living doc on the happy path', async () => {
    await runExperimentLoopPreflight();
    expect(writeTargetText).toHaveBeenCalledWith(
      expect.anything(),
      sessionPaths.sessionFilePath,
      'SESSION CONTENT',
    );
    expect(rebuildLivingDoc).toHaveBeenCalledWith(
      expect.anything(),
      'session-1',
      expect.objectContaining({ metricName: 'cv_accuracy', direction: 'higher' }),
    );
    expect(setAutoResearchPhase).toHaveBeenCalledWith(
      'READ_CONTEXT',
      expect.objectContaining({ summary: 'Run artifacts initialized.' }),
    );
  });

  it('returns { ok: false, kind: "dirty_repo" } when the experiment repo is dirty', async () => {
    (inspectAutoResearchEnvironment as jest.Mock).mockResolvedValueOnce({
      ...environment,
      repoStatus: 'dirty',
      dirtyFileCount: 3,
    });
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('dirty_repo');
      expect(r.error).toMatch(/3 uncommitted/);
    }
  });

  it('returns { ok: false, kind: "env_unreachable" } when inspectAutoResearchEnvironment throws', async () => {
    (inspectAutoResearchEnvironment as jest.Mock).mockRejectedValueOnce(new Error('ssh timeout'));
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('env_unreachable');
      expect(r.error).toMatch(/ssh timeout/);
    }
  });

  it('returns { ok: true, ctx } with the iteration inputs on the happy path', async () => {
    const r = await runExperimentLoopPreflight();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.sessionId).toBe('session-1');
      expect(r.ctx.sessionContent).toBe('SESSION CONTENT');
      expect(r.ctx.environmentSummary.repoStatus).toBe('clean');
      expect(r.ctx.sessionPaths).toEqual(sessionPaths);
      expect(r.ctx.notifier).toBeDefined();
    }
    expect(createNotifier).toHaveBeenCalled();
  });
});
