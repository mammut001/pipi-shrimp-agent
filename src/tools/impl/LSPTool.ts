import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * LSPTool - Language Server Protocol 操作
 *
 * Provides IDE-level code intelligence: go-to-definition, references, hover, etc.
 * Based on Claude Code's LSPTool.
 */
export class LSPTool extends BaseTool<LSPInput, LSPOutput> {
  readonly name = 'LSP';
  readonly aliases = ['CodeIntel', 'GoToDefinition', 'FindReferences'];
  readonly searchHint = 'lsp definition references hover symbol types code intelligence';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = true;

  readonly inputSchema = LSPInputSchema;
  readonly outputSchema = LSPOutputSchema;

  async execute(input: LSPInput, context: ToolContext): Promise<ToolResult<LSPOutput>> {
    try {
      const result = await invoke<RawLSPResult>('lsp_operation', {
        operation: input.operation,
        filePath: input.filePath,
        line: input.line,
        character: input.character,
        workDir: context.cwd || undefined
      });

      return {
        success: true,
        data: {
          operation: input.operation,
          result: result.result,
          resultCount: result.resultCount ?? 0
        }
      };
    } catch (error) {
      // LSP may not be available — return graceful error
      return {
        success: false,
        error: `LSP operation failed: ${(error as Error).message}`
      };
    }
  }

  async describe(): Promise<string> {
    return `Language server operations (STUB): go-to-definition, find references, hover info, symbols. Requires language server installed (typescript-language-server, rust-analyzer, pylsp). Full JSON-RPC implementation pending.`;
  }

  isReadOnly(): boolean { return true; }
  isConcurrencySafe(): boolean { return true; }
}

interface RawLSPResult {
  result?: unknown;
  resultCount?: number;
}

// ============== Schema ==============

export const LSPOperations = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls'
] as const;

export const LSPInputSchema = z.object({
  operation: z.enum(LSPOperations).describe('LSP operation to perform'),
  filePath: z.string().describe('Path to the source file'),
  line: z.number().int().nonnegative().describe('Zero-based line number'),
  character: z.number().int().nonnegative().describe('Zero-based character offset')
});

export const LSPOutputSchema = z.object({
  operation: z.string(),
  result: z.unknown(),
  resultCount: z.number()
});

export type LSPInput = z.infer<typeof LSPInputSchema>;
export type LSPOutput = z.infer<typeof LSPOutputSchema>;

export const lspTool = new LSPTool();
