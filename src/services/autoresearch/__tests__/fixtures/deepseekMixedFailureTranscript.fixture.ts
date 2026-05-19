export interface AutoResearchTranscriptToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AutoResearchTranscriptToolResult {
  id: string;
  name: string;
  result: string;
  durationMs: number;
}

export type AutoResearchTranscriptEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_summary'; toolName: string; preview: string }
  | { type: 'tool_call'; call: AutoResearchTranscriptToolCall }
  | { type: 'tool_result'; result: AutoResearchTranscriptToolResult }
  | { type: 'assistant_message'; content: string };

export interface AutoResearchTranscriptAttempt {
  events: AutoResearchTranscriptEvent[];
  error?: string;
  finalText?: string;
  finalReasoning?: string;
}

export interface AutoResearchTranscriptFixture {
  userMessage: string;
  runDir: {
    iterDir: string;
    codeDir: string;
    transcriptPath: string;
    metricsPath: string;
  };
  attempts: AutoResearchTranscriptAttempt[];
  expected: {
    blockedTool: string;
    recoveryHint: string;
    metricsFileName: string;
  };
}

const fixtureRunDir = {
  iterDir: '/tmp/research/runs/run-1/iter-003',
  codeDir: '/tmp/research/runs/run-1/iter-003/code',
  transcriptPath: '/tmp/research/runs/run-1/iter-003/transcript.md',
  metricsPath: '/tmp/research/runs/run-1/iter-003/metrics.json',
};

const disabledListFilesMessage = 'Tool "list_files" is disabled for this AutoResearch run. Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory';

const finalMetricsJson = JSON.stringify({
  metricName: 'cv_accuracy',
  metricValue: null,
  status: 'FAILED',
  hypothesis: 'provider request recovered but directory inspection had to stay constrained',
  change: 'Skipped list_files and wrote the failure result after constrained inspection.',
  reasoning: 'The first DeepSeek call failed on reasoning_content. A later retry repeated disabled list_files calls, so the next attempt used execute_command with ls -la and wrote metrics.json instead of retrying the dead end.',
  artifactPaths: ['metrics.json'],
  failReason: 'list_files disabled for this AutoResearch run',
}, null, 2);

export const deepseekMixedFailureTranscriptFixture: AutoResearchTranscriptFixture = {
  userMessage: 'recover after mixed provider and tool failures',
  runDir: fixtureRunDir,
  attempts: [
    {
      events: [
        { type: 'status', message: 'calling provider' },
        { type: 'reasoning_delta', content: 'checking provider compatibility' },
      ],
      error: 'Streaming request failed: reasoning_content parameter error',
    },
    {
      events: [
        { type: 'status', message: 'inspecting workspace' },
        {
          type: 'tool_call',
          call: { id: 'tool-1', name: 'list_files', arguments: '{"path":"."}' },
        },
        {
          type: 'tool_result',
          result: {
            id: 'tool-1',
            name: 'list_files',
            result: JSON.stringify({
              error: true,
              error_kind: 'tool_disabled',
              message: disabledListFilesMessage,
              cause: 'Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
            }),
            durationMs: 5,
          },
        },
        {
          type: 'tool_summary',
          toolName: 'list_files',
          preview: disabledListFilesMessage,
        },
        {
          type: 'tool_call',
          call: { id: 'tool-2', name: 'list_files', arguments: '{"path":"src"}' },
        },
        {
          type: 'tool_result',
          result: {
            id: 'tool-2',
            name: 'list_files',
            result: JSON.stringify({
              error: true,
              error_kind: 'tool_disabled',
              message: disabledListFilesMessage,
              cause: 'Allowed tools: get_current_workspace, execute_command, read_file, write_file, create_directory',
            }),
            durationMs: 5,
          },
        },
        {
          type: 'tool_summary',
          toolName: 'list_files',
          preview: disabledListFilesMessage,
        },
      ],
      error: 'phase=agent_execution; message=tool disabled',
    },
    {
      events: [
        { type: 'status', message: 'retrying with constrained tools' },
        {
          type: 'tool_call',
          call: {
            id: 'tool-3',
            name: 'execute_command',
            arguments: '{"command":"ls -la","cwd":"/tmp/research/runs/run-1/iter-003"}',
          },
        },
        {
          type: 'tool_result',
          result: {
            id: 'tool-3',
            name: 'execute_command',
            result: JSON.stringify({
              stdout: 'total 16\n-rw-r--r--  1 test  staff  512 metrics.json\n',
              stderr: '',
              exitCode: 0,
            }),
            durationMs: 11,
          },
        },
        {
          type: 'tool_summary',
          toolName: 'execute_command',
          preview: 'total 16 | metrics.json',
        },
        {
          type: 'tool_call',
          call: {
            id: 'tool-4',
            name: 'write_file',
            arguments: JSON.stringify({
              path: '/tmp/research/runs/run-1/iter-003/metrics.json',
              content: finalMetricsJson,
            }),
          },
        },
        {
          type: 'tool_result',
          result: {
            id: 'tool-4',
            name: 'write_file',
            result: 'File written successfully',
            durationMs: 7,
          },
        },
        {
          type: 'tool_summary',
          toolName: 'write_file',
          preview: 'metrics.json written',
        },
        { type: 'assistant_message', content: finalMetricsJson },
      ],
      finalText: finalMetricsJson,
      finalReasoning: '',
    },
  ],
  expected: {
    blockedTool: 'list_files',
    recoveryHint: 'Use execute_command with `ls -la`',
    metricsFileName: 'metrics.json',
  },
};

