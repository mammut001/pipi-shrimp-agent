import { describe, expect, it, jest } from '@jest/globals';
import type { AutoResearchRecoveryAction } from '../history';
import {
  dispatchAutoResearchRecoveryAction,
  handleAutoResearchRecoveryAction,
} from '../recoveryActions';

describe('dispatchAutoResearchRecoveryAction (R5-11)', () => {
  it('retry_iteration invokes resumeExperimentLoop with the run id', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    const action: AutoResearchRecoveryAction = {
      type: 'retry_iteration',
      supported: true,
      label: 'Retry iteration',
    };

    const result = dispatchAutoResearchRecoveryAction(action, 'run-123', {
      resumeExperimentLoop,
      stopExperimentLoop,
    });

    expect(result).toEqual({ kind: 'executed', effect: 'retry' });
    expect(resumeExperimentLoop).toHaveBeenCalledTimes(1);
    expect(resumeExperimentLoop).toHaveBeenCalledWith('run-123');
    expect(stopExperimentLoop).not.toHaveBeenCalled();
  });

  it('retry_failed_phase also resumes when marked supported', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    const result = handleAutoResearchRecoveryAction(
      { type: 'retry_failed_phase', supported: true },
      'run-abc',
      { resumeExperimentLoop, stopExperimentLoop },
    );
    expect(result.kind).toBe('executed');
    expect(resumeExperimentLoop).toHaveBeenCalledWith('run-abc');
  });

  it('abort_run invokes stopExperimentLoop with the run id', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    const result = dispatchAutoResearchRecoveryAction(
      { type: 'abort_run', supported: true, label: 'Abort run' },
      'run-stop',
      { resumeExperimentLoop, stopExperimentLoop },
    );
    expect(result).toEqual({ kind: 'executed', effect: 'abort' });
    expect(stopExperimentLoop).toHaveBeenCalledWith('run-stop');
    expect(resumeExperimentLoop).not.toHaveBeenCalled();
  });

  it('open_logs / open_raw_request_summary return inspect focus without calling loop APIs', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    for (const type of ['open_logs', 'open_raw_request_summary'] as const) {
      const result = dispatchAutoResearchRecoveryAction(
        { type, supported: true },
        'run-1',
        { resumeExperimentLoop, stopExperimentLoop },
      );
      expect(result).toEqual({ kind: 'inspect', focus: 'debug' });
    }
    expect(resumeExperimentLoop).not.toHaveBeenCalled();
    expect(stopExperimentLoop).not.toHaveBeenCalled();
  });

  it('keeps unsupported actions from firing loop APIs', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    const result = dispatchAutoResearchRecoveryAction(
      {
        type: 'retry_iteration',
        supported: false,
        reason: 'Not resumable.',
      },
      'run-1',
      { resumeExperimentLoop, stopExperimentLoop },
    );
    expect(result).toEqual({ kind: 'unsupported', reason: 'Not resumable.' });
    expect(resumeExperimentLoop).not.toHaveBeenCalled();
    expect(stopExperimentLoop).not.toHaveBeenCalled();
  });

  it('switch_provider and increase_tool_budget stay unsupported without fake success', () => {
    const resumeExperimentLoop = jest.fn();
    const stopExperimentLoop = jest.fn();
    for (const type of ['switch_provider', 'increase_tool_budget'] as const) {
      const result = dispatchAutoResearchRecoveryAction(
        { type, supported: true },
        'run-1',
        { resumeExperimentLoop, stopExperimentLoop },
      );
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' && result.reason.length).toBeGreaterThan(0);
    }
    expect(resumeExperimentLoop).not.toHaveBeenCalled();
    expect(stopExperimentLoop).not.toHaveBeenCalled();
  });
});
