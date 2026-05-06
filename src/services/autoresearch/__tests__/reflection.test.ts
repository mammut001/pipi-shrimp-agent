jest.mock('@/services/resolvedChatRequest', () => ({
  buildResolvedChatRequest: jest.fn(),
}));

jest.mock('@/core/streamAdapter', () => ({
  invokeRustAPIStream: jest.fn(),
}));

import { describe, expect, it } from '@jest/globals';
import {
  buildCompactReflectionInput,
  buildFallbackReflectionDecision,
  buildReflectionInputFromState,
  getDeterministicRecoveryDecision,
} from '../reflection';

describe('AutoResearch reflection helpers', () => {
  it('builds compact reflection input without huge logs or raw API keys', () => {
    const input = buildCompactReflectionInput({
      objective: 'Improve cv_accuracy on digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      cwd: '/tmp/research',
      iteration: 1,
      maxIterations: 5,
      recentEvents: [
        `authorization=Bearer secret-super-long-token-value ${'x'.repeat(800)}`,
      ],
      recentToolResults: [
        {
          tool: 'ssh_exec',
          command: 'python run_experiment.py',
          stdout: `api_key=secret-key-1234567890 ${'a'.repeat(800)}`,
          stderr: `x-api-key: secret-key-1234567890 ${'b'.repeat(800)}`,
          exitCode: 127,
        },
      ],
      failedCommands: ['python run_experiment.py'],
      lastError: `Authorization: Bearer secret-key-1234567890 ${'c'.repeat(800)}`,
    });

    expect(input.recentEvents[0]).toContain('[redacted]');
    expect(input.recentToolResults[0]?.stdout).not.toContain('secret-key-1234567890');
    expect(input.recentToolResults[0]?.stderr).toContain('[redacted]');
    expect(input.lastError).toContain('[redacted]');
    expect(input.recentToolResults[0]?.stderr?.length ?? 0).toBeLessThan(450);
  });

  it('switches to python3 deterministically when python is missing', () => {
    const decision = getDeterministicRecoveryDecision(buildReflectionInputFromState({
      systemPrompt: '## Session File\nGoal: improve cv_accuracy\n## Living AutoResearch Notes\nnone',
      metric: 'cv_accuracy',
      direction: 'higher',
      cwd: '/tmp/research',
      iteration: 1,
      maxIterations: 5,
      environmentSummary: {
        experimentDir: '/tmp/research',
        gitRepo: true,
        repoStatus: 'clean',
        dirtyFileCount: 0,
        preferredPythonCommand: 'python3',
        worktreeWritable: true,
        runScriptPath: '/tmp/research/run_experiment.py',
        notesPath: '/tmp/research/AUTORESEARCH.md',
        recommendedRunCommand: 'python3 run_experiment.py',
      },
      recentEvents: [],
      recentToolResults: [
        {
          tool: 'ssh_exec',
          command: 'python run_experiment.py',
          stdout: '',
          stderr: 'bash: python: command not found',
          exitCode: 127,
        },
      ],
      failedCommands: ['python run_experiment.py'],
      lastError: 'Exceeded maximum tool rounds (17)',
      remainingToolBudget: 0,
    }));

    expect(decision).toEqual(expect.objectContaining({
      action: 'switch_command',
      nextCommand: 'python3 run_experiment.py',
      shouldRetry: true,
    }));
  });

  it('preserves the last meaningful tool error in fallback stop decisions', () => {
    const decision = buildFallbackReflectionDecision({
      objective: 'Improve cv_accuracy',
      metric: 'cv_accuracy',
      direction: 'higher',
      cwd: '/tmp/research',
      iteration: 1,
      maxIterations: 5,
      recentEvents: [],
      recentToolResults: [
        {
          tool: 'ssh_exec',
          command: 'python run_experiment.py',
          stderr: 'bash: python: command not found',
          exitCode: 127,
        },
      ],
      failedCommands: ['python run_experiment.py'],
      lastError: 'Exceeded maximum tool rounds (17)',
      remainingToolBudget: 0,
    }, new Error('Exceeded maximum tool rounds (17)'));

    expect(decision.action).toBe('stop_tool_exhausted');
    expect(decision.rootCause).toBe('bash: python: command not found');
    expect(decision.userMessage).toBe('bash: python: command not found');
  });
});
