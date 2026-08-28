import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { buildAutoResearchToolCatalog, getAutoResearchToolProfile } from '../toolCatalog';
import {
  deepseekMixedFailureTranscriptFixture,
  type AutoResearchTranscriptAttempt,
} from './fixtures/deepseekMixedFailureTranscript.fixture';
import { installTranscriptFixture as installTranscriptFixtureMock } from './transcriptHarness';

const localToolCatalog = buildAutoResearchToolCatalog({ mode: 'local' });
const localCommandTool = getAutoResearchToolProfile({ mode: 'local' }).commandTool;

const mockAppendLiveOutput = jest.fn();
const mockWriteTargetText = jest.fn();
const mockAppendTargetText = jest.fn();
const mockRunHeadlessAgentTurn = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();
const mockGetAgentConfigDiagnostics = jest.fn();
const mockAddRunEvent = jest.fn();
const mockPatchIterationRecord = jest.fn();
const mockSetCurrentPhase = jest.fn();
const mockRequestReflectionDecision = jest.fn();
const mockGetDeterministicRecoveryDecision = jest.fn();
const mockBuildFallbackReflectionDecision = jest.fn();
const mockGetCurrentRunDir = jest.fn();

class MockAutoResearchReflectionFailureError extends Error {
  readonly decisionResult: unknown;

  constructor(message: string, decisionResult: unknown) {
    super(message);
    this.name = 'AutoResearchReflectionFailureError';
    this.decisionResult = decisionResult;
  }
}

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => ({
      id: 'run-1',
      currentIteration: 3,
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/research',
        authMode: 'agent',
        password: '',
      },
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      maxIterations: 5,
      runHistory: [
        {
          id: 'run-1',
          events: [
            { phase: 'system', message: 'Run initialized.' },
          ],
        },
      ],
      appendLiveOutput: mockAppendLiveOutput,
      addRunEvent: mockAddRunEvent,
      patchIterationRecord: mockPatchIterationRecord,
      setCurrentPhase: mockSetCurrentPhase,
    }),
  },
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
  validateResolvedAgentConfig: (...args: unknown[]) => mockValidateResolvedAgentConfig(...args),
  formatAgentConfigValidationError: (...args: unknown[]) => mockFormatAgentConfigValidationError(...args),
  getAgentConfigDiagnostics: (...args: unknown[]) => mockGetAgentConfigDiagnostics(...args),
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

jest.mock('../runDir', () => ({
  writeTargetText: (...args: unknown[]) => mockWriteTargetText(...args),
  appendTargetText: (...args: unknown[]) => mockAppendTargetText(...args),
}));

jest.mock('../terminalRunner', () => ({
  getCurrentRunDir: () => mockGetCurrentRunDir(),
}));

jest.mock('../reflection', () => ({
  AutoResearchReflectionFailureError: MockAutoResearchReflectionFailureError,
  buildReflectionInputFromState: (input: unknown) => input,
  isAutoResearchReflectionFailureError: (error: unknown) => error instanceof MockAutoResearchReflectionFailureError,
  requestReflectionDecision: (...args: unknown[]) => mockRequestReflectionDecision(...args),
  getDeterministicRecoveryDecision: (...args: unknown[]) => mockGetDeterministicRecoveryDecision(...args),
  buildFallbackReflectionDecision: (...args: unknown[]) => mockBuildFallbackReflectionDecision(...args),
}));

function createReflectionResult(overrides: Record<string, unknown> = {}) {
  return {
    decision: {
      action: 'mark_iteration_failed',
      summary: 'Reflection did not provide a summary.',
      userMessage: 'Reflection did not provide a summary.',
      shouldRetry: false,
      confidence: 'low',
      ...((overrides.decision as Record<string, unknown> | undefined) ?? {}),
    },
    rawText: 'raw reflection output',
    parserPath: null,
    retryCount: 2,
    request: {
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: 'first request' },
      ],
      responseFormat: { type: 'json_object' },
    },
    parseFailedAttempts: [],
    ...overrides,
  };
}

function createToolBudgetSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    toolBudgetUsed: 13,
    toolBudgetUsedRaw: 13,
    toolBudgetMax: 17,
    failedCalls: 1,
    successfulCalls: 12,
    categoryCounts: {
      tool_not_found: 0,
      tool_disabled: 0,
      argument_invalid: 0,
      transient_failure: 1,
      successful_call: 12,
    },
    ...overrides,
  };
}

function installChatAdapterTranscriptFixture(attempts: AutoResearchTranscriptAttempt[]): void {
  installTranscriptFixtureMock(mockRunHeadlessAgentTurn, attempts);
}

describe('createAutoResearchSendMessage', () => {
  const activeConfig: ResolvedAgentConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai',
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'test-key',
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRunHeadlessAgentTurn.mockReset();
    mockWriteTargetText.mockReset();
    mockAppendTargetText.mockReset();
    mockPatchIterationRecord.mockReset();
    mockSetCurrentPhase.mockReset();
    mockResolveActiveAgentConfig.mockReturnValue(activeConfig);
    mockValidateResolvedAgentConfig.mockReturnValue([]);
    mockFormatAgentConfigValidationError.mockReturnValue('invalid config');
    mockGetAgentConfigDiagnostics.mockReturnValue({
      selectedConfigName: 'MiniMax Global',
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      hasApiKey: true,
      hasBaseURL: true,
      adapterName: 'minimax-openai',
      authorizationHeaderPresent: true,
    });
    mockRunHeadlessAgentTurn.mockImplementation(async (input) => {
      input.onTextDelta?.('partial output');
      input.onReasoningDelta?.('reasoning trace');
      input.onStatus?.('working');
      input.onToolSummary?.('read_file', 'README excerpt');
      await input.onToolCall?.({ id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' });
      await input.onToolResult?.({ id: 'tool-1', name: 'read_file', result: 'README excerpt', durationMs: 12 });
      await input.onAssistantMessage?.('assistant block');
      return {
        finalText: 'final answer',
        finalReasoning: '',
      };
    });
    mockGetDeterministicRecoveryDecision.mockReturnValue(null);
    mockRequestReflectionDecision.mockReset();
    mockBuildFallbackReflectionDecision.mockImplementation((_input, error) => ({
      action: 'stop_tool_exhausted',
      summary: error instanceof Error ? error.message : 'fallback stop',
      userMessage: error instanceof Error ? error.message : 'fallback stop',
      shouldRetry: false,
      confidence: 'medium',
    }));
    mockGetCurrentRunDir.mockReturnValue(null);
  });

  it('keeps the local AutoResearch lane on the five-tool allowlist', () => {
    expect(localToolCatalog).toEqual([
      'get_current_workspace',
      'execute_command',
      'read_file',
      'write_file',
      'create_directory',
    ]);
  });

  it('uses the resolved active config for headless agent execution', async () => {
    const { createAutoResearchSendMessage } = await import('../chatAdapter');

    const sendMessage = createAutoResearchSendMessage('/tmp/research');
    await expect(sendMessage('system prompt', 'first question')).resolves.toBe('final answer');

    expect(mockResolveActiveAgentConfig).toHaveBeenCalledTimes(1);
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'system prompt',
      workDir: '/tmp/research',
      agentConfig: activeConfig,
      allowedTools: localToolCatalog,
      toolExecutionSource: 'autoresearch_phase',
      permissionMode: 'bypass',
      executionMode: 'bypass',
      initialMessages: [
        {
          role: 'user',
          content: 'first question',
        },
      ],
    }));
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('\n--- Iteration 3 ---\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('partial output');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[thinking]\nreasoning trace\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[status] working\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith(expect.stringContaining('read_file: README excerpt'));
  });

  it('does not reuse freeform transcripts from previous iterations', async () => {
    mockRunHeadlessAgentTurn
      .mockResolvedValueOnce({
        finalText: 'first answer',
        finalReasoning: '',
      })
      .mockResolvedValueOnce({
        finalText: 'second answer',
        finalReasoning: '',
      });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'first question')).resolves.toBe('first answer');
    await expect(sendMessage('system prompt', 'second question')).resolves.toBe('second answer');

    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolExecutionSource: 'autoresearch_phase',
        permissionMode: 'bypass',
        executionMode: 'bypass',
        initialMessages: [
          {
            role: 'user',
            content: 'first question',
          },
        ],
      }),
    );
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolExecutionSource: 'autoresearch_phase',
        permissionMode: 'bypass',
        executionMode: 'bypass',
        initialMessages: [
          {
            role: 'user',
            content: 'second question',
          },
        ],
      }),
    );
  });

  it('binds local file tools to the current iteration code snapshot when available', async () => {
    mockGetCurrentRunDir.mockReturnValue({
      iterDir: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z',
      codeDir: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z/code',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research/source', activeConfig);

    await expect(sendMessage('system prompt', 'use iteration workspace')).resolves.toBe('final answer');

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      workDir: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z',
      toolExecutionSource: 'autoresearch_phase',
      permissionMode: 'bypass',
      executionMode: 'bypass',
    }));
  });

  it('rewrites original experimentDir tool paths onto the iteration code checkout', async () => {
    mockGetCurrentRunDir.mockReturnValue({
      iterDir: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z',
      codeDir: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z/code',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/harness-smoke', activeConfig, {
      environmentSummary: {
        experimentDir: '/tmp/harness-smoke',
        gitRepo: true,
        repoStatus: 'clean',
        dirtyFileCount: 0,
        preferredPythonCommand: 'python3',
        worktreeWritable: true,
        runScriptPath: '/tmp/harness-smoke/run_experiment.py',
        notesPath: '/tmp/harness-smoke/AUTORESEARCH.md',
        recommendedRunCommand: 'python3 run_experiment.py',
      },
    });

    await expect(sendMessage('system prompt', 'read experiment files')).resolves.toBe('final answer');

    const rewrite = mockRunHeadlessAgentTurn.mock.calls[0]?.[0]?.rewriteToolArguments as
      | ((args: Record<string, unknown>, toolName: string) => Record<string, unknown>)
      | undefined;
    expect(typeof rewrite).toBe('function');
    expect(rewrite(
      { path: '/tmp/harness-smoke/run_experiment.py', cwd: '/tmp/harness-smoke' },
      'read_file',
    )).toEqual({
      path: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z/code/run_experiment.py',
      cwd: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z/code',
    });
    expect(rewrite(
      { command: 'python3 run_experiment.py' },
      'execute_command',
    )).toEqual({
      command: 'python3 run_experiment.py',
      cwd: '/tmp/research/runs/run-1/iter-002-2026-05-11T00-00-00Z/code',
    });
  });

  it('does not send requests when authorization would be empty', async () => {
    mockResolveActiveAgentConfig.mockReturnValue({
      ...activeConfig,
      hasApiKey: false,
      apiKey: '   ',
    });
    mockValidateResolvedAgentConfig.mockReturnValue([{ field: 'apiKey', message: 'missing key' }]);

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research');

    await expect(sendMessage('system prompt', 'first question')).rejects.toThrow('invalid config');
    expect(mockRunHeadlessAgentTurn).not.toHaveBeenCalled();
  });

  it('keeps using the frozen run config after Settings changes', async () => {
    const frozenConfig = {
      ...activeConfig,
      model: 'MiniMax-M2.7',
    };
    mockResolveActiveAgentConfig.mockReturnValue({
      ...activeConfig,
      model: 'MiniMax-M2.5',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', frozenConfig);

    await expect(sendMessage('system prompt', 'follow-up question')).resolves.toBe('final answer');
    expect(mockResolveActiveAgentConfig).not.toHaveBeenCalled();
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      agentConfig: expect.objectContaining({
        model: 'MiniMax-M2.7',
      }),
      toolExecutionSource: 'autoresearch_phase',
    }));
  });

  it('finalizes command-not-found experiment failures as parseable FAILED metrics', async () => {
    mockRunHeadlessAgentTurn
      .mockImplementationOnce(async (input) => {
        await input.onToolCall?.({
          id: 'tool-1',
          name: localCommandTool,
          arguments: '{"command":"python run_experiment.py"}',
        });
        await input.onToolResult?.({
          id: 'tool-1',
          name: localCommandTool,
          result: '{"stdout":"","stderr":"bash: python: command not found\\n","exitCode":127}',
          durationMs: 42,
        });
        throw new Error('phase=agent_execution; message=python command failed');
      })
      .mockResolvedValueOnce({
        finalText: 'recovered answer',
        finalReasoning: '',
      });
    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'switch_command',
      summary: 'Use python3 instead of python.',
      rootCause: 'python command not found',
      nextCommand: 'python3 run_experiment.py',
      nextPlan: 'Retry once with python3.',
      shouldRetry: true,
      confidence: 'high',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig, {
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
      metricName: 'cv_accuracy',
      direction: 'higher',
      maxIterations: 5,
    });

    const result = await sendMessage('system prompt', 'recover please');
    expect(result).toContain('"status": "FAILED"');
    expect(result).toContain('"metricValue": null');
    expect(result).toContain('bash: python: command not found');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Reflection decision: switch_command'),
      metadata: expect.objectContaining({
        action: 'switch_command',
        rootCause: 'python command not found',
      }),
    }));
  });

  it('finalizes the iteration instead of surfacing a run-level reflection failure on tool-round exhaustion', async () => {
    const error = Object.assign(new Error('Exceeded maximum tool rounds (17)'), {
      toolBudgetSummary: createToolBudgetSummary(),
    });
    mockRunHeadlessAgentTurn.mockRejectedValueOnce(error);
    mockRequestReflectionDecision.mockResolvedValue(createReflectionResult({
      decision: {
        action: 'mark_iteration_failed',
        summary: 'The agent exhausted the tool budget without producing the metric.',
        userMessage: 'Tool budget exhausted. Recent key error: python: command not found.',
        shouldRetry: false,
        confidence: 'medium',
      },
    }));

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'reflect please')).resolves.toContain('tool budget exhausted before evaluation completed');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockRequestReflectionDecision).toHaveBeenCalledTimes(1);
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Reflection decision: mark_iteration_failed'),
    }));
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('budget_near_limit:'),
    }));
  });

  it('uses the reflection override without changing the agent execution config', async () => {
    const reflectionConfig = {
      ...activeConfig,
      configId: 'cfg-reflection',
      name: 'Anthropic Reflection',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    } as ResolvedAgentConfig;

    mockRunHeadlessAgentTurn.mockRejectedValueOnce(new Error('Exceeded maximum tool rounds (17)'));
    mockRequestReflectionDecision.mockResolvedValue(createReflectionResult({
      decision: {
        action: 'mark_iteration_failed',
        summary: 'Reflection override answered.',
        userMessage: 'Reflection override answered.',
        shouldRetry: false,
        confidence: 'medium',
      },
    }));

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig, {
      reflectionConfig,
    });

    const result = await sendMessage('system prompt', 'use override');
    expect(result).toContain('__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__');
    expect(result).toContain('"status": "FAILED"');
    expect(result).toContain('Reflection override answered.');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      agentConfig: activeConfig,
    }));
    expect(mockRequestReflectionDecision).toHaveBeenCalledWith(reflectionConfig, expect.anything());
  });

  it('does not retry the same iteration when tool-round exhaustion already consumed the finalize budget', async () => {
    mockRunHeadlessAgentTurn
      .mockRejectedValueOnce(Object.assign(new Error('Exceeded maximum tool rounds (17)'), {
        toolBudgetSummary: createToolBudgetSummary(),
      }));
    mockRequestReflectionDecision.mockResolvedValue(createReflectionResult({
      decision: {
        action: 'continue',
        summary: 'Retry once with a tighter action plan.',
        nextPlan: 'python3 run_experiment.py',
        shouldRetry: true,
        confidence: 'medium',
      },
      parseFailedAttempts: [
        {
          retryCount: 0,
          rawText: 'not json',
          preview: 'not json',
        },
      ],
    }));

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'reflect and continue')).resolves.toContain('tool budget exhausted before evaluation completed');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'REFLECT',
      message: expect.stringContaining('not json'),
    }));
  });

  it('does not retry an expensive experiment command more than once in one iteration', async () => {
    mockRunHeadlessAgentTurn.mockReset();
    mockGetDeterministicRecoveryDecision.mockReturnValue(null);
    mockRunHeadlessAgentTurn.mockImplementation(async (input) => {
      await input.onToolCall?.({
        id: 'tool-1',
        name: localCommandTool,
        arguments: '{"command":"python3 run_experiment.py"}',
      });
      await input.onToolResult?.({
        id: 'tool-1',
        name: localCommandTool,
        result: '{"stdout":"","stderr":"training failed\\n","exitCode":1}',
        durationMs: 42,
      });
      throw new Error('phase=agent_execution; message=training failed');
    });
    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig, {
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
      metricName: 'cv_accuracy',
      direction: 'higher',
      maxIterations: 5,
    });

    await expect(sendMessage('system prompt', 'run once only')).resolves.toContain('training failed');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('repeats the metrics contract and local tool lane in recovery retries', async () => {
    mockGetCurrentRunDir.mockReturnValue({
      iterDir: '/tmp/research/runs/run-1/iter-003',
      codeDir: '/tmp/research/runs/run-1/iter-003/code',
      metricsPath: '/tmp/research/runs/run-1/iter-003/metrics.json',
    });
    mockRunHeadlessAgentTurn
      .mockRejectedValueOnce(new Error('phase=agent_execution; message=disabled ssh tool'))
      .mockResolvedValueOnce({
        finalText: 'recovered with metrics contract',
        finalReasoning: '',
      });
    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'retry_with_plan',
      summary: 'Stay on the local tool lane.',
      rootCause: 'disallowed ssh tool usage',
      nextPlan: 'Use execute_command for the experiment command and read_file/write_file/create_directory for file access. Do not call ssh_exec, ssh_read_file, or ssh_upload_file.',
      shouldRetry: true,
      confidence: 'high',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'recover with local lane')).resolves.toBe('recovered with metrics contract');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(2);
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Allowed tools for this retry: get_current_workspace, execute_command, read_file, write_file, create_directory.'),
      }),
    );
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('/tmp/research/runs/run-1/iter-003/metrics.json'),
      }),
    );
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Do not call ssh_exec, ssh_read_file, or ssh_upload_file.'),
      }),
    );
  });

  it('builds a retry constraint state that removes escalated tools from the next call', () => {
    const { buildAutoResearchRetryConstraintState } = require('../chatAdapter') as typeof import('../chatAdapter');
    const state = buildAutoResearchRetryConstraintState({
      allowedTools: ['get_current_workspace', 'list_files', 'execute_command', 'read_file'],
      blockedTools: ['list_files'],
      decision: {
        nextCommand: 'ls -la',
        nextPlan: 'Use execute_command instead.',
      },
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
    });

    expect(state.allowedTools).toEqual(['get_current_workspace', 'execute_command', 'read_file']);
    expect(state.retryMessages[0]?.content).toContain('HARD CONSTRAINT: do not call list_files.');
    expect(state.retryMessages[0]?.content).toContain('Use execute_command with `ls -la`');
  });

  it('injects a hard disabled-tool constraint into the next retry after repeated list_files attempts', async () => {
    mockRunHeadlessAgentTurn
      .mockImplementationOnce(async (input) => {
        await input.onToolCall?.({
          id: 'tool-1',
          name: 'list_files',
          arguments: '{"path":"."}',
        });
        await input.onToolResult?.({
          id: 'tool-1',
          name: 'list_files',
          result: JSON.stringify({
            error: true,
            error_kind: 'tool_disabled',
            message: 'Tool "list_files" is disabled for this AutoResearch run. Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
            cause: 'Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
          }),
          durationMs: 5,
        });
        await input.onToolCall?.({
          id: 'tool-2',
          name: 'list_files',
          arguments: '{"path":"src"}',
        });
        await input.onToolResult?.({
          id: 'tool-2',
          name: 'list_files',
          result: JSON.stringify({
            error: true,
            error_kind: 'tool_disabled',
            message: 'Tool "list_files" is disabled for this AutoResearch run. Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
            cause: 'Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
          }),
          durationMs: 5,
        });
        throw new Error('phase=agent_execution; message=tool disabled');
      })
      .mockResolvedValueOnce({
        finalText: 'recovered answer',
        finalReasoning: '',
      });
    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'retry_with_plan',
      summary: 'Use execute_command for directory inspection.',
      nextPlan: 'Use execute_command with ls -la instead of list_files.',
      shouldRetry: true,
      confidence: 'high',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'recover after disabled list_files')).resolves.toBe('recovered answer');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(2);
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('HARD CONSTRAINT: do not call list_files.'),
        initialMessages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Use execute_command with `ls -la`'),
          }),
        ]),
      }),
    );
  });

  it('aborts the iteration after three consecutive API request failures', async () => {
    mockRunHeadlessAgentTurn
      .mockRejectedValueOnce(new Error('Streaming request failed: reasoning_content parameter error'))
      .mockRejectedValueOnce(new Error('Streaming request failed: reasoning_content parameter error'))
      .mockRejectedValueOnce(new Error('Streaming request failed: reasoning_content parameter error'));

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'retry api failure')).rejects.toThrow('Provider API request failed 3 times consecutively');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(3);
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('API request failed (3/3)'),
    }));
  });

  it('replays a transcript fixture for the mixed DeepSeek API and disabled-tool recovery path', async () => {
    installChatAdapterTranscriptFixture(deepseekMixedFailureTranscriptFixture.attempts);
    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'retry_with_plan',
      summary: 'Use execute_command for directory inspection.',
      nextPlan: 'Use execute_command with ls -la instead of list_files.',
      shouldRetry: true,
      confidence: 'high',
    });
    mockGetCurrentRunDir.mockReturnValue(deepseekMixedFailureTranscriptFixture.runDir);

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', deepseekMixedFailureTranscriptFixture.userMessage)).resolves.toContain('"metricName": "cv_accuracy"');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(3);
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('API request failed (1/3): Streaming request failed: reasoning_content parameter error'),
    }));
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: `Escalated disabled tool constraint: ${deepseekMixedFailureTranscriptFixture.expected.blockedTool}`,
    }));
    expect(mockGetDeterministicRecoveryDecision).toHaveBeenCalledWith(expect.objectContaining({
      recentToolResults: [
        expect.objectContaining({ tool: 'list_files' }),
        expect.objectContaining({ tool: 'list_files' }),
      ],
      lastError: 'phase=agent_execution; message=tool disabled',
    }));
    const thirdCallInput = mockRunHeadlessAgentTurn.mock.calls[2]?.[0] as {
      workDir: string;
      allowedTools: string[];
      toolExecutionSource: string;
      systemPrompt: string;
      initialMessages: Array<{ role: string; content: string }>;
    };
    expect(thirdCallInput.workDir).toBe(deepseekMixedFailureTranscriptFixture.runDir.iterDir);
    expect(thirdCallInput.allowedTools).toEqual(localToolCatalog);
    expect(thirdCallInput.toolExecutionSource).toBe('autoresearch_phase');
    expect(thirdCallInput.systemPrompt).toContain(`HARD CONSTRAINT: do not call ${deepseekMixedFailureTranscriptFixture.expected.blockedTool}.`);
    expect(thirdCallInput.systemPrompt).toContain(deepseekMixedFailureTranscriptFixture.runDir.metricsPath);
    expect(thirdCallInput.initialMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(deepseekMixedFailureTranscriptFixture.expected.recoveryHint),
      }),
    ]));
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(mockWriteTargetText).toHaveBeenCalledWith(
      expect.anything(),
      deepseekMixedFailureTranscriptFixture.runDir.transcriptPath,
      expect.stringContaining('## User Message'),
    );
    expect(mockAppendTargetText).toHaveBeenCalledWith(
      expect.anything(),
      deepseekMixedFailureTranscriptFixture.runDir.transcriptPath,
      expect.stringContaining('## Tool Call: list_files'),
    );
    expect(mockAppendTargetText).toHaveBeenCalledWith(
      expect.anything(),
      deepseekMixedFailureTranscriptFixture.runDir.transcriptPath,
      expect.stringContaining(deepseekMixedFailureTranscriptFixture.expected.metricsFileName),
    );
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[status] calling provider\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[thinking]\nchecking provider compatibility\n');
  });
});
