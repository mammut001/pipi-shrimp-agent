import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 文件编辑工具
 */
export class FileEditTool extends BaseTool<FileEditInput, FileEditOutput> {
  readonly name = 'FileEdit';
  readonly aliases = ['Edit', 'Replace', 'file_edit'];
  readonly searchHint = 'edit file modify replace text';
  readonly maxResultSizeChars = 50000;

  readonly inputSchema = FileEditInputSchema;
  readonly outputSchema = FileEditOutputSchema;

  async execute(input: FileEditInput, context: ToolContext): Promise<ToolResult<FileEditOutput>> {
    const cwd = context.cwd || undefined;

    // Reject .ipynb files — use NotebookEditTool instead
    if (input.file_path.endsWith('.ipynb')) {
      return { success: false, error: 'Use NotebookEditTool to edit Jupyter notebooks' };
    }

    try {
      // 1. Read the existing file
      const readResult = await invoke<{ content: string; path: string }>('read_file', {
        path: input.file_path,
        workDir: cwd
      });

      const originalContent = readResult.content;

      // 2. Normalize line endings for comparison
      const normalizedContent = originalContent.replace(/\r\n/g, '\n');
      const normalizedOld = input.old_string.replace(/\r\n/g, '\n');

      // 3. Verify old_string exists
      if (!normalizedContent.includes(normalizedOld)) {
        return {
          success: false,
          error: `old_string not found in file: ${input.file_path}`
        };
      }

      // 4. Perform replacement
      let newContent: string;
      let replacedCount: number;
      if (input.replace_all) {
        const parts = normalizedContent.split(normalizedOld);
        replacedCount = parts.length - 1;
        newContent = parts.join(input.new_string);
      } else {
        newContent = normalizedContent.replace(normalizedOld, input.new_string);
        replacedCount = 1;
      }

      // 5. Write back
      await invoke<string>('write_file', {
        path: input.file_path,
        content: newContent,
        workDir: cwd
      });

      return {
        success: true,
        data: {
          filePath: input.file_path,
          success: true,
          replacedLines: replacedCount,
          oldContent: input.old_string,
          newContent: input.new_string
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: FileEditInput): Promise<string> {
    return `Edit a file by replacing exact text. Use for modifying specific lines.`;
  }

  isReadOnly(): boolean {
    return false;
  }

  isDestructive(_input: FileEditInput): boolean {
    return true;
  }
}

// ============== Schema 定义 ==============

export const FileEditInputSchema = z.object({
  file_path: z.string().describe('Path to the file to edit'),
  old_string: z.string().describe('Exact text to find and replace'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z.boolean().describe('Replace all occurrences')
});

export const FileEditOutputSchema = z.object({
  filePath: z.string(),
  success: z.boolean(),
  replacedLines: z.number(),
  oldContent: z.string(),
  newContent: z.string()
});

export type FileEditInput = z.infer<typeof FileEditInputSchema>;
export type FileEditOutput = z.infer<typeof FileEditOutputSchema>;



// 导出单例
export const fileEditTool = new FileEditTool();
