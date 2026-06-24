import { describe, expect, it } from '@jest/globals';
import {
  deriveAutoResearchSetupPhase,
  formatAutoResearchSetupPhaseLabel,
  getAutoResearchSetupPhaseTone,
  isTerminalAutoResearchSetupPhase,
  type AutoResearchSetupPhase,
} from '../setupPhase';

describe('deriveAutoResearchSetupPhase', () => {
  it('default empty input -> configuring', () => {
    expect(deriveAutoResearchSetupPhase({})).toBe('configuring');
  });

  it('connectionStatus testing -> checking_environment', () => {
    expect(deriveAutoResearchSetupPhase({ connectionStatus: 'testing' })).toBe('checking_environment');
  });

  it('bootstrapStreaming true -> bootstrapping', () => {
    expect(deriveAutoResearchSetupPhase({ bootstrapStreaming: true })).toBe('bootstrapping');
  });

  it('bootstrapReady true -> bootstrap_ready', () => {
    expect(deriveAutoResearchSetupPhase({ bootstrapReady: true })).toBe('bootstrap_ready');
  });

  it('startingRun true -> starting_run', () => {
    expect(deriveAutoResearchSetupPhase({ startingRun: true })).toBe('starting_run');
  });

  it('loopState running -> running', () => {
    expect(deriveAutoResearchSetupPhase({ loopState: 'running' })).toBe('running');
  });

  it('activeRunStatus running -> running', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'running' })).toBe('running');
  });

  it('activeRunStatus waiting_rate_limit -> running', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'waiting_rate_limit' })).toBe('running');
  });

  it('loopState paused -> paused', () => {
    expect(deriveAutoResearchSetupPhase({ loopState: 'paused' })).toBe('paused');
  });

  it('loopState stopped -> stopped', () => {
    expect(deriveAutoResearchSetupPhase({ loopState: 'stopped' })).toBe('stopped');
  });

  it('activeRunStatus stopped -> stopped', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'stopped' })).toBe('stopped');
  });

  it('activeRunStatus completed -> completed', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'completed' })).toBe('completed');
  });

  it('activeRunStatus failed -> failed', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'failed' })).toBe('failed');
  });

  it('activeRunStatus reflection_failed -> failed', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'reflection_failed' })).toBe('failed');
  });

  it('activeRunStatus interrupted -> failed', () => {
    expect(deriveAutoResearchSetupPhase({ activeRunStatus: 'interrupted' })).toBe('failed');
  });

  it('error string -> failed', () => {
    expect(deriveAutoResearchSetupPhase({ error: 'connection refused' })).toBe('failed');
  });

  it('precedence: completed beats running', () => {
    expect(
      deriveAutoResearchSetupPhase({
        activeRunStatus: 'completed',
        loopState: 'running',
      }),
    ).toBe('completed');
  });

  it('precedence: failed beats running', () => {
    expect(
      deriveAutoResearchSetupPhase({
        activeRunStatus: 'failed',
        loopState: 'running',
      }),
    ).toBe('failed');
  });

  it('precedence: stopped beats configuring', () => {
    expect(
      deriveAutoResearchSetupPhase({
        loopState: 'stopped',
        connectionStatus: 'idle',
      }),
    ).toBe('stopped');
  });

  it('precedence: completed beats error string', () => {
    expect(
      deriveAutoResearchSetupPhase({
        activeRunStatus: 'completed',
        error: 'stale banner',
      }),
    ).toBe('completed');
  });

  it('loopState error -> failed', () => {
    expect(deriveAutoResearchSetupPhase({ loopState: 'error' })).toBe('failed');
  });
});