const budgetExhaustedMetricsJson = JSON.stringify({
  metricName: 'cv_accuracy',
  metricValue: 0.9777,
  status: 'IMPROVED',
  hypothesis: 'metrics were already written before the tool budget ran out',
  change: 'Persist the successful metrics artifact before the host finalizes the iteration.',
  reasoning: 'The iteration managed to write metrics.json before the tool-round limit tripped, so the host should trust the artifact instead of the fallback failure payload.',
  artifactPaths: ['metrics.json'],
}, null, 2);

export const deepseekBudgetExhaustedAfterMetricsFixture: AutoResearchTranscriptFixture = {
  userMessage: 'finalize after metrics.json was already written',
  runDir: fixtureRunDir,
  attempts: [
    {
      events: [
        { type: 'status', message: 'writing metrics before budget exhaustion' },
        {
          type: 'tool_call',
          call: {
            id: 'tool-1',
            name: 'write_file',
            arguments: JSON.stringify({
              path: '/tmp/research/runs/run-1/iter-003/metrics.json',
              content: budgetExhaustedMetricsJson,
            }),
          },
        },
        {
          type: 'tool_result',
          result: {
            id: 'tool-1',
            name: 'write_file',
            result: 'File written successfully',
            durationMs: 9,
          },
        },
        {
          type: 'tool_summary',
          toolName: 'write_file',
          preview: 'metrics.json written before budget exhaustion',
        },
      ],
      error: 'Exceeded maximum tool rounds (17)',
    },
  ],
  expected: {
    blockedTool: '',
    recoveryHint: '',
    metricsFileName: 'metrics.json',
  },
};

export const deepseekThreeConsecutiveApiFailuresFixture: AutoResearchTranscriptFixture = {
  userMessage: 'abort after three provider request failures',
  runDir: fixtureRunDir,
  attempts: [
    {
      events: [
        { type: 'status', message: 'calling provider attempt 1' },
        { type: 'reasoning_delta', content: 'checking provider compatibility' },
      ],
      error: 'Streaming request failed: reasoning_content parameter error',
    },
    {
      events: [
        { type: 'status', message: 'calling provider attempt 2' },
      ],
      error: 'Streaming request failed: reasoning_content parameter error',
    },
    {
      events: [
        { type: 'status', message: 'calling provider attempt 3' },
      ],
      error: 'Streaming request failed: reasoning_content parameter error',
    },
  ],
  expected: {
    blockedTool: '',
    recoveryHint: '',
    metricsFileName: 'metrics.json',
  },
};