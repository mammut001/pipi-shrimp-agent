import fs from 'node:fs';
import path from 'node:path';
import {
  selectRecoveryAttemptPrompt,
  buildIterationFailureExplanation,
  TOOL_BUDGET_EXHAUSTION_FAIL_REASON,
} from '../chatAdapterRecoveryPrompt';
import {
  buildConvergenceRetryPrompt,
  buildRecoveryPrompt,
} from '../chatAdapterSupport';
import { createReasoningBuffer } from '../chatAdapterReasoning';
import {
  createAutoResearchToolHooks,
  type AutoResearchToolCallRecord,
} from '../chatAdapterToolHooks';
import type { AutoResearchReflectionDecision } from '../reflection';
import type { AutoResearchRunPhase } from '../history';
import * as toolLanes from '../toolLanes';
import * as chatAdapter from '../chatAdapter';

const mockAppendLiveOutput = jest.fn();
const mockAddRunEvent = jest.fn();
const mockPatchIterationRecord = jest.fn();
const mockEmitAutoResearchRuntimeEvent = jest.fn();
const mockSetAutoResearchPhase = jest.fn();
const mockAppendIterationTranscript = jest.fn();

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => ({
      currentIteration: 2,
      sshConfig: { mode: 'local' },
      appendLiveOutput: mockAppendLiveOutput,
      addRunEvent: mockAddRunEvent,
      patchIterationRecord: mockPatchIterationRecord,
    }),
  },
}));

jest.mock('../runtimeEvents', () => ({
  emitAutoResearchRuntimeEvent: (...args: unknown[]) => mockEmitAutoResearchRuntimeEvent(...args),
  setAutoResearchPhase: (...args: unknown[]) => mockSetAutoResearchPhase(...args),
}));

jest.mock('../chatAdapterSupport', () => {
  const actual = jest.requireActual('../chatAdapterSupport');
  return {
    ...actual,
    appendIterationTranscript: (...args: unknown[]) => mockAppendIterationTranscript(...args),
  };
});

jest.mock('../toolLanes', () => {
  const actual = jest.requireActual('../toolLanes');
  return {
    __esModule: true,
    ...actual,
    isAutoResearchToolLaneTransitionAllowed: jest.fn(actual.isAutoResearchToolLaneTransitionAllowed),
    classifyAutoResearchToolPhase: jest.fn(actual.classifyAutoResearchToolPhase),
    getAutoResearchAllowedToolsForPhase: jest.fn(actual.getAutoResearchAllowedToolsForPhase),
  };
});

