import { describe, expect, it, jest } from '@jest/globals';
import { validateAutoResearchSetupDraft } from '../setupFlow';

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.connectionTestRequired': 'Run a successful connection test before starting AutoResearch.',
    'autoresearch.validationHostRequired': 'SSH host is required.',
    'autoresearch.validationUserRequired': 'SSH user is required.',
    'autoresearch.validationPasswordRequired': 'SSH password is required for password auth.',
    'autoresearch.validationKeyPathRequired': 'SSH key path is required for key auth.',
    'autoresearch.validationWorkdirRequired': 'Workdir is required.',
    'autoresearch.validationExperimentDirRequired': 'Experiment directory is required.',
    'autoresearch.validationMetricRequired': 'Metric name is required.',
    'autoresearch.validationBaselineNumber': 'Baseline must be a number.',
  }[key] ?? key),
}));

describe('validateAutoResearchSetupDraft', () => {
  it('requires a successful connection test when requested', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
      requireConnectionTest: true,
      connectionTestStatus: 'idle',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('Run a successful connection test before starting AutoResearch.');
  });

  it('normalizes valid local setup values', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '  ~/autoresearch  ',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '  ~/Documents/tiny-autoresearch-digits  ',
      metric: ' cv_accuracy ',
      direction: 'Higher',
      iterations: 99,
      baselineInput: '0.91',
    });

    expect(result.error).toBeNull();
    expect(result.value).toEqual({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 50,
      baseline: 0.91,
    });
  });

  it('surfaces SSH validation errors instead of silently returning', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'ssh',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('SSH host is required.');
  });
});