describe('formatAutoResearchSetupPhaseLabel', () => {
  const phases: AutoResearchSetupPhase[] = [
    'configuring',
    'checking_environment',
    'bootstrapping',
    'bootstrap_ready',
    'starting_run',
    'running',
    'paused',
    'stopped',
    'failed',
    'completed',
  ];

  it('returns zh-CN labels', () => {
    expect(formatAutoResearchSetupPhaseLabel('configuring', 'zh-CN')).toBe('配置中');
    expect(formatAutoResearchSetupPhaseLabel('checking_environment', 'zh-CN')).toBe('检查运行环境');
    expect(formatAutoResearchSetupPhaseLabel('bootstrapping', 'zh-CN')).toBe('生成脚手架');
    expect(formatAutoResearchSetupPhaseLabel('bootstrap_ready', 'zh-CN')).toBe('脚手架已就绪');
    expect(formatAutoResearchSetupPhaseLabel('starting_run', 'zh-CN')).toBe('正在启动');
    expect(formatAutoResearchSetupPhaseLabel('running', 'zh-CN')).toBe('运行中');
    expect(formatAutoResearchSetupPhaseLabel('paused', 'zh-CN')).toBe('已暂停');
    expect(formatAutoResearchSetupPhaseLabel('stopped', 'zh-CN')).toBe('已停止');
    expect(formatAutoResearchSetupPhaseLabel('failed', 'zh-CN')).toBe('失败');
    expect(formatAutoResearchSetupPhaseLabel('completed', 'zh-CN')).toBe('已完成');
  });

  it('returns en-US labels', () => {
    expect(formatAutoResearchSetupPhaseLabel('configuring', 'en-US')).toBe('Configuring');
    expect(formatAutoResearchSetupPhaseLabel('checking_environment', 'en-US')).toBe('Checking environment');
    expect(formatAutoResearchSetupPhaseLabel('bootstrapping', 'en-US')).toBe('Bootstrapping');
    expect(formatAutoResearchSetupPhaseLabel('bootstrap_ready', 'en-US')).toBe('Bootstrap ready');
    expect(formatAutoResearchSetupPhaseLabel('starting_run', 'en-US')).toBe('Starting run');
    expect(formatAutoResearchSetupPhaseLabel('running', 'en-US')).toBe('Running');
    expect(formatAutoResearchSetupPhaseLabel('paused', 'en-US')).toBe('Paused');
    expect(formatAutoResearchSetupPhaseLabel('stopped', 'en-US')).toBe('Stopped');
    expect(formatAutoResearchSetupPhaseLabel('failed', 'en-US')).toBe('Failed');
    expect(formatAutoResearchSetupPhaseLabel('completed', 'en-US')).toBe('Completed');
  });

  it('covers every phase in both locales', () => {
    for (const phase of phases) {
      expect(formatAutoResearchSetupPhaseLabel(phase, 'en-US').length).toBeGreaterThan(0);
      expect(formatAutoResearchSetupPhaseLabel(phase, 'zh-CN').length).toBeGreaterThan(0);
    }
  });
});

describe('getAutoResearchSetupPhaseTone', () => {
  it('maps every phase to a tone', () => {
    const phases: AutoResearchSetupPhase[] = [
      'configuring',
      'checking_environment',
      'bootstrapping',
      'bootstrap_ready',
      'starting_run',
      'running',
      'paused',
      'stopped',
      'failed',
      'completed',
    ];
    for (const phase of phases) {
      expect(getAutoResearchSetupPhaseTone(phase)).toBeTruthy();
    }
  });

  it('returns danger for failed and success for completed', () => {
    expect(getAutoResearchSetupPhaseTone('failed')).toBe('danger');
    expect(getAutoResearchSetupPhaseTone('completed')).toBe('success');
    expect(getAutoResearchSetupPhaseTone('running')).toBe('active');
    expect(getAutoResearchSetupPhaseTone('paused')).toBe('warning');
    expect(getAutoResearchSetupPhaseTone('configuring')).toBe('neutral');
  });
});

describe('isTerminalAutoResearchSetupPhase', () => {
  it('returns true only for stopped, failed, and completed', () => {
    expect(isTerminalAutoResearchSetupPhase('stopped')).toBe(true);
    expect(isTerminalAutoResearchSetupPhase('failed')).toBe(true);
    expect(isTerminalAutoResearchSetupPhase('completed')).toBe(true);
  });

  it('returns false for non-terminal phases', () => {
    const nonTerminal: AutoResearchSetupPhase[] = [
      'configuring',
      'checking_environment',
      'bootstrapping',
      'bootstrap_ready',
      'starting_run',
      'running',
      'paused',
    ];
    for (const phase of nonTerminal) {
      expect(isTerminalAutoResearchSetupPhase(phase)).toBe(false);
    }
  });
});