describe('chatAdapter extraction tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('selectRecoveryAttemptPrompt', () => {
    const baseDecision: AutoResearchReflectionDecision = {
      action: 'retry',
      summary: 'Try alternative hyperparameters',
      userMessage: 'Retry training with lower learning rate',
      nextPlan: 'adjust lr',
      shouldRetry: true,
      confidence: 'high',
    };
    const systemPrompt = 'You are an autonomous ML research assistant.';
    const failureKind = 'tool_round_limit';
    const allowedTools = ['execute_command', 'read_file', 'write_file'];
    const hardConstraintLines = ['- HARD RULE: do not edit dataset'];

    it('selects recovery prompt for switch_command branch', () => {
      const switchDecision: AutoResearchReflectionDecision = {
        ...baseDecision,
        action: 'switch_command',
        nextCommand: 'python train_secondary.py',
      };

      const result = selectRecoveryAttemptPrompt({
        systemPrompt,
        decision: switchDecision,
        failureKind,
        allowedTools,
        hardConstraintLines,
        error: new Error('exceeded maximum tool rounds (6)'),
      });

      const expected = buildRecoveryPrompt(
        systemPrompt,
        switchDecision,
        failureKind,
        allowedTools,
        hardConstraintLines,
      );

      expect(result).toBe(expected);
    });

    it('selects recovery prompt with convergence retry prompt for tool-round-limit branch (from error)', () => {
      const error = new Error('Agent execution failed: exceeded maximum tool rounds (8)');

      const result = selectRecoveryAttemptPrompt({
        systemPrompt,
        decision: baseDecision,
        failureKind,
        allowedTools,
        hardConstraintLines,
        error,
      });

      const expectedConvergence = buildConvergenceRetryPrompt(
        systemPrompt,
        8,
        allowedTools,
        hardConstraintLines,
      );
      const expected = buildRecoveryPrompt(
        expectedConvergence,
        baseDecision,
        failureKind,
        allowedTools,
        hardConstraintLines,
      );

      expect(result).toBe(expected);
    });

    it('selects default recovery prompt for non-tool-round-limit error', () => {
      const error = new Error('SyntaxError: unexpected token');

      const result = selectRecoveryAttemptPrompt({
        systemPrompt,
        decision: baseDecision,
        failureKind: 'agent_execution',
        allowedTools,
        hardConstraintLines,
        error,
      });

      const expected = buildRecoveryPrompt(
        systemPrompt,
        baseDecision,
        'agent_execution',
        allowedTools,
        hardConstraintLines,
      );

      expect(result).toBe(expected);
    });
  });

  describe('buildIterationFailureExplanation', () => {
    const decision: AutoResearchReflectionDecision = {
      action: 'mark_iteration_failed',
      summary: 'Failure encountered',
      userMessage: 'Iteration failed due to timeout',
      rootCause: 'OOM error',
      shouldRetry: false,
      confidence: 'medium',
    };

    it('handles tool round limit error', () => {
      const error = new Error('exceeded maximum tool rounds (5)');
      const result = buildIterationFailureExplanation({
        error,
        decision,
      });

      expect(result.failReason).toBe(TOOL_BUDGET_EXHAUSTION_FAIL_REASON);
      expect(result.reasoning).toBe('Failure encountered Root cause: OOM error');
    });

    it('handles experiment command failure', () => {
      const error = new Error('Some execution error');
      const experimentFailure = {
        tool: 'execute_command',
        command: 'python train.py',
        exitCode: 1,
        stderr: 'CUDA out of memory',
      };

      const result = buildIterationFailureExplanation({
        error,
        decision,
        experimentFailure,
      });

      expect(result.failReason).toBe('CUDA out of memory');
      expect(result.reasoning).toBe('CUDA out of memory');
    });

    it('handles generic error fallback', () => {
      const error = new Error('Connection reset');
      const result = buildIterationFailureExplanation({
        error,
        decision: {
          ...decision,
          userMessage: undefined,
        },
      });

      expect(result.failReason).toBe('Failure encountered');
      expect(result.reasoning).toBe('Failure encountered');
    });
  });

  describe('createReasoningBuffer', () => {
    it('uses fallback only when buffer is empty', () => {
      const buffer = createReasoningBuffer();
      buffer.append('Original model thoughts');
      buffer.flush('Fallback thoughts');

      expect(mockAppendLiveOutput).toHaveBeenCalledWith('[thinking]\nOriginal model thoughts\n');
      expect(mockEmitAutoResearchRuntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          message: 'Original model thoughts',
        }),
      );

      mockAppendLiveOutput.mockClear();
      mockEmitAutoResearchRuntimeEvent.mockClear();

      const emptyBuffer = createReasoningBuffer();
      emptyBuffer.flush('Fallback thoughts used');

      expect(mockAppendLiveOutput).toHaveBeenCalledWith('[thinking]\nFallback thoughts used\n');
      expect(mockEmitAutoResearchRuntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          message: 'Fallback thoughts used',
        }),
      );
    });

    it('flushes at most once', () => {
      const buffer = createReasoningBuffer();
      buffer.append('Single thought trace');
      buffer.flush();
      buffer.flush('Should be ignored');
      buffer.flush();

      expect(mockAppendLiveOutput).toHaveBeenCalledTimes(1);
      expect(mockEmitAutoResearchRuntimeEvent).toHaveBeenCalledTimes(2); // thinking + agent_plan
    });

    it('trims whitespace', () => {
      const buffer = createReasoningBuffer();
      buffer.append('   \n  Padded thought content \t \n ');
      buffer.flush();

      expect(mockAppendLiveOutput).toHaveBeenCalledWith('[thinking]\nPadded thought content\n');
      expect(mockEmitAutoResearchRuntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Padded thought content',
        }),
      );
    });

    it('produces no output when empty or only whitespace', () => {
      const buffer = createReasoningBuffer();
      buffer.flush();

      expect(mockAppendLiveOutput).not.toHaveBeenCalled();
      expect(mockEmitAutoResearchRuntimeEvent).not.toHaveBeenCalled();

      const whitespaceBuffer = createReasoningBuffer();
      whitespaceBuffer.append('   \n\t  ');
      whitespaceBuffer.flush();

      expect(mockAppendLiveOutput).not.toHaveBeenCalled();
      expect(mockEmitAutoResearchRuntimeEvent).not.toHaveBeenCalled();
    });
  });

  describe('createAutoResearchToolHooks', () => {
    it('allowToolExecution denies a tool not allowed in the phase', () => {
      const toolLane = { phase: 'READ_CONTEXT' as AutoResearchRunPhase };
      const toolCallsById = new Map<string, AutoResearchToolCallRecord>();
      const toolResults: any[] = [];
      const failedCommands: string[] = [];

      (toolLanes.getAutoResearchAllowedToolsForPhase as jest.Mock).mockReturnValueOnce(['read_file']);

      const hooks = createAutoResearchToolHooks({
        toolLane,
        toolCallsById,
        toolResults,
        failedCommands,
      });

      const decision = hooks.allowToolExecution({
        id: 'call-1',
        name: 'write_file',
        arguments: '{"path":"main.py","content":"print(1)"}',
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Tool "write_file" is not allowed');
    });

    it('allowToolExecution denies illegal lane transition', () => {
      const toolLane = { phase: 'RUN_EXPERIMENT' as AutoResearchRunPhase };
      const toolCallsById = new Map<string, AutoResearchToolCallRecord>();
      const toolResults: any[] = [];
      const failedCommands: string[] = [];

      (toolLanes.getAutoResearchAllowedToolsForPhase as jest.Mock).mockReturnValueOnce(['read_file']);
      (toolLanes.isAutoResearchToolLaneTransitionAllowed as jest.Mock).mockReturnValueOnce(false);

      const hooks = createAutoResearchToolHooks({
        toolLane,
        toolCallsById,
        toolResults,
        failedCommands,
      });

      const decision = hooks.allowToolExecution({
        id: 'call-2',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Tool lane transition RUN_EXPERIMENT ->');
    });

    it('allowToolExecution updates toolLane.phase on allow', () => {
      const toolLane = { phase: 'READ_CONTEXT' as AutoResearchRunPhase };
      const toolCallsById = new Map<string, AutoResearchToolCallRecord>();
      const toolResults: any[] = [];
      const failedCommands: string[] = [];

      (toolLanes.getAutoResearchAllowedToolsForPhase as jest.Mock).mockReturnValueOnce(['write_file']);
      (toolLanes.isAutoResearchToolLaneTransitionAllowed as jest.Mock).mockReturnValueOnce(true);
      (toolLanes.classifyAutoResearchToolPhase as jest.Mock).mockReturnValueOnce('EDIT_CODE');

      const hooks = createAutoResearchToolHooks({
        toolLane,
        toolCallsById,
        toolResults,
        failedCommands,
      });

      const decision = hooks.allowToolExecution({
        id: 'call-3',
        name: 'write_file',
        arguments: '{"path":"train.py"}',
      });

      expect(decision.allowed).toBe(true);
      expect(toolLane.phase).toBe('EDIT_CODE');
    });

    it('shares the toolLane holder across per-attempt hook instances (lane persists across retries)', () => {
      const toolLane = { phase: 'READ_CONTEXT' as AutoResearchRunPhase };
      (toolLanes.getAutoResearchAllowedToolsForPhase as jest.Mock).mockReturnValueOnce(['write_file']);
      (toolLanes.isAutoResearchToolLaneTransitionAllowed as jest.Mock).mockReturnValueOnce(true);
      (toolLanes.classifyAutoResearchToolPhase as jest.Mock).mockReturnValueOnce('EDIT_CODE');

      const firstAttempt = createAutoResearchToolHooks({
        toolLane,
        toolCallsById: new Map(),
        toolResults: [],
        failedCommands: [],
      });
      firstAttempt.allowToolExecution({ id: 'a1', name: 'write_file', arguments: '{"path":"train.py"}' });
      expect(toolLane.phase).toBe('EDIT_CODE');

      const secondAttempt = createAutoResearchToolHooks({
        toolLane,
        toolCallsById: new Map(),
        toolResults: [],
        failedCommands: [],
      });
      secondAttempt.allowToolExecution({ id: 'a2', name: 'read_file', arguments: '{"path":"README.md"}' });
      expect(toolLanes.classifyAutoResearchToolPhase).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPhase: 'EDIT_CODE', toolName: 'read_file' }),
      );
    });

    it('onToolResult pushes failed command into failedCommands when exitCode !== 0 or stderr present', async () => {
      const toolLane = { phase: 'EDIT_CODE' as AutoResearchRunPhase };
      const toolCallsById = new Map<string, AutoResearchToolCallRecord>();
      const toolResults: any[] = [];
      const failedCommands: string[] = [];

      const hooks = createAutoResearchToolHooks({
        toolLane,
        toolCallsById,
        toolResults,
        failedCommands,
      });

      toolCallsById.set('call-err', {
        name: 'execute_command',
        command: 'python broken_script.py',
        argumentsText: '{"command":"python broken_script.py"}',
      });

      await hooks.onToolResult({
        id: 'call-err',
        name: 'execute_command',
        result: JSON.stringify({ exitCode: 1, stderr: 'ModuleNotFoundError' }),
        durationMs: 120,
      });

      expect(failedCommands).toContain('python broken_script.py');

      // Command with success should not be pushed to failedCommands
      toolCallsById.set('call-ok', {
        name: 'execute_command',
        command: 'python good_script.py',
        argumentsText: '{"command":"python good_script.py"}',
      });

      await hooks.onToolResult({
        id: 'call-ok',
        name: 'execute_command',
        result: JSON.stringify({ exitCode: 0, stdout: 'Success' }),
        durationMs: 80,
      });

      expect(failedCommands).not.toContain('python good_script.py');
    });
  });

  describe('source guards', () => {
    const autoresearchDir = path.resolve(__dirname, '..');
    const modules = [
      'chatAdapter.ts',
      'chatAdapterReflectionEvents.ts',
      'chatAdapterReasoning.ts',
      'chatAdapterToolHooks.ts',
      'chatAdapterRecoveryPrompt.ts',
    ];

    it.each(modules)('module %s is under 500 lines and contains no dynamic imports or require', (filename) => {
      const filePath = path.join(autoresearchDir, filename);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      expect(lines.length).toBeLessThan(500);
      expect(content).not.toContain('import(');
      expect(content).not.toContain('require(');
    });

    it('chatAdapter.ts preserves stable exports', () => {
      expect(typeof chatAdapter.createAutoResearchSendMessage).toBe('function');
      expect(typeof chatAdapter.parseToolResult).toBe('function');
      expect(typeof chatAdapter.buildAutoResearchRetryConstraintState).toBe('function');
    });
  });
});
