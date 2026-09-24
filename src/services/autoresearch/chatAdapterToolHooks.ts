import { useAutoResearchStore } from '@/store/autoresearchStore';
import type { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import type { AutoResearchEnvironmentSummary } from './preflight';
import type { AutoResearchRunPhase } from './history';
import type { AutoResearchObservedToolResult } from './reflection';
import { parseToolCommand, parseToolResult } from './chatAdapterHelpers';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import {
  buildAutoResearchToolLaneError,
  classifyAutoResearchToolPhase,
  getAutoResearchAllowedToolsForPhase,
  isAutoResearchToolLaneTransitionAllowed,
} from './toolLanes';
import {
  appendIterationTranscript,
  isExperimentRunCommand,
  previewFirstLines,
  readToolPath,
  summarizeToolInput,
  truncateTranscriptResult,
} from './chatAdapterSupport';

type HeadlessTurnOptions = Parameters<typeof runHeadlessAgentTurn>[0];
export type AutoResearchAllowToolExecution = NonNullable<HeadlessTurnOptions['allowToolExecution']>;
export type AutoResearchOnToolCall = NonNullable<HeadlessTurnOptions['onToolCall']>;
export type AutoResearchOnToolResult = NonNullable<HeadlessTurnOptions['onToolResult']>;

export interface AutoResearchToolCallRecord {
  name: string;
  command?: string;
  argumentsText: string;
  path?: string;
  phase?: AutoResearchRunPhase;
}

export interface AutoResearchToolLaneState {
  phase: AutoResearchRunPhase;
}

export interface AutoResearchToolHooksContext {
  toolLane: AutoResearchToolLaneState;
  toolCallsById: Map<string, AutoResearchToolCallRecord>;
  toolResults: AutoResearchObservedToolResult[];
  failedCommands: string[];
  environmentSummary?: AutoResearchEnvironmentSummary;
}

export interface AutoResearchToolHooks {
  allowToolExecution: AutoResearchAllowToolExecution;
  onToolCall: AutoResearchOnToolCall;
  onToolResult: AutoResearchOnToolResult;
}

export function createAutoResearchToolHooks(ctx: AutoResearchToolHooksContext): AutoResearchToolHooks {
  const { toolLane, toolCallsById, toolResults, failedCommands, environmentSummary } = ctx;

  return {
    allowToolExecution: (call) => {
      const command = parseToolCommand(call);
      const nextPhase = classifyAutoResearchToolPhase({
        currentPhase: toolLane.phase,
        toolName: call.name,
        isExperimentRun: isExperimentRunCommand(command, environmentSummary),
        config: useAutoResearchStore.getState().sshConfig,
      });
      const phaseAllowedTools = getAutoResearchAllowedToolsForPhase(
        useAutoResearchStore.getState().sshConfig,
        nextPhase,
      );

      if (!phaseAllowedTools.includes(call.name)) {
        return {
          allowed: false,
          reason: buildAutoResearchToolLaneError(call.name, nextPhase, phaseAllowedTools),
        };
      }

      if (!isAutoResearchToolLaneTransitionAllowed(toolLane.phase, nextPhase)) {
        return {
          allowed: false,
          reason: `Tool lane transition ${toolLane.phase} -> ${nextPhase} is not allowed in the same iteration.`,
        };
      }

      toolLane.phase = nextPhase;
      return { allowed: true };
    },
    onToolCall: async (call) => {
      const command = parseToolCommand(call);
      const path = readToolPath(call.arguments);
      const parameterSummary = summarizeToolInput(call.arguments);
      const toolPhase = classifyAutoResearchToolPhase({
        currentPhase: toolLane.phase,
        toolName: call.name,
        isExperimentRun: isExperimentRunCommand(command, environmentSummary),
        config: useAutoResearchStore.getState().sshConfig,
      });
      toolCallsById.set(call.id, {
        name: call.name,
        command,
        argumentsText: call.arguments,
        path,
        phase: toolPhase,
      });
      if (toolPhase === 'RUN_EXPERIMENT') {
        setAutoResearchPhase('RUN_EXPERIMENT', {
          summary: `Running experiment command for iteration ${useAutoResearchStore.getState().currentIteration}.`,
        });
        useAutoResearchStore.getState().patchIterationRecord({
          iteration: useAutoResearchStore.getState().currentIteration,
          executionCommand: command,
        });
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'RUN_EXPERIMENT',
          type: 'experiment_command_started',
          message: command ?? '',
          summary: parameterSummary,
          metadata: {
            toolName: call.name,
            command,
          },
        });
      } else {
        setAutoResearchPhase(toolPhase, {
          summary: `Tool ${call.name} is running in ${toolPhase}.`,
        });
      }
      emitAutoResearchRuntimeEvent({
        level: 'info',
        phase: toolPhase,
        type: 'tool_call_started',
        message: `${call.name} started.`,
        summary: parameterSummary,
        metadata: {
          toolName: call.name,
          arguments: call.arguments,
          command,
          path,
          phase: toolPhase,
          parameterSummary,
        },
      });
      await appendIterationTranscript(
        `\n## Tool Call: ${call.name}\n\`\`\`json\n${call.arguments || '{}'}\n\`\`\`\n`,
      );
    },
    onToolResult: async (call) => {
      const toolCall = toolCallsById.get(call.id);
      const observed = parseToolResult(call, toolCall?.command);
      toolResults.push(observed);
      if (observed.command && ((typeof observed.exitCode === 'number' && observed.exitCode !== 0) || observed.stderr)) {
        failedCommands.push(observed.command);
      }
      const toolFailed = (typeof observed.exitCode === 'number' && observed.exitCode !== 0) || Boolean(observed.stderr);
      const toolPhase = toolCall?.phase ?? classifyAutoResearchToolPhase({
        currentPhase: toolLane.phase,
        toolName: call.name,
        isExperimentRun: isExperimentRunCommand(observed.command, environmentSummary),
        config: useAutoResearchStore.getState().sshConfig,
      });
      emitAutoResearchRuntimeEvent({
        level: toolFailed ? 'warn' : 'info',
        phase: toolPhase,
        type: toolFailed ? 'tool_call_failed' : 'tool_call_completed',
        message: `${call.name} ${toolFailed ? 'failed' : 'completed'}.`,
        summary: toolFailed
          ? (observed.stderr || `Exit code ${observed.exitCode ?? 'unknown'}`)
          : `${call.name} completed in ${call.durationMs} ms.`,
        metadata: {
          toolName: call.name,
          command: observed.command,
          durationMs: call.durationMs,
          exitCode: observed.exitCode,
          phase: toolPhase,
          path: toolCall?.path,
        },
      });
      emitAutoResearchRuntimeEvent({
        level: toolFailed ? 'warn' : 'debug',
        phase: toolPhase,
        type: 'tool_result',
        message: previewFirstLines(call.result, 10) || '(empty tool result)',
        summary: `${call.name} output`,
        detail: call.result,
        metadata: {
          toolName: call.name,
          durationMs: call.durationMs,
          exitCode: observed.exitCode,
        },
      });
      if (toolCall?.path && !toolFailed && ['write_file', 'ssh_upload_file'].includes(call.name)) {
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'EDIT_CODE',
          type: 'file_changed',
          message: toolCall.path,
          summary: `Updated ${toolCall.path}`,
          metadata: {
            toolName: call.name,
            path: toolCall.path,
          },
        });
      }
      if (observed.command && isExperimentRunCommand(observed.command, environmentSummary)) {
        useAutoResearchStore.getState().patchIterationRecord({
          iteration: useAutoResearchStore.getState().currentIteration,
          executionCommand: observed.command,
          exitCode: observed.exitCode,
          durationMs: call.durationMs,
        });
        emitAutoResearchRuntimeEvent({
          level: toolFailed ? 'warn' : 'info',
          phase: 'RUN_EXPERIMENT',
          type: 'experiment_command_completed',
          message: observed.command,
          summary: toolFailed
            ? `Experiment command failed${typeof observed.exitCode === 'number' ? ` with exit code ${observed.exitCode}` : ''}.`
            : 'Experiment command completed.',
          metadata: {
            toolName: call.name,
            command: observed.command,
            durationMs: call.durationMs,
            exitCode: observed.exitCode,
            stderrPreview: observed.stderr ? previewFirstLines(observed.stderr, 10) : undefined,
          },
        });
      }
      await appendIterationTranscript(
        `\n## Tool Result: ${call.name} (${call.durationMs}ms)\n\`\`\`text\n${truncateTranscriptResult(call.result)}\n\`\`\`\n`,
      );
    },
  };
}
