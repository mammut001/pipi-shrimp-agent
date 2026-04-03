import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 命令分类 - 用于 UI 折叠显示
 */
export type CommandCategory = 'SEARCH' | 'READ' | 'LIST' | 'EDIT' | 'OTHER';

/**
 * 危险命令列表
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,                    // rm -rf /
  /:\(\)\s*:\s*\|:\s*&/,              // Fork bomb
  /mkfs/,                             // Format disk
  /dd\s+if=.*of=\/dev\//,             // Direct disk write
  /渗透|exploit|黑客/i,               // 中文危险词
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
    if (!input.dangerouslyDisableSandbox && context.settings.sandboxEnabled !== false) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(input.command)) {
          return {
            success: false,
            error: `Dangerous command blocked: ${input.command.substring(0, 50)}...`
          };
        }
      }
    }

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        command: input.command,
        cwd: context.cwd || undefined,
        workDir: context.cwd || undefined,
        timeoutSecs: input.timeout
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
  run_in_background: z.boolean().optional().describe('Run in background without blocking'),
  dangerouslyDisableSandbox: z.boolean().optional().describe('Disable dangerous command check')
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
