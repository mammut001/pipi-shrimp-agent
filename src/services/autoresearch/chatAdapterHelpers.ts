import type { AutoResearchObservedToolResult } from './reflection';

export function parseToolCommand(call: { name: string; arguments: string }): string | undefined {
  try {
    const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
    return typeof parsed.command === 'string' ? parsed.command : undefined;
  } catch {
    return undefined;
  }
}

function parsePlainToolResult(
  toolName: string,
  result: string,
): Pick<AutoResearchObservedToolResult, 'stdout' | 'stderr' | 'exitCode'> {
  const trimmed = result.trim();
  if (!trimmed) {
    return { stdout: undefined, stderr: undefined, exitCode: null };
  }

  if (trimmed.startsWith('Error:')) {
    return { stdout: undefined, stderr: result, exitCode: 1 };
  }

  if (toolName === 'write_file' && /^Successfully wrote \d+ bytes to /i.test(trimmed)) {
    return { stdout: result, stderr: undefined, exitCode: 0 };
  }

  if (toolName === 'create_directory' && /^Directory created successfully:/i.test(trimmed)) {
    return { stdout: result, stderr: undefined, exitCode: 0 };
  }

  if (toolName === 'read_file' || toolName === 'list_files' || toolName === 'path_exists') {
    return { stdout: result, stderr: undefined, exitCode: 0 };
  }

  return { stdout: result, stderr: undefined, exitCode: null };
}

export function parseToolResult(
  call: { id: string; name: string; result: string; durationMs: number },
  toolCommand?: string,
): AutoResearchObservedToolResult {
  let stdout: string | undefined;
  let stderr: string | undefined;
  let exitCode: number | null | undefined;

  try {
    const parsed = JSON.parse(call.result) as Record<string, unknown>;
    stdout = typeof parsed.stdout === 'string' ? parsed.stdout : undefined;
    stderr = typeof parsed.stderr === 'string' ? parsed.stderr : undefined;
    if (!stderr && parsed.error === true) {
      const message = typeof parsed.message === 'string' ? parsed.message : null;
      const cause = typeof parsed.cause === 'string' ? parsed.cause : null;
      stderr = [message, cause].filter((value): value is string => Boolean(value)).join(' | ') || call.result;
    }
    const rawExitCode = parsed.exitCode ?? parsed.exit_code;
    exitCode = typeof rawExitCode === 'number'
      ? rawExitCode
      : parsed.error === true
        ? 1
        : null;
  } catch {
    return {
      tool: call.name,
      command: toolCommand,
      ...parsePlainToolResult(call.name, call.result),
    };
  }

  return {
    tool: call.name,
    command: toolCommand,
    stdout,
    stderr,
    exitCode,
  };
}
