import type { AcceptanceCommand, CompletionContract } from './contract';
import { DEFAULT_ACCEPTANCE_TIMEOUT_MS } from './contract';
import { StreamingToolExecutor } from '@/services/StreamingToolExecutor';
import type { PermissionMode, ToolExecutionSource } from '@/services/tools/toolExecutionPolicy';

export type AcceptanceRunStatus = 'pass' | 'failed' | 'blocked';

export interface AcceptanceCommandResult {
  command: string;
  status: AcceptanceRunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  detail?: string;
  durationMs: number;
}

export interface AcceptanceRunDeps {
  workDir?: string;
  permissionMode?: PermissionMode;
  executionMode?: string;
  toolExecutionSource?: ToolExecutionSource;
  sessionId?: string;
  timeoutMs?: number;
  executeBatch?: StreamingToolExecutor['executeBatch'];
}

interface ParsedExecuteOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function parseExecuteCommandContent(content: string): ParsedExecuteOutput | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const stdout = typeof parsed.stdout === 'string' ? parsed.stdout : '';
      const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : '';
      const rawExit = parsed.exitCode ?? parsed.exit_code;
      const exitCode = typeof rawExit === 'number' && Number.isFinite(rawExit) ? rawExit : null;
      return { stdout, stderr, exitCode };
    }
  } catch {
    return null;
  }
  return null;
}

function truncateOutput(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... [已截断]`;
}

export function formatAcceptanceOutputForRepair(result: AcceptanceCommandResult, maxChars = 4000): string {
  const combined = [
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
    result.detail ? `detail: ${result.detail}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return truncateOutput(combined || '(无输出)', maxChars);
}

export async function runAcceptanceCommands(
  commands: AcceptanceCommand[],
  deps: AcceptanceRunDeps = {},
): Promise<AcceptanceCommandResult[]> {
  if (commands.length === 0) {
    return [];
  }
  if (!deps.workDir) {
    return commands.map((item) => ({
      command: item.command,
      status: 'blocked' as const,
      exitCode: null,
      stdout: '',
      stderr: '',
      detail: '验收命令需要项目目录，但当前没有 workDir。',
      durationMs: 0,
    }));
  }

  const executor = new StreamingToolExecutor({ timeoutMs: deps.timeoutMs ?? 300_000 });
  const executeBatch = deps.executeBatch ?? executor.executeBatch.bind(executor);
  const results: AcceptanceCommandResult[] = [];

  for (const item of commands) {
    const timeoutMs = item.timeoutMs ?? DEFAULT_ACCEPTANCE_TIMEOUT_MS;
    const startedAt = Date.now();
    try {
      const batch = await executeBatch(
        [
          {
            id: `acceptance-${results.length}`,
            name: 'execute_command',
            arguments: { command: item.command, timeoutSecs: Math.max(1, Math.ceil(timeoutMs / 1000)) },
          },
        ],
        {
          sessionId: deps.sessionId ?? 'completion-acceptance',
          workDir: deps.workDir,
          source: deps.toolExecutionSource ?? 'headless_agent',
          permissionMode: deps.permissionMode ?? 'bypass',
          executionMode: deps.executionMode,
          timeoutMs,
        },
      );
      const row = batch.results[0];
      const durationMs = Date.now() - startedAt;
      if (!row) {
        results.push({
          command: item.command,
          status: 'failed',
          exitCode: null,
          stdout: '',
          stderr: '',
          detail: '验收命令没有返回执行结果。',
          durationMs,
        });
        continue;
      }
      if (row.is_error) {
        const parsed = parseExecuteCommandContent(row.content);
        if (parsed?.exitCode !== null && parsed?.exitCode !== undefined) {
          const failed = parsed.exitCode !== 0;
          results.push({
            command: item.command,
            status: failed ? 'failed' : 'pass',
            exitCode: parsed.exitCode,
            stdout: parsed.stdout,
            stderr: parsed.stderr || row.error_message || '',
            detail: failed ? `命令退出码为 ${parsed.exitCode}。` : undefined,
            durationMs,
          });
          continue;
        }
        results.push({
          command: item.command,
          status: 'blocked',
          exitCode: null,
          stdout: parsed?.stdout ?? '',
          stderr: parsed?.stderr || row.error_message || row.content,
          detail: row.error_message || '验收命令被策略拦截，未能执行。',
          durationMs,
        });
        continue;
      }
      const parsed = parseExecuteCommandContent(row.content);
      if (!parsed || parsed.exitCode === null) {
        results.push({
          command: item.command,
          status: 'failed',
          exitCode: null,
          stdout: parsed?.stdout ?? row.content,
          stderr: parsed?.stderr ?? '',
          detail: '验收命令输出无法解析出退出码。',
          durationMs,
        });
        continue;
      }
      const failed = parsed.exitCode !== 0;
      results.push({
        command: item.command,
        status: failed ? 'failed' : 'pass',
        exitCode: parsed.exitCode,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        detail: failed ? `命令退出码为 ${parsed.exitCode}。` : undefined,
        durationMs,
      });
    } catch (error) {
      results.push({
        command: item.command,
        status: 'failed',
        exitCode: null,
        stdout: '',
        stderr: '',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return results;
}

export type { CompletionContract };
