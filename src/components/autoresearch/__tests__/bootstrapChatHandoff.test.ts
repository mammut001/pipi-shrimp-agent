import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import type { SshConfig } from '@/store/autoresearchStore';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useWorkflowStore } from '@/store/workflowStore';
import {
  type BootstrapChatHandoffHost,
  performBootstrapHandoff,
} from '../bootstrapChatHandoff';

const mockStartAutoResearchRun = jest.fn<any>();
const mockLogAutoResearchSetupFailure = jest.fn<any>();
jest.mock('@/services/autoresearch/setupFlow', () => ({
  startAutoResearchRun: (...args: any[]) => mockStartAutoResearchRun(...args),
  logAutoResearchSetupFailure: (...args: any[]) => mockLogAutoResearchSetupFailure(...args),
}));

const mockUploadBootstrapScaffoldWithRollback = jest.fn<any>();
jest.mock('@/services/autoresearch/bootstrap/uploadBootstrapScaffold', () => ({
  uploadBootstrapScaffoldWithRollback: (...args: any[]) => mockUploadBootstrapScaffoldWithRollback(...args),
}));

function createMockReadyResult(partial: Partial<AutoResearchBootstrapResult> = {}): AutoResearchBootstrapResult {
  return {
    status: 'ready',
    createdAt: '2026-09-23T01:00:00.000Z',
    warnings: [],
    unresolvedQuestions: [],
    plan: {
      researchGoal: 'Train image classifier',
      successCriteria: 'Accuracy > 0.90',
      primaryMetric: 'accuracy',
      direction: 'higher',
      baselines: [
        {
          name: 'resnet-baseline',
          task: 'classification',
          dataset: 'cifar10',
          reportedMetrics: [{ name: 'accuracy', value: 0.85 }],
          method: { summary: 'resnet18' },
          reproducibility: { hasOfficialCode: false },
        },
      ],
      scaffold: {
        workDir: '/workspace/project-alpha',
        files: [
          { path: 'train.py', content: '# train' },
        ],
      },
    },
    ...partial,
  };
}

