import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/store/settingsStore';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 命令分类 - 用于 UI 折叠显示
 */
export type CommandCategory = 'SEARCH' | 'READ' | 'LIST' | 'EDIT' | 'OTHER';

/**
 * 危险命令列表
 * 使用 case-insensitive 标志防止大小写绕过 (如 RM -RF /)
 * AUDIT-FIX: Expanded to cover more attack vectors including:
 * - Disk formatting and partition manipulation
 * - Credential dumping and authentication bypass
 * - Reverse shells and remote code execution
 * - Chinese dangerous keywords (preserved from original)
 */
const DANGEROUS_PATTERNS = [
  // Disk destruction (case-insensitive)
  /rm\s+-rf\s+\//i,                   // rm -rf / (case insensitive)
  /mkfs/i,                            // Format disk (case insensitive)
  /fdisk/i,                           // Partition editor (case insensitive)
  /dd\s+if=.*of=\/dev\//i,           // Direct disk write (case insensitive)

  // Fork bomb (no case variation - special characters)
  /:\(\)\s*:\s*\|:\s*&/,

  // Authentication and credential theft
  /chmod\s+777\s+\//i,                // Open permissions on root
  /chmod\s+-r\s+777\s+/i,            // Recursive open permissions
  /passwd\s+root/i,                   // Change root password
  /su\s+root/i,                       // Switch to root

  // Reverse shell and remote access
  /nc\s+-[elp].*\e/i,                // Netcat reverse shell
  /nc\s+-e\s+\/bin\//i,              // Netcat with exec
  /bash\s+-i\s+.*\/dev\/tcp\//i,     // Bash reverse shell
  /bash\s+-c\s+.*nc\s+/i,            // Bash with netcat
  /curl\s+.*\$\(/i,                   // Command injection via curl
  /wget\s+.*\$\(/i,                   // Command injection via wget
  /python.*-c.*socket/i,              // Python reverse shell
  /perl.*-e.*socket/i,                // Perl reverse shell

  // System modification and control
  /init\s+0/i,                        // Shutdown
  /init\s+6/i,                        // Reboot
  /shutdown\s+-h/i,                    // Halt system
  /reboot/i,                          // Reboot command

  // Sensitive data access
  /cat\s+\/etc\/shadow/i,             // Read password hashes
  /cat\s+\/etc\/passwd.*\>/i,         // Overwrite passwd

  // Chinese dangerous keywords (preserved from original)
  /渗透|提权|黑客|入侵|木马|病毒/i,
];

/**
 * Bash 工具 - 执行 shell 命令
 */
export class BashTool extends BaseTool<BashInput, BashOutput> {
  readonly name = 'Bash';
  readonly aliases = ['Shell', 'Terminal', 'Command'];
  readonly searchHint = 'run command shell execute bash terminal';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = false;

  readonly inputSchema = BashInputSchema;
  readonly outputSchema = BashOutputSchema;

  async execute(input: BashInput, context: ToolContext): Promise<ToolResult<BashOutput>> {
    // 危险命令检查
    // AUDIT-FIX: Now checks both the raw command AND a normalized version
    // to catch attempts to bypass patterns with escapes, quotes, or special chars
    if (context.settings.sandboxEnabled !== false) {
      const rawCommand = input.command;
      // Normalize: remove common evasion techniques
      const normalizedCommand = rawCommand
        .replace(/\\\\/g, '')    // Remove escaped backslashes
        .replace(/\\'/g, "'")     // Remove escaped single quotes
        .replace(/\\"/g, '"')     // Remove escaped double quotes
        .replace(/`/g, '')        // Remove backticks
        .replace(/\$\(/g, '')    // Remove command substitution
        .replace(/\$'{/, '')     // Remove bash subshells
        .replace(/\|/g, ' ')     // Normalize pipes to spaces for pattern matching
        .replace(/>/g, ' ')      // Normalize redirects
        .replace(/;/g, ' ');     // Normalize command separators

      for (const pattern of DANGEROUS_PATTERNS) {
        // Check both raw and normalized to catch bypass attempts
        if (pattern.test(rawCommand) || pattern.test(normalizedCommand)) {
          return {
            success: false,
            error: `Dangerous command blocked: ${rawCommand.substring(0, 50)}...`
          };
        }
      }
    }

    try {
      const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
      const result = await invoke<RawBashResult>('execute_bash', {
        args: {
          command: input.command,
          workDir: context.cwd || undefined,
          timeoutSecs: input.timeout,
          windowsShellProfile,
        },
      });

      return {
        success: true,
        data: {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.exit_code ?? 0,
          interrupted: false,
          durationMs: 0,
          backgroundTaskId: undefined,
          classification: this.classifyCommand(input.command)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: BashInput): Promise<string> {
    return `Execute a shell command. Supports pipes, redirects, and background execution.`;
  }

  isConcurrencySafe(input: BashInput): boolean {
    // 危险命令不并发
    if (DANGEROUS_PATTERNS.some(p => p.test(input.command))) {
      return false;
    }
    return !input.run_in_background;
  }

  isReadOnly(input: BashInput): boolean {
    const readonlyCommands = ['grep', 'rg', 'find', 'cat', 'head', 'tail', 'wc', 'ls', 'tree'];
    const cmd = input.command.trim().split(/\s+/)[0];
    return readonlyCommands.includes(cmd);
  }

  isDestructive(input: BashInput): boolean {
    const destructiveCommands = ['rm', 'mv', 'cp', 'dd', 'mkfs', 'fdisk'];
    const cmd = input.command.trim().split(/\s+/)[0];
    return destructiveCommands.some(d => cmd.includes(d));
  }

  /**
   * 命令分类 - 用于 UI 显示
   */
  private classifyCommand(command: string): CommandCategory {
    const trimmed = command.trim();
    const cmd = trimmed.split(/\s+/)[0];

    // SEARCH 类
    const searchCommands = ['grep', 'rg', 'ag', 'find', 'locate', 'which', 'whereis'];
    if (searchCommands.includes(cmd)) {
      return 'SEARCH';
    }

    // READ 类
    const readCommands = ['cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'md5sum', 'sha256sum'];
    if (readCommands.includes(cmd)) {
      return 'READ';
    }

    // LIST 类
    const listCommands = ['ls', 'tree', 'du', 'df', 'pwd', 'cd'];
    if (listCommands.includes(cmd)) {
      return 'LIST';
    }

    // EDIT 类
    const editCommands = ['sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'tee', 'echo', 'printf'];
    if (editCommands.includes(cmd)) {
      return 'EDIT';
    }

    return 'OTHER';
  }
}

// ============== Schema 定义 ==============

export const BashInputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 60)'),
  description: z.string().optional().describe('Description of what this command does'),
  run_in_background: z.boolean().optional().describe('Run in background without blocking')
});

export const BashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  interrupted: z.boolean(),
  durationMs: z.number(),
  backgroundTaskId: z.string().optional(),
  classification: z.enum(['SEARCH', 'READ', 'LIST', 'EDIT', 'OTHER']).optional()
});

export type BashInput = z.infer<typeof BashInputSchema>;
export type BashOutput = z.infer<typeof BashOutputSchema>;

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;  // Rust uses snake_case
}

// 导出单例
export const bashTool = new BashTool();
