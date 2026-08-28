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

  it('tests all 4 connection test states for envCheck next action', () => {
    const envDraft = {
      ...validLocalDraft,
      connectionTestStatus: 'idle' as const,
    };
    const readiness = getManualSetupReadiness(envDraft);

    // 1. idle (not tested)
    const idleAction = getManualSetupNextAction(readiness, 'idle');
    expect(idleAction.actionType).toBe('envCheck');
    expect(idleAction.labelKey).toBe('autoresearch.manual.action.testEnv');
    expect(idleAction.disabled).toBe(false);

    // 2. testing
    const testingAction = getManualSetupNextAction(readiness, 'testing');
    expect(testingAction.actionType).toBe('envCheck');
    expect(testingAction.labelKey).toBe('autoresearch.connectionTesting');
    expect(testingAction.disabled).toBe(true);

    // 3. error (failed)
    const errorAction = getManualSetupNextAction(readiness, 'error');
    expect(errorAction.actionType).toBe('envCheck');
    expect(errorAction.labelKey).toBe('autoresearch.manual.action.envCheckFailed');
    expect(errorAction.disabled).toBe(false);

    // 4. success (passed)
    const passedReadiness = getManualSetupReadiness({
      ...validLocalDraft,
      connectionTestStatus: 'success',
    });
    const successAction = getManualSetupNextAction(passedReadiness, 'success');
    expect(successAction.actionType).toBe('start');
    expect(successAction.labelKey).toBe('autoresearch.manual.start');
    expect(successAction.disabled).toBe(false);
  });
});
