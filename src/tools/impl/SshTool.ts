import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';
import {
  buildRemoteBashCommand,
  buildUploadCommand,
  ensureSshpassAvailable,
  type ExecMode,
  type SshAuthMode,
  shellEscapePath,
} from '../../utils/remoteExec';
import { runInTerminal, getCurrentRunDir } from '@/services/autoresearch/terminalRunner';
import { readTargetText } from '@/services/autoresearch/runDir';

const SSH_EXEC_PTY_ALLOCATION_ERROR = 'Failed to allocate PTY for ssh_exec terminal=true';

// ============== SSH Config (legacy shape — kept for callers) ==============

export interface SshConfig {
  mode: ExecMode;
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
  authMode: SshAuthMode;
  password: string;
}

// ============== Dangerous-pattern guard ==============

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*:\s*\|:\s*&/,
  /mkfs/,
  /dd\s+if=.*of=\/dev\//,
  /curl\s+.*\$\(/,
  /wget\s+.*\$\(/,
  /nc\s+-[elp]/,
  />\s*\/dev\/[sh]d/,
  /chmod\s+777\s+\//,
  // Block `sshpass -p '<pw>'` so free-form commands can't leak passwords.
  /\bsshpass\s+-p\b/,
];

function isDangerous(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(cmd));
}

// Common schema fragment for target/auth fields. All optional so older
// callers (just host/user) keep working; AutoResearch fills in the rest.
const TargetFields = {
  mode: z.enum(['local', 'ssh']).optional().describe("Execution mode: 'local' runs on this machine, 'ssh' on a remote host. Defaults to 'ssh'."),
  host: z.string().optional().describe('Remote host (required when mode=ssh).'),
  user: z.string().optional().describe('SSH user (required when mode=ssh).'),
  port: z.number().optional().describe('SSH port (default: 22).'),
  authMode: z.enum(['agent', 'password', 'key']).optional().describe("SSH auth: 'agent' (default, uses ssh-agent / ~/.ssh/config), 'password', or 'key'."),
  keyPath: z.string().optional().describe("Private key path (only when authMode='key')."),
  password: z.string().optional().describe("SSH password (only when authMode='password'; kept in memory)."),
  remoteWorkDir: z.string().optional().describe('Working directory on the target (cd-ed into before running the command).'),
};

function toCfg(input: any): SshConfig {
  return {
    mode: input.mode ?? 'ssh',
    host: input.host ?? '',
    user: input.user ?? '',
    port: input.port ?? 22,
    authMode: input.authMode ?? 'agent',
    keyPath: input.keyPath ?? '',
    password: input.password ?? '',
    remoteWorkDir: input.remoteWorkDir ?? '',
  };
}

function labelForCommand(command: string): string {
  const compact = command.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact || 'ssh_exec';
}

async function preflight(cfg: SshConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((cfg.mode ?? 'ssh') === 'ssh') {
    if (!cfg.host) return { ok: false, error: 'host is required for ssh mode' };
    if (!cfg.user) return { ok: false, error: 'user is required for ssh mode' };
    if ((cfg.authMode ?? 'agent') === 'password') {
      if (!cfg.password) return { ok: false, error: 'password is required for authMode=password' };
      const avail = await ensureSshpassAvailable();
      if (!avail.ok) return { ok: false, error: avail.hint ?? 'sshpass unavailable' };
    }
    if (cfg.authMode === 'key' && !cfg.keyPath) {
      return { ok: false, error: 'keyPath is required for authMode=key' };
    }
  }
  return { ok: true };
}

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

// ============== ssh_exec ==============

const SshExecInputSchema = z.object({
  command: z.string().describe('The command to execute on the target'),
  ...TargetFields,
  timeout: z.number().optional().describe('Timeout in seconds (default: 300, max: 600)'),
  terminal: z.boolean().optional().describe('Defaults to false. Set true only when the command needs a PTY or live interactive terminal output; otherwise the silent bash path is used.'),
});

const SshExecOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

type SshExecInput = z.infer<typeof SshExecInputSchema>;
type SshExecOutput = z.infer<typeof SshExecOutputSchema>;

export async function runSshExec(
  input: SshExecInput,
  options: { forceTerminal?: boolean } = {},
): Promise<SshExecOutput> {
  if (isDangerous(input.command)) {
    throw new Error(`Dangerous command blocked: ${input.command.substring(0, 80)}`);
  }

  const cfg = toCfg(input);
  const check = await preflight(cfg);
  if (!check.ok) {
    throw new Error('error' in check ? check.error : 'SSH preflight failed');
  }

  const timeout = Math.min(input.timeout || 300, 600);
  const activeRun = getCurrentRunDir();
  const shouldUseTerminal = Boolean(options.forceTerminal ?? input.terminal ?? false);

  if (shouldUseTerminal && activeRun) {
    try {
      const result = await runInTerminal({
        cfg,
        cmd: input.command,
        cwd: input.remoteWorkDir || cfg.remoteWorkDir,
        logsDir: activeRun.logsDir,
        timeoutSecs: timeout,
        label: labelForCommand(input.command),
      });

      const [stdout, stderr] = await Promise.all([
        readTargetText(cfg, result.stdoutPath),
        readTargetText(cfg, result.stderrPath),
      ]);

      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: result.exitCode,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Timed out opening AutoResearch terminal session') {
        throw new Error(SSH_EXEC_PTY_ALLOCATION_ERROR);
      }
      throw error;
    }
  }

  const fullCmd = buildRemoteBashCommand(cfg, input.command);
  const result = await invoke<RawBashResult>('execute_bash', {
    args: {
      command: fullCmd,
      timeoutSecs: timeout,
    },
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exit_code ?? 0,
  };
}

export class SshExecTool extends BaseTool<SshExecInput, SshExecOutput> {
  readonly name = 'ssh_exec';
  readonly aliases = ['SshExec', 'RemoteExec'];
  readonly searchHint = 'ssh remote execute command server vps local bash';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = false;

  readonly inputSchema = SshExecInputSchema;
  readonly outputSchema = SshExecOutputSchema;

  async execute(input: SshExecInput, _context: ToolContext): Promise<ToolResult<SshExecOutput>> {
    try {
      return {
        success: true,
        data: await runSshExec(input),
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async describe(): Promise<string> {
    return 'Execute a command on the target (local or remote via SSH).';
  }

  isReadOnly(): boolean { return false; }
  isDestructive(): boolean { return true; }
}

// ============== ssh_upload_file ==============

const SshUploadInputSchema = z.object({
  localPath: z.string().optional().describe('Local source file path. Provide this or content, but not both.'),
  content: z.string().optional().describe('Inline file content to materialize locally and then upload. Provide this or localPath, but not both.'),
  remotePath: z.string().describe('Destination path (remote for mode=ssh, local for mode=local)'),
  ...TargetFields,
}).superRefine((input, ctx) => {
  const hasLocalPath = Boolean(input.localPath?.trim());
  const hasContent = typeof input.content === 'string';

  if (hasLocalPath === hasContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one of localPath or content.',
      path: hasLocalPath ? ['content'] : ['localPath'],
    });
  }
});

const SshUploadOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type SshUploadInput = z.infer<typeof SshUploadInputSchema>;
type SshUploadOutput = z.infer<typeof SshUploadOutputSchema>;

function createTempUploadPath(): string {
  return `/tmp/pipi-shrimp-ssh-upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`;
}

async function writeInlineUploadContent(content: string): Promise<string> {
  const tempPath = createTempUploadPath();
  await invoke<string>('write_file', {
    path: tempPath,
    content,
    workDir: null,
  });
  return tempPath;
}

async function cleanupInlineUploadFile(path: string): Promise<void> {
  try {
    await invoke<RawBashResult>('execute_bash', {
      args: {
        command: `rm -f ${shellEscapePath(path)}`,
        timeoutSecs: 15,
      },
    });
  } catch {
    // Best-effort cleanup for temporary inline upload files.
  }
}

export async function runSshUpload(input: SshUploadInput): Promise<SshUploadOutput> {
  const cfg = toCfg(input);
  const check = await preflight(cfg);
  if (!check.ok) {
    throw new Error('error' in check ? check.error : 'SSH preflight failed');
  }

  const uploadSourcePath = input.content !== undefined
    ? await writeInlineUploadContent(input.content)
    : input.localPath!;

  try {
    const cmd = buildUploadCommand(cfg, uploadSourcePath, input.remotePath);
    const result = await invoke<RawBashResult>('execute_bash', {
      args: {
        command: cmd,
        timeoutSecs: 120,
      },
    });
    const exitCode = result.exit_code ?? 0;
    if (exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `upload failed (exit ${exitCode})`);
    }

    const sourceLabel = input.content !== undefined ? 'inline content' : input.localPath!;
    return { success: true, message: `Uploaded ${sourceLabel} → ${input.remotePath}` };
  } finally {
    if (input.content !== undefined) {
      await cleanupInlineUploadFile(uploadSourcePath);
    }
  }
}

