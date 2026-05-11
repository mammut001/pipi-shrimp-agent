jest.mock('@/services/resolvedChatRequest', () => ({
  buildResolvedChatRequest: jest.fn(),
}));

jest.mock('@/core/streamAdapter', () => ({
  invokeRustAPIStream: jest.fn(),
}));

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { invokeRustAPIStream } from '@/core/streamAdapter';
import { getAutoResearchToolProfile } from '../toolCatalog';
import {
  buildCompactReflectionInput,
  buildFallbackReflectionDecision,
  buildReflectionInputFromState,
  getDeterministicRecoveryDecision,
  parseReflectionDecisionText,
  requestReflectionDecision,
} from '../reflection';

const mockBuildResolvedChatRequest = buildResolvedChatRequest as jest.MockedFunction<typeof buildResolvedChatRequest>;
const mockInvokeRustAPIStream = invokeRustAPIStream as jest.MockedFunction<typeof invokeRustAPIStream>;
const localCommandTool = getAutoResearchToolProfile({ mode: 'local' }).commandTool;

const activeConfig: ResolvedAgentConfig = {
  configId: 'cfg-1',
  name: 'MiniMax Global',
  provider: 'minimax',
  providerLabel: 'MiniMax',
  model: 'MiniMax-M2.7',
  baseUrl: 'https://api.minimaxi.com/v1',
  apiFormat: 'openai',
  hasApiKey: true,
  hasBaseUrl: true,
  apiKey: 'test-key',
};

function createReflectionInput() {
  return {
    objective: 'Improve cv_accuracy on digits',
    metric: 'cv_accuracy',
    direction: 'higher' as const,
    cwd: '/tmp/research',
    iteration: 1,
    maxIterations: 5,
    recentEvents: [],
    recentToolResults: [],
    failedCommands: [],
    lastError: 'Exceeded maximum tool rounds (17)',
  };
}

async function* streamText(text: string) {
  if (text) {
    yield {
      type: 'text_delta' as const,
      content: text,
    };
  }
}

describe('AutoResearch reflection helpers', () => {
  beforeEach(() => {
    mockBuildResolvedChatRequest.mockReset();
    mockInvokeRustAPIStream.mockReset();
    mockBuildResolvedChatRequest.mockImplementation((_config, options) => ({
      params: { ...options },
      diagnostics: {
        selectedConfigName: 'MiniMax Global',
      },
    }) as ReturnType<typeof buildResolvedChatRequest>);
  });

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
          tool: localCommandTool,
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
          tool: localCommandTool,
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
          tool: localCommandTool,
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

  it('parses the reflection fallback chain across JSON, code fences, markdown, prose, and empty output', () => {
    expect(parseReflectionDecisionText('{"summary":"Retry once","decision":"continue","next_action":"rerun command"}')).toEqual(
      expect.objectContaining({
        parserPath: 'json',
        decision: expect.objectContaining({
          action: 'continue',
          summary: 'Retry once',
          nextPlan: 'rerun command',
        }),
      }),
    );

    expect(parseReflectionDecisionText('```json\n{"summary":"Fence JSON","decision":"mark_iteration_failed","next_action":""}\n```')).toEqual(
      expect.objectContaining({
        parserPath: 'json_block',
        decision: expect.objectContaining({
          action: 'mark_iteration_failed',
          summary: 'Fence JSON',
        }),
      }),
    );

    expect(parseReflectionDecisionText('## Summary\nThe loop should retry after cleaning the metrics file.\n\n## Notes\nIgnore this.')).toEqual(
      expect.objectContaining({
        parserPath: 'markdown_heading',
        decision: expect.objectContaining({
          action: 'continue',
          summary: 'The loop should retry after cleaning the metrics file.',
        }),
      }),
    );

    expect(parseReflectionDecisionText('Retry the experiment with the previous checkpoint and keep the change set minimal.')).toEqual(
      expect.objectContaining({
        parserPath: 'first_paragraph',
        decision: expect.objectContaining({
          action: 'continue',
          summary: 'Retry the experiment with the previous checkpoint and keep the change set minimal.',
        }),
      }),
    );

    expect(parseReflectionDecisionText('')).toBeNull();
  });

  it('retries invalid reflection outputs twice before succeeding with valid JSON', async () => {
    const responses = [
      'definitely not json',
      'still not valid json',
      '{"summary":"Retry once more with python3","decision":"continue","next_action":"python3 run_experiment.py"}',
    ];
    let callIndex = 0;
    mockInvokeRustAPIStream.mockImplementation(() => streamText(responses[callIndex++] ?? ''));

    const result = await requestReflectionDecision(activeConfig, createReflectionInput());

    expect(result.retryCount).toBe(2);
    expect(result.parserPath).toBe('json');
    expect(result.decision).toEqual(expect.objectContaining({
      action: 'continue',
      summary: 'Retry once more with python3',
      nextPlan: 'python3 run_experiment.py',
    }));
    expect(result.parseFailedAttempts).toHaveLength(2);
    expect(result.request.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ content: 'Your previous output was not valid JSON matching the required schema. Output ONLY the JSON object, no prose.' }),
      expect.objectContaining({ content: 'Your previous output was not valid JSON matching the required schema. Output ONLY the JSON object, no prose.' }),
    ]);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      3,
      activeConfig,
      expect.objectContaining({
        responseFormat: { type: 'json_object' },
      }),
    );
  });

  it('marks the iteration failed after three invalid reflection attempts', async () => {
    const responses = ['???', '```', ''];
    let callIndex = 0;
    mockInvokeRustAPIStream.mockImplementation(() => streamText(responses[callIndex++] ?? ''));

    const result = await requestReflectionDecision(activeConfig, createReflectionInput());

    expect(result.retryCount).toBe(2);
    expect(result.parserPath).toBeNull();
    expect(result.decision).toEqual(expect.objectContaining({
      action: 'mark_iteration_failed',
      summary: 'Reflection did not provide a summary.',
      shouldRetry: false,
    }));
    expect(result.parseFailedAttempts).toHaveLength(3);
  });
});
