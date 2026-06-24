import type {
  AutoResearchTranscriptAttempt,
  AutoResearchTranscriptEvent,
  AutoResearchTranscriptFixture,
} from './fixtures/deepseekMixedFailureTranscript.fixture';

export interface TranscriptRunDirPaths {
  iterDir: string;
  transcriptPath: string;
  metricsPath: string;
}

export interface TranscriptReplayOptions {
  onWriteFile?: (payload: { path: string; content: string }) => Promise<void> | void;
}

interface TranscriptMockTarget {
  mockImplementation: (fn: (input: Record<string, unknown>) => Promise<{ finalText: string; finalReasoning: string }>) => unknown;
}

function parseWriteFilePayload(argumentsText: string): { path: string; content: string } | null {
  try {
    const payload = JSON.parse(argumentsText) as { path?: unknown; content?: unknown };
    if (typeof payload.path !== 'string' || typeof payload.content !== 'string') {
      return null;
    }
    return {
      path: payload.path,
      content: payload.content,
    };
  } catch {
    return null;
  }
}

export function rewriteFixturePath(
  value: string,
  sourceRunDir: TranscriptRunDirPaths,
  targetRunDir: TranscriptRunDirPaths,
): string {
  return value
    .replaceAll(sourceRunDir.iterDir, targetRunDir.iterDir)
    .replaceAll(sourceRunDir.transcriptPath, targetRunDir.transcriptPath)
    .replaceAll(sourceRunDir.metricsPath, targetRunDir.metricsPath);
}

function rewriteToolCallArguments(
  toolName: string,
  argumentsText: string,
  sourceRunDir: TranscriptRunDirPaths,
  targetRunDir: TranscriptRunDirPaths,
): string {
  if (toolName === 'write_file') {
    const payload = parseWriteFilePayload(argumentsText);
    if (payload) {
      return JSON.stringify({
        path: rewriteFixturePath(payload.path, sourceRunDir, targetRunDir),
        content: rewriteFixturePath(payload.content, sourceRunDir, targetRunDir),
      });
    }
  }

  return rewriteFixturePath(argumentsText, sourceRunDir, targetRunDir);
}

export function materializeTranscriptFixture<T extends AutoResearchTranscriptFixture>(
  fixture: T,
  runDir: TranscriptRunDirPaths,
): T {
  return {
    ...fixture,
    runDir: {
      iterDir: runDir.iterDir,
      transcriptPath: runDir.transcriptPath,
      metricsPath: runDir.metricsPath,
    },
    attempts: fixture.attempts.map((attempt) => ({
      ...attempt,
      finalText: attempt.finalText ? rewriteFixturePath(attempt.finalText, fixture.runDir, runDir) : attempt.finalText,
      events: attempt.events.map((event) => {
        if (event.type === 'tool_call') {
          return {
            ...event,
            call: {
              ...event.call,
              arguments: rewriteToolCallArguments(event.call.name, event.call.arguments, fixture.runDir, runDir),
            },
          };
        }

        if (event.type === 'tool_result') {
          return {
            ...event,
            result: {
              ...event.result,
              result: rewriteFixturePath(event.result.result, fixture.runDir, runDir),
            },
          };
        }

        if (event.type === 'assistant_message') {
          return {
            ...event,
            content: rewriteFixturePath(event.content, fixture.runDir, runDir),
          };
        }

        return event;
      }),
    })),
  } as T;
}

export async function replayTranscriptEvent(
  input: Record<string, unknown>,
  event: AutoResearchTranscriptEvent,
  options: TranscriptReplayOptions = {},
): Promise<void> {
  switch (event.type) {
    case 'status':
      await (input.onStatus as ((message: string) => void) | undefined)?.(event.message);
      break;
    case 'text_delta':
      await (input.onTextDelta as ((chunk: string) => void) | undefined)?.(event.content);
      break;
    case 'reasoning_delta':
      await (input.onReasoningDelta as ((chunk: string) => void) | undefined)?.(event.content);
      break;
    case 'tool_summary':
      await (input.onToolSummary as ((toolName: string, preview: string) => void) | undefined)?.(event.toolName, event.preview);
      break;
    case 'tool_call': {
      await (input.onToolCall as ((call: { id: string; name: string; arguments: string }) => Promise<void>) | undefined)?.(event.call);
      if (event.call.name === 'write_file' && options.onWriteFile) {
        const payload = parseWriteFilePayload(event.call.arguments);
        if (payload) {
          await options.onWriteFile(payload);
        }
      }
      break;
    }
    case 'tool_result':
      await (input.onToolResult as ((result: { id: string; name: string; result: string; durationMs: number }) => Promise<void>) | undefined)?.(event.result);
      break;
    case 'assistant_message':
      await (input.onAssistantMessage as ((text: string) => Promise<void>) | undefined)?.(event.content);
      break;
  }
}

export async function replayTranscriptAttempt(
  input: Record<string, unknown>,
  queue: AutoResearchTranscriptAttempt[],
  options: TranscriptReplayOptions = {},
): Promise<{ finalText: string; finalReasoning: string }> {
  const attempt = queue.shift();
  if (!attempt) {
    throw new Error('Unexpected extra runHeadlessAgentTurn attempt');
  }

  for (const event of attempt.events) {
    await replayTranscriptEvent(input, event, options);
  }

  if (attempt.error) {
    throw new Error(attempt.error);
  }

  return {
    finalText: attempt.finalText ?? '',
    finalReasoning: attempt.finalReasoning ?? '',
  };
}

export function installTranscriptFixture(
  target: TranscriptMockTarget,
  attempts: AutoResearchTranscriptAttempt[],
  options: TranscriptReplayOptions = {},
): void {
  const queue = [...attempts];
  target.mockImplementation(async (input: Record<string, unknown>) => replayTranscriptAttempt(input, queue, options));
}

export function installDynamicTranscriptFixture<T extends AutoResearchTranscriptFixture>(params: {
  target: TranscriptMockTarget;
  fixture: T;
  getRunDir: () => TranscriptRunDirPaths | null;
  options?: TranscriptReplayOptions;
}): {
  getMaterializedFixture: () => T | null;
} {
  let materializedFixture: T | null = null;
  let transcriptQueue: AutoResearchTranscriptAttempt[] | null = null;

  params.target.mockImplementation(async (input: Record<string, unknown>) => {
    const runDir = params.getRunDir();
    if (!runDir) {
      throw new Error('run dir not set');
    }

    if (!materializedFixture) {
      materializedFixture = materializeTranscriptFixture(params.fixture, runDir);
      transcriptQueue = [...materializedFixture.attempts];
    }

    return replayTranscriptAttempt(input, transcriptQueue ?? [], params.options);
  });

  return {
    getMaterializedFixture: () => materializedFixture,
  };
}