export class SshUploadFileTool extends BaseTool<SshUploadInput, SshUploadOutput> {
  readonly name = 'ssh_upload_file';
  readonly aliases = ['SshUpload', 'ScpUpload', 'RemoteUpload'];
  readonly searchHint = 'ssh scp upload file remote server local copy';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;

  readonly inputSchema = SshUploadInputSchema;
  readonly outputSchema = SshUploadOutputSchema;

  async execute(input: SshUploadInput, _context: ToolContext): Promise<ToolResult<SshUploadOutput>> {
    try {
      return {
        success: true,
        data: await runSshUpload(input),
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async describe(): Promise<string> {
    return 'Upload a local file or inline content to the target (scp for SSH, cp for local).';
  }

  isReadOnly(): boolean { return false; }
}

// ============== ssh_read_file ==============

const SshReadFileInputSchema = z.object({
  remotePath: z.string().describe('File path on the target'),
  ...TargetFields,
  maxLines: z.number().optional().describe('Max lines to return (default: all)'),
});

const SshReadFileOutputSchema = z.object({
  content: z.string(),
  lineCount: z.number(),
});

type SshReadFileInput = z.infer<typeof SshReadFileInputSchema>;
type SshReadFileOutput = z.infer<typeof SshReadFileOutputSchema>;

export async function runSshReadFile(input: SshReadFileInput): Promise<SshReadFileOutput> {
  const cfg = toCfg(input);
  const check = await preflight(cfg);
  if (!check.ok) {
    throw new Error('error' in check ? check.error : 'SSH preflight failed');
  }

  const remoteCmd = input.maxLines
    ? `head -n ${Math.max(1, Math.floor(input.maxLines))} ${shellEscapePath(input.remotePath)}`
    : `cat ${shellEscapePath(input.remotePath)}`;

  const readCfg = { ...cfg, remoteWorkDir: '' };
  const fullCmd = buildRemoteBashCommand(readCfg, remoteCmd);
  const result = await invoke<RawBashResult>('execute_bash', {
    args: {
      command: fullCmd,
      timeoutSecs: 30,
    },
  });
  const exitCode = result.exit_code ?? 0;
  if (exitCode !== 0) {
    throw new Error(result.stderr || `Failed to read file (exit ${exitCode})`);
  }
  const content = result.stdout || '';
  return {
    content,
    lineCount: content.split('\n').length,
  };
}

export class SshReadFileTool extends BaseTool<SshReadFileInput, SshReadFileOutput> {
  readonly name = 'ssh_read_file';
  readonly aliases = ['SshReadFile', 'RemoteReadFile'];
  readonly searchHint = 'ssh read file remote cat local';
  readonly maxResultSizeChars = 100000;
  readonly shouldDefer = false;

  readonly inputSchema = SshReadFileInputSchema;
  readonly outputSchema = SshReadFileOutputSchema;

  async execute(input: SshReadFileInput, _context: ToolContext): Promise<ToolResult<SshReadFileOutput>> {
    try {
      return {
        success: true,
        data: await runSshReadFile(input),
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async describe(): Promise<string> {
    return 'Read the content of a file on the target (local or remote via SSH).';
  }

  isReadOnly(): boolean { return true; }
  isConcurrencySafe(): boolean { return true; }
}

// ============== Singleton exports ==============

export const sshExecTool = new SshExecTool();
export const sshUploadFileTool = new SshUploadFileTool();
export const sshReadFileTool = new SshReadFileTool();
