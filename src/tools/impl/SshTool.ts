import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';
import {
  buildRemoteBashCommand,
  buildUploadCommand,
  ensureSshpassAvailable,
  type ExecMode,
  type SshAuthMode,
} from '../../utils/remoteExec';

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

function toCfg(input: any): Partial<SshConfig> {
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

async function preflight(cfg: Partial<SshConfig>): Promise<{ ok: true } | { ok: false; error: string }> {
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
});

const SshExecOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

type SshExecInput = z.infer<typeof SshExecInputSchema>;
type SshExecOutput = z.infer<typeof SshExecOutputSchema>;

export class SshExecTool extends BaseTool<SshExecInput, SshExecOutput> {
  readonly name = 'ssh_exec';
  readonly aliases = ['SshExec', 'RemoteExec'];
  readonly searchHint = 'ssh remote execute command server vps local bash';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = false;

  readonly inputSchema = SshExecInputSchema;
  readonly outputSchema = SshExecOutputSchema;

  async execute(input: SshExecInput, _context: ToolContext): Promise<ToolResult<SshExecOutput>> {
    if (isDangerous(input.command)) {
      return { success: false, error: `Dangerous command blocked: ${input.command.substring(0, 80)}` };
    }

    const cfg = toCfg(input);
    const check = await preflight(cfg);
    if (!check.ok) return { success: false, error: check.error };

    const timeout = Math.min(input.timeout || 300, 600);
    const fullCmd = buildRemoteBashCommand(cfg, input.command);

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: fullCmd,
        timeoutSecs: timeout,
      });
      return {
        success: true,
        data: {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.exit_code ?? 0,
        },
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
  localPath: z.string().describe('Local source file path'),
  remotePath: z.string().describe('Destination path (remote for mode=ssh, local for mode=local)'),
  ...TargetFields,
});

const SshUploadOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type SshUploadInput = z.infer<typeof SshUploadInputSchema>;
type SshUploadOutput = z.infer<typeof SshUploadOutputSchema>;

export class SshUploadFileTool extends BaseTool<SshUploadInput, SshUploadOutput> {
  readonly name = 'ssh_upload_file';
  readonly aliases = ['SshUpload', 'ScpUpload', 'RemoteUpload'];
  readonly searchHint = 'ssh scp upload file remote server local copy';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;

  readonly inputSchema = SshUploadInputSchema;
  readonly outputSchema = SshUploadOutputSchema;

  async execute(input: SshUploadInput, _context: ToolContext): Promise<ToolResult<SshUploadOutput>> {
    const cfg = toCfg(input);
    const check = await preflight(cfg);
    if (!check.ok) return { success: false, error: check.error };

    const cmd = buildUploadCommand(cfg, input.localPath, input.remotePath);

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: cmd,
        timeoutSecs: 120,
      });
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        return {
          success: false,
          error: `upload failed (exit ${exitCode}): ${result.stderr || result.stdout || 'unknown error'}`,
        };
      }
      return {
        success: true,
        data: { success: true, message: `Uploaded ${input.localPath} → ${input.remotePath}` },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async describe(): Promise<string> {
    return 'Upload a local file to the target (scp for SSH, cp for local).';
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

export class SshReadFileTool extends BaseTool<SshReadFileInput, SshReadFileOutput> {
  readonly name = 'ssh_read_file';
  readonly aliases = ['SshReadFile', 'RemoteReadFile'];
  readonly searchHint = 'ssh read file remote cat local';
  readonly maxResultSizeChars = 100000;
  readonly shouldDefer = false;

  readonly inputSchema = SshReadFileInputSchema;
  readonly outputSchema = SshReadFileOutputSchema;

  async execute(input: SshReadFileInput, _context: ToolContext): Promise<ToolResult<SshReadFileOutput>> {
    const cfg = toCfg(input);
    const check = await preflight(cfg);
    if (!check.ok) return { success: false, error: check.error };

    // Build remote subcommand. Escape path for the remote side.
    const esc = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
    const remoteCmd = input.maxLines
      ? `head -n ${Math.max(1, Math.floor(input.maxLines))} ${esc(input.remotePath)}`
      : `cat ${esc(input.remotePath)}`;

    // For reads don't cd into remoteWorkDir — the target path might be absolute.
    const readCfg = { ...cfg, remoteWorkDir: '' };
    const fullCmd = buildRemoteBashCommand(readCfg, remoteCmd);

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: fullCmd,
        timeoutSecs: 30,
      });
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        return {
          success: false,
          error: `Failed to read file (exit ${exitCode}): ${result.stderr || 'unknown error'}`,
        };
      }
      const content = result.stdout || '';
      return {
        success: true,
        data: {
          content,
          lineCount: content.split('\n').length,
        },
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
