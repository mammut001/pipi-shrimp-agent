import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * REPLTool - 交互式 REPL 执行
 *
 * Executes code in a persistent REPL session.
 * Based on Claude Code's REPLTool primitive tools.
 */

// Dangerous code patterns — block system-level operations that bypass BashTool safety
const DANGEROUS_PYTHON_PATTERNS = [
  /os\.system\s*\(/,
  /subprocess\.(run|call|Popen|check_output)\s*\(/,
  /shutil\.rmtree\s*\(\s*['"]\//, // rmtree on root paths
  /open\s*\(\s*['"]\/etc\//,
  /open\s*\(\s*['"]\/proc\//,
  /os\.remove\s*\(\s*['"]\//, // os.remove on root paths
  /__import__\s*\(\s*['"]subprocess/,
  /exec\s*\(\s*compile/,   // exec(compile(...)) dynamic code
];

const DANGEROUS_JS_PATTERNS = [
  /require\s*\(\s*['"]child_process/,
  /require\s*\(\s*['"]fs['"]\).*unlinkSync\s*\(\s*['"]\//, // fs.unlinkSync on root paths
  /process\.exit/,
  /require\s*\(\s*['"]os['"]\)/,
];

function isDangerousCode(code: string, lang: string): string | null {
  const patterns = lang === 'python' ? DANGEROUS_PYTHON_PATTERNS : DANGEROUS_JS_PATTERNS;
  for (const p of patterns) {
    if (p.test(code)) {
      return `Blocked: dangerous code pattern detected (${p.source.substring(0, 30)})`;
    }
  }
  return null;
}

export class REPLTool extends BaseTool<REPLInput, REPLOutput> {
  readonly name = 'REPL';
  readonly aliases = ['Eval', 'Execute', 'RunCode'];
  readonly searchHint = 'repl eval code execute interactive javascript python';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = true;

  readonly inputSchema = REPLInputSchema;
  readonly outputSchema = REPLOutputSchema;

  // Session manager for persistent REPL sessions
  private sessionIdCounter = 0;
  private activeSessionId: string | null = null;

  async execute(input: REPLInput, context: ToolContext): Promise<ToolResult<REPLOutput>> {
    try {
      const lang = input.language || 'javascript';

      // Safety check: block dangerous system-level operations
      const blocked = isDangerousCode(input.code, lang);
      if (blocked) {
        return { success: false, error: blocked };
      }

      // Use session-based execution for Python when sessionId is provided
      if (lang === 'python' && input.sessionId) {
        return this.executePythonSession(input, context);
      }

      // Use session-based execution for Python with auto-created session
      if (lang === 'python' && !input.sessionId) {
        if (!this.activeSessionId) {
          this.activeSessionId = `repl-${Date.now()}-${++this.sessionIdCounter}`;
        }
        const inputWithSession = { ...input, sessionId: this.activeSessionId };
        return this.executePythonSession(inputWithSession, context);
      }

      // For JavaScript/Node/bash, use regular execution (no persistence yet)
      return this.executeSimple(input, context);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async executePythonSession(input: REPLInput, context: ToolContext): Promise<ToolResult<REPLOutput>> {
    const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_python_session', {
      code: input.code,
      sessionId: input.sessionId!,
      cwd: context.cwd || null,
      workDir: context.cwd || null
    });

    return {
      success: true,
      data: {
        output: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code ?? 0,
        language: 'python'
      }
    };
  }

  private async executeSimple(input: REPLInput, context: ToolContext): Promise<ToolResult<REPLOutput>> {
    const lang = input.language || 'javascript';
    let commandName: string;

    switch (lang) {
      case 'javascript':
      case 'node':
        commandName = 'execute_node';
        break;
      default:
        commandName = 'execute_bash';
    }

    const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(commandName, {
      code: input.code,
      command: input.code,
      workDir: context.cwd || undefined
    });

    return {
      success: true,
      data: {
        output: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code ?? 0,
        language: lang
      }
    };
  }

  async describe(): Promise<string> {
    return `Execute code in a REPL. Supports JavaScript (Node.js) and Python with persistent sessions.`;
  }
}

// ============== Schema ==============

export const REPLInputSchema = z.object({
  code: z.string().describe('Code to execute'),
  language: z.enum(['javascript', 'python', 'node', 'bash']),
  sessionId: z.string().optional().describe('REPL session ID for persistence')
});

export const REPLOutputSchema = z.object({
  output: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  language: z.string()
});

export type REPLInput = z.infer<typeof REPLInputSchema>;
export type REPLOutput = z.infer<typeof REPLOutputSchema>;

export const replTool = new REPLTool();