describe('bootstrapChatHandoff', () => {
  let host: BootstrapChatHandoffHost;
  let bootstrappedAtRef: { current: string | null };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartAutoResearchRun.mockResolvedValue({
      resolvedConfig: {
        mode: 'local',
        remoteWorkDir: '/workspace/project-alpha',
      },
    });
    mockUploadBootstrapScaffoldWithRollback.mockResolvedValue({ uploadedPaths: [] });
    mockLogAutoResearchSetupFailure.mockImplementation((_, err) => `Failed: ${String(err)}`);

    bootstrappedAtRef = { current: null };
    host = {
      setError: jest.fn(),
      setHandoffSummary: jest.fn(),
      bootstrappedAtRef,
      sshConfig: undefined,
      recipeDirection: 'higher',
      windowsShellProfile: undefined,
      onReady: jest.fn(),
    };

    useAutoResearchStore.setState({
      id: '',
      loopState: 'idle',
      runHistory: [],
      selectedRunId: null,
      setSshConfig: jest.fn(),
      setLastUsedConfig: jest.fn(),
      initSession: jest.fn(),
      openTerminalPanel: jest.fn(),
    } as any);

    useWorkflowStore.setState({
      runs: [],
      currentInstanceId: 'inst-1',
      instances: [{ id: 'inst-1', name: 'AutoResearch Bootstrap', runs: [] }],
      createInstance: jest.fn(),
      addWorkflowRun: jest.fn(),
      getCurrentInstance: () => ({ id: 'inst-1', name: 'AutoResearch Bootstrap', runs: [] }),
    } as any);
  });

  it('rejects handoff when result status is not ready', async () => {
    const notReadyResult = createMockReadyResult({
      status: 'needs_user_confirmation',
      unresolvedQuestions: ['Confirm dataset download?'],
    });

    await performBootstrapHandoff(notReadyResult, 10, host);

    expect(host.setError).toHaveBeenCalledWith('Confirm dataset download?');
    expect(mockStartAutoResearchRun).not.toHaveBeenCalled();
    expect(host.bootstrappedAtRef.current).toBeNull();
  });

  it('blocks handoff when an AutoResearch run is already active (lock block)', async () => {
    useAutoResearchStore.setState({
      id: 'active-run-1',
      loopState: 'running',
      runHistory: [
        { id: 'active-run-1', status: 'running' } as any,
      ],
    } as any);

    const result = createMockReadyResult();
    await performBootstrapHandoff(result, 10, host);

    expect(host.setError).toHaveBeenCalledWith(
      expect.stringContaining('AutoResearch is still running. Stop the active run before you start a new run.'),
    );
    expect(mockStartAutoResearchRun).not.toHaveBeenCalled();
    expect(host.onReady).not.toHaveBeenCalled();
    expect(host.bootstrappedAtRef.current).toBeNull();
  });

  it('dedupes when bootstrappedAt matches createdAt', async () => {
    const result = createMockReadyResult();
    bootstrappedAtRef.current = result.createdAt;

    await performBootstrapHandoff(result, 10, host);

    expect(mockStartAutoResearchRun).not.toHaveBeenCalled();
    expect(host.setError).not.toHaveBeenCalled();
    expect(host.setHandoffSummary).not.toHaveBeenCalled();
    expect(host.onReady).not.toHaveBeenCalled();
  });

  it('performs local start summary successfully', async () => {
    const result = createMockReadyResult();

    await performBootstrapHandoff(result, 10, host);

    expect(mockUploadBootstrapScaffoldWithRollback).not.toHaveBeenCalled();
    expect(mockStartAutoResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfig: expect.objectContaining({ mode: 'local', remoteWorkDir: '/workspace/project-alpha' }),
        experimentDir: '/workspace/project-alpha',
        metric: 'accuracy',
        direction: 'higher',
        iterations: 10,
        baseline: 0.85,
      }),
      expect.any(Object),
    );
    expect(host.setHandoffSummary).toHaveBeenCalledWith('accuracy · /workspace/project-alpha');
    expect(host.onReady).toHaveBeenCalled();
    expect(host.bootstrappedAtRef.current).toBe(result.createdAt);
  });

  it('handles SSH upload path and uploads scaffold before starting run', async () => {
    const sshConfig: SshConfig = {
      mode: 'ssh',
      host: 'gpu-server.example',
      user: 'ubuntu',
      keyPath: '/keys/gpu.pem',
      port: 22,
      remoteWorkDir: '~/autoresearch/exp-1',
      authMode: 'key',
      password: '',
    };
    host.sshConfig = sshConfig;
    mockStartAutoResearchRun.mockResolvedValueOnce({
      resolvedConfig: {
        mode: 'ssh',
        remoteWorkDir: '~/autoresearch/exp-1',
      },
    });

    const result = createMockReadyResult();
    await performBootstrapHandoff(result, 20, host);

    expect(mockUploadBootstrapScaffoldWithRollback).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfig,
        localWorkDir: '/workspace/project-alpha',
        remoteWorkDir: '~/autoresearch/exp-1',
        files: result.plan.scaffold.files,
        bootstrapResultJson: JSON.stringify(result, null, 2),
      }),
    );
    expect(mockStartAutoResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfig: expect.objectContaining({
          mode: 'ssh',
          host: 'gpu-server.example',
          remoteWorkDir: '~/autoresearch/exp-1',
        }),
        experimentDir: '~/autoresearch/exp-1',
        metric: 'accuracy',
        direction: 'higher',
        iterations: 20,
      }),
      expect.any(Object),
    );
    expect(host.setHandoffSummary).toHaveBeenCalledWith('accuracy · ~/autoresearch/exp-1');
    expect(host.onReady).toHaveBeenCalled();
    expect(host.bootstrappedAtRef.current).toBe(result.createdAt);
  });

  it('clears bootstrappedAt and sets error on handoff failure', async () => {
    const error = new Error('SSH connection timed out');
    mockStartAutoResearchRun.mockRejectedValueOnce(error);

    const result = createMockReadyResult();
    await performBootstrapHandoff(result, 10, host);

    expect(host.bootstrappedAtRef.current).toBeNull();
    expect(mockLogAutoResearchSetupFailure).toHaveBeenCalledWith(
      'bootstrap-handoff',
      error,
      expect.objectContaining({
        workDir: '/workspace/project-alpha',
        metric: 'accuracy',
      }),
    );
    expect(host.setError).toHaveBeenCalledWith('Failed: Error: SSH connection timed out');
    expect(host.setHandoffSummary).not.toHaveBeenCalled();
    expect(host.onReady).not.toHaveBeenCalled();
  });
});
