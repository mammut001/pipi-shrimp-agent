import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

// ============== SSH Config ==============

export interface SshConfig {
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
}

/**
 * Resolve SSH config from settings store or environment.
 * In a real flow the config lives in settingsStore.sshConfig — here we
 * read it from the tool arguments (each call may override), falling back
 * to a default ~/.ssh/id_rsa key.
 */
function buildSshPrefix(cfg: SshConfig): string {
  const port = cfg.port || 22;
  return `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p ${port} -i ${shellEscape(cfg.keyPath)} ${shellEscape(cfg.user)}@${shellEscape(cfg.host)}`;
}

/**
 * Minimal POSIX shell escape — wraps value in single quotes and escapes
 * embedded single quotes (the standard '\'' trick).
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ============== Dangerous-pattern guard ==============

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /:\(\)\s*:\s*\|:\s*&/,
  /mkfs/,
  /dd\s+if=.*of=\/dev\//,
  /curl\s+.*\$\(/,                    // data exfiltration via curl + command substitution
  /wget\s+.*\$\(/,                    // data exfiltration via wget
  /nc\s+-[elp]/,                      // netcat listeners
  />\s*\/dev\/[sh]d/,                 // write to disk devices
  /chmod\s+777\s+\//,                 // chmod 777 on root paths
];

function isDangerous(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(cmd));
}

// ============== ssh_exec ==============

const SshExecInputSchema = z.object({
  command: z.string().describe('The command to execute on the remote host'),
  host: z.string().describe('Remote host IP or hostname'),
  user: z.string().describe('SSH user'),
  keyPath: z.string().optional().describe('Path to SSH private key (default: ~/.ssh/id_rsa)'),
  port: z.number().optional().describe('SSH port (default: 22)'),
  remoteWorkDir: z.string().optional().describe('Remote working directory (default: ~/autoresearch)'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 300, max: 600)'),
});

const SshExecOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

type SshExecInput = z.infer<typeof SshExecInputSchema>;
type SshExecOutput = z.infer<typeof SshExecOutputSchema>;

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

export class SshExecTool extends BaseTool<SshExecInput, SshExecOutput> {
  readonly name = 'ssh_exec';
  readonly aliases = ['SshExec', 'RemoteExec'];
  readonly searchHint = 'ssh remote execute command server vps';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = false;

  readonly inputSchema = SshExecInputSchema;
  readonly outputSchema = SshExecOutputSchema;

  async execute(input: SshExecInput, _context: ToolContext): Promise<ToolResult<SshExecOutput>> {
    if (isDangerous(input.command)) {
      return { success: false, error: `Dangerous command blocked: ${input.command.substring(0, 80)}` };
    }

    const cfg: SshConfig = {
      host: input.host,
      user: input.user,
      keyPath: input.keyPath || '~/.ssh/id_rsa',
      port: input.port || 22,
      remoteWorkDir: input.remoteWorkDir || '~/autoresearch',
    };

    const timeout = Math.min(input.timeout || 300, 600);
    const prefix = buildSshPrefix(cfg);
    // Wrap the remote command: cd into workdir, then execute.
    // The entire remote command string (including user command) is shell-escaped
    // for the outer ssh invocation to prevent injection.
    const remoteCmd = `cd ${shellEscape(cfg.remoteWorkDir)} && ${input.command}`;
    const fullCmd = `${prefix} ${shellEscape(remoteCmd)}`;

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
    return 'Execute a command on a remote server via SSH.';
  }

  isReadOnly(): boolean { return false; }
  isDestructive(): boolean { return true; }
}

// ============== ssh_upload_file ==============

const SshUploadInputSchema = z.object({
  localPath: z.string().describe('Local file path to upload'),
  remotePath: z.string().describe('Remote destination path'),
  host: z.string().describe('Remote host'),
  user: z.string().describe('SSH user'),
  keyPath: z.string().optional(),
  port: z.number().optional(),
});

const SshUploadOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type SshUploadInput = z.infer<typeof SshUploadInputSchema>;
type SshUploadOutput = z.infer<typeof SshUploadOutputSchema>;

export class SshUploadFileTool extends BaseTool<SshUploadInput, SshUploadOutput> {
  readonly name = 'ssh_upload_file';
  readonly aliases = ['SshUpload', 'ScpUpload'];
  readonly searchHint = 'ssh scp upload file remote server';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;

  readonly inputSchema = SshUploadInputSchema;
  readonly outputSchema = SshUploadOutputSchema;

  async execute(input: SshUploadInput, _context: ToolContext): Promise<ToolResult<SshUploadOutput>> {
    const port = input.port || 22;
    const keyPath = input.keyPath || '~/.ssh/id_rsa';
    const cmd = `scp -o StrictHostKeyChecking=accept-new -P ${port} -i ${shellEscape(keyPath)} ${shellEscape(input.localPath)} ${shellEscape(input.user)}@${shellEscape(input.host)}:${shellEscape(input.remotePath)}`;

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: cmd,
        timeoutSecs: 120,
      });
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        return {
          success: false,
          error: `scp failed (exit ${exitCode}): ${result.stderr || result.stdout || 'unknown error'}`,
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
    return 'Upload a local file to a remote server via SCP.';
  }

  isReadOnly(): boolean { return false; }
}

// ============== ssh_read_file ==============

const SshReadFileInputSchema = z.object({
  remotePath: z.string().describe('Remote file path to read'),
  host: z.string().describe('Remote host'),
  user: z.string().describe('SSH user'),
  keyPath: z.string().optional(),
  port: z.number().optional(),
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
  readonly searchHint = 'ssh read file remote cat';
  readonly maxResultSizeChars = 100000;
  readonly shouldDefer = false;

  readonly inputSchema = SshReadFileInputSchema;
  readonly outputSchema = SshReadFileOutputSchema;

  async execute(input: SshReadFileInput, _context: ToolContext): Promise<ToolResult<SshReadFileOutput>> {
    const port = input.port || 22;
    const keyPath = input.keyPath || '~/.ssh/id_rsa';
    const prefix = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p ${port} -i ${shellEscape(keyPath)} ${shellEscape(input.user)}@${shellEscape(input.host)}`;

    let remoteCmd = `cat ${shellEscape(input.remotePath)}`;
    if (input.maxLines) {
      remoteCmd = `head -n ${input.maxLines} ${shellEscape(input.remotePath)}`;
    }
    const fullCmd = `${prefix} ${shellEscape(remoteCmd)}`;

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: fullCmd,
        timeoutSecs: 30,
      });
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        return {
          success: false,
          error: `Failed to read remote file (exit ${exitCode}): ${result.stderr || 'unknown error'}`,
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
    return 'Read the content of a file on a remote server via SSH.';
  }

  isReadOnly(): boolean { return true; }
  isConcurrencySafe(): boolean { return true; }
}

// ============== Singleton exports ==============

export const sshExecTool = new SshExecTool();
export const sshUploadFileTool = new SshUploadFileTool();
export const sshReadFileTool = new SshReadFileTool();
