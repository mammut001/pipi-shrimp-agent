import { describe, expect, it } from '@jest/globals';
import { getManualSetupReadiness, getManualSetupNextAction, type ManualSetupDraft } from '../manualReadiness';

describe('manualReadiness tests', () => {
  const validLocalDraft: ManualSetupDraft = {
    setupForm: {
      mode: 'local',
      host: '',
      user: 'root',
      port: 22,
      authMode: 'agent',
      remoteWorkDir: '/test/workdir',
    },
    experimentDir: '/test/experiment',
    metric: 'accuracy',
    baselineInvalid: false,
    connectionTestStatus: 'success',
    providerReady: true,
  };

  const validSshDraft: ManualSetupDraft = {
    setupForm: {
      mode: 'ssh',
      host: '1.2.3.4',
      user: 'root',
      port: 22,
      authMode: 'password',
      password: 'password123',
      remoteWorkDir: '/test/workdir',
    },
    experimentDir: '/test/experiment',
    metric: 'accuracy',
    baselineInvalid: false,
    connectionTestStatus: 'success',
    providerReady: true,
  };

  it('determines valid local draft is fully ready', () => {
    const readiness = getManualSetupReadiness(validLocalDraft);
    expect(readiness.completedCount).toBe(6);
    expect(readiness.firstMissingId).toBeNull();
  });

  it('identifies missing items in invalid SSH config', () => {
    const brokenSshDraft: ManualSetupDraft = {
      ...validSshDraft,
      setupForm: {
        ...validSshDraft.setupForm,
        host: '', // missing
        password: '', // missing when authMode is password
      },
    };
    const readiness = getManualSetupReadiness(brokenSshDraft);
    expect(readiness.sectionStatus.runtime).toBe(false);
    expect(readiness.firstMissingId).toBe('runtime');
  });

  it('maps next actions based on missing statuses', () => {
    const readiness = getManualSetupReadiness({
      ...validLocalDraft,
      providerReady: false,
    });
    const action = getManualSetupNextAction(readiness, 'idle');
    expect(action.actionType).toBe('provider');
    expect(action.labelKey).toBe('autoresearch.manual.action.openProviderConfig');

    const envReadiness = getManualSetupReadiness({
      ...validLocalDraft,
      connectionTestStatus: 'idle',
    });
    const envAction = getManualSetupNextAction(envReadiness, 'idle');
    expect(envAction.actionType).toBe('envCheck');
    expect(envAction.disabled).toBe(false);
    expect(envAction.labelKey).toBe('autoresearch.manual.action.testEnv');
  });
});
