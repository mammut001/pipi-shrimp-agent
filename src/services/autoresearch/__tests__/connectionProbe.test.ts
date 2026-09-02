import { describe, expect, it } from '@jest/globals';
import {
  AUTORESEARCH_SAFE_HOST_CWD,
  buildAutoResearchConnectionProbeCommand,
  buildAutoResearchConnectionProbeInvokeArgs,
  interpretAutoResearchConnectionProbe,
  parseAutoResearchConnectionProbeOutput,
} from '../connectionProbe';

describe('connectionProbe', () => {
  it('never uses a relative host cwd of . for execute_bash', () => {
    const args = buildAutoResearchConnectionProbeInvokeArgs({
      mode: 'local',
      sshConfig: { mode: 'local', remoteWorkDir: '/tmp/ar-nongit2' },
      workDir: '/tmp/ar-nongit2',
      experimentDir: '/tmp/harness-smoke',
      timeoutSecs: 30,
    });
    expect(args.workDir).toBe(AUTORESEARCH_SAFE_HOST_CWD);
    expect(args.workDir).not.toBe('.');
    expect(args.command).not.toMatch(/(^|\s)cd \.(?:\s|$)/);
    expect(args.command).toContain('/tmp/ar-nongit2');
    expect(args.command).toContain('/tmp/harness-smoke');
  });

  it('rejects relative workspace and experimentDir paths instead of probing .', () => {
    expect(() => buildAutoResearchConnectionProbeCommand({
      workDir: '.',
      experimentDir: '/tmp/exp',
    })).toThrow(/absolute or home path/);

    expect(() => buildAutoResearchConnectionProbeCommand({
      workDir: './relative-work',
      experimentDir: '/tmp/exp',
    })).toThrow(/absolute or home path/);

    expect(() => buildAutoResearchConnectionProbeCommand({
      workDir: '/tmp/work',
      experimentDir: 'relative-exp',
    })).toThrow(/absolute or home path/);
  });

  it('does not chain git with && so a missing repo cannot fail the probe', () => {
    const command = buildAutoResearchConnectionProbeCommand({
      workDir: '~/autoresearch',
      experimentDir: '/tmp/exp',
    });
    expect(command).toContain('mkdir -p');
    expect(command).toContain('__AUTORESEARCH_TARGET_OK__');
    expect(command).toContain('git:missing');
    expect(command).toContain('git:not_installed');
    expect(command).not.toMatch(/pwd && git rev-parse/);
    expect(command).not.toMatch(/git rev-parse --is-inside-work-tree &&/);
  });

  it('treats git:missing as a warning, not a failed connection', () => {
    const stdout = [
      'Darwin',
      '/Users/demo',
      'workspace:ok',
      'experiment:ok',
      '__AUTORESEARCH_TARGET_OK__',
      'git:missing',
      'python:ok',
    ].join('\n');

    const verdict = interpretAutoResearchConnectionProbe({
      stdout,
      stderr: '',
      exitCode: 0,
      mode: 'local',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.parsed.git).toBe('missing');
    expect(verdict.warnings).toContain('git_missing');
  });

  it('fails when git is not installed', () => {
    const stdout = [
      'Darwin',
      '/Users/demo',
      'workspace:ok',
      'experiment:ok',
      '__AUTORESEARCH_TARGET_OK__',
      'git:not_installed',
      'python:ok',
    ].join('\n');

    const verdict = interpretAutoResearchConnectionProbe({
      stdout,
      stderr: '',
      exitCode: 0,
      mode: 'local',
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.error).toMatch(/Git is not installed/i);
  });

  it('parses the structured probe markers', () => {
    const parsed = parseAutoResearchConnectionProbeOutput([
      'Linux',
      '/home/ubuntu',
      'workspace:ok',
      'experiment:missing',
      '__AUTORESEARCH_TARGET_OK__',
      'git:ok',
      'python:ok',
    ].join('\n'));

    expect(parsed.platform).toBe('Linux');
    expect(parsed.pwd).toBe('/home/ubuntu');
    expect(parsed.targetOk).toBe(true);
    expect(parsed.git).toBe('ok');
    expect(parsed.experiment).toBe('missing');
    expect(parsed.python).toBe('ok');
  });
});
