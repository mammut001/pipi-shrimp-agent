import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WorkflowAgent } from '@/types/workflow';

const mockRunHeadlessAgentTurn = jest.fn<(...args: any[]) => Promise<any>>();
const mockInvoke = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: jest.fn(async () => () => undefined),
  }),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      apiConfigs: [],
      getActiveConfig: () => ({
        id: 'cfg-default',
        provider: 'anthropic',
        apiKey: 'sk-ant-test-key',
        model: 'claude-3-5-sonnet',
        baseUrl: '',
        apiFormat: 'anthropic',
      }),
      windowsShellProfile: 'auto',
    }),
  },
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (params: any) => mockRunHeadlessAgentTurn(params),
}));

import { clearAll } from '@/services/swarm/repository';
import { notifyOnComplete, readAgentInbox } from '@/services/workflowNotifier';
import { buildDownstreamAgentPrompt } from '@/services/workflowPromptBuilder';
import { runAgentWithRetry } from '../agentRunner';
import { WorkflowTranscriptManager } from '../transcript';

const WRITTEN_PATH = 'notes/handoff.md';

function createAgent(
  id: string,
  name: string,
  notifyOnComplete?: string[],
  notifyFullOutputAgentIds?: string[],
): WorkflowAgent {
  return {
    id,
    name,
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    notifyOnComplete,
    notifyFullOutputAgentIds,
    role: 'custom',
  };
}

function downstreamPrompt(agent: WorkflowAgent, inbox: ReturnType<typeof readAgentInbox>): string {
  return buildDownstreamAgentPrompt({
    projectGoal: 'Keep the file-write handoff',
    successCriteria: ['the downstream agent can see the written path'],
    agent,
    upstreams: [],
    inboxMessages: inbox,
    iteration: 1,
    previousEvaluation: null,
  });
}

describe('workflow file-write handoff', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRunHeadlessAgentTurn.mockReset();
    mockInvoke.mockReset();
    await clearAll();
  });

  it('passes a file-write path through summary and full-output handoff when assistant text is empty', async () => {
    const toolResult = `Wrote ${WRITTEN_PATH}\n${'x'.repeat(2000)}`;
    mockRunHeadlessAgentTurn.mockImplementation(async (params) => {
      await params.onToolCall?.({
        id: 'call-write-1',
        name: 'write_file',
        arguments: JSON.stringify({
          file_path: WRITTEN_PATH,
          content: 'handoff body',
        }),
      });
      await params.onToolResult?.({
        id: 'call-write-1',
        name: 'write_file',
        result: toolResult,
        durationMs: 4,
      });
      return {
        finalText: '',
        finalReasoning: '',
        toolBudgetSummary: { totalRounds: 1 },
      };
    });

    const writer = createAgent('writer', 'Writer');
    const output = await runAgentWithRetry(writer, 'Write the note', {
      runId: 'run-file-write',
      transcript: new WorkflowTranscriptManager(),
    });

    expect(output.trim()).not.toBe('');
    expect(output.slice(0, 600)).toContain(WRITTEN_PATH);
    expect(output.slice(0, 600)).toContain('Wrote notes/handoff.md');

    const coder = createAgent('coder', 'Coder');
    const summaryWriter = createAgent('writer', 'Writer', ['coder']);
    await notifyOnComplete(summaryWriter, [summaryWriter, coder], output, 'run-summary');
    const summaryInbox = readAgentInbox('coder', 'run-summary', [summaryWriter, coder]);
    const summaryPrompt = downstreamPrompt(coder, summaryInbox);
    expect(summaryPrompt.trim()).not.toBe('');
    expect(summaryPrompt).toContain(WRITTEN_PATH);
    expect(summaryInbox[0]?.summary.slice(0, 600)).toContain(WRITTEN_PATH);
    expect(summaryInbox[0]?.full).toBeUndefined();

    const fullWriter = createAgent('writer', 'Writer', ['coder'], ['coder']);
    await notifyOnComplete(fullWriter, [fullWriter, coder], output, 'run-full');
    const fullInbox = readAgentInbox('coder', 'run-full', [fullWriter, coder]);
    const fullPrompt = downstreamPrompt(coder, fullInbox);
    expect(fullPrompt.trim()).not.toBe('');
    expect(fullPrompt).toContain(WRITTEN_PATH);
    expect(fullInbox[0]?.full).toContain(WRITTEN_PATH);
  });

  it('keeps non-empty assistant text instead of replacing it with the file-write log', async () => {
    const assistantText = '  Assistant kept this text.  ';
    mockRunHeadlessAgentTurn.mockImplementation(async (params) => {
      await params.onToolCall?.({
        id: 'call-write-2',
        name: 'FileWrite',
        arguments: JSON.stringify({ file_path: 'skip-me.txt', content: 'nope' }),
      });
      await params.onToolResult?.({
        id: 'call-write-2',
        name: 'FileWrite',
        result: 'Wrote skip-me.txt',
        durationMs: 1,
      });
      return {
        finalText: assistantText,
        finalReasoning: '',
        toolBudgetSummary: { totalRounds: 1 },
      };
    });

    const output = await runAgentWithRetry(createAgent('writer', 'Writer'), 'Explain the change', {
      runId: 'run-text',
      transcript: new WorkflowTranscriptManager(),
    });

    expect(output).toBe(assistantText);
    expect(output).not.toContain('skip-me.txt');
  });

  it('does not invent handoff text when the turn has neither assistant text nor a file write', async () => {
    mockRunHeadlessAgentTurn.mockImplementation(async (params) => {
      await params.onToolCall?.({
        id: 'call-bash',
        name: 'Bash',
        arguments: JSON.stringify({ command: 'ls' }),
      });
      await params.onToolResult?.({
        id: 'call-bash',
        name: 'Bash',
        result: 'README.md',
        durationMs: 1,
      });
      return {
        finalText: '',
        finalReasoning: '',
        toolBudgetSummary: { totalRounds: 1 },
      };
    });

    const output = await runAgentWithRetry(createAgent('writer', 'Writer'), 'Look around', {
      runId: 'run-bash',
      transcript: new WorkflowTranscriptManager(),
    });

    expect(output).toBe('');
  });
});
