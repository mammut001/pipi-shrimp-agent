import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 文件写入工具
 */
export class FileWriteTool extends BaseTool<FileWriteInput, FileWriteOutput> {
  readonly name = 'FileWrite';
  readonly aliases = ['Write', 'file_write', 'WriteFile'];
  readonly searchHint = 'write file create save edit';
  readonly maxResultSizeChars = 500000;

  readonly inputSchema = FileWriteInputSchema;
  readonly outputSchema = FileWriteOutputSchema;

  async execute(input: FileWriteInput, context: ToolContext): Promise<ToolResult<FileWriteOutput>> {
    try {
      // Check if file already exists
      let isUpdate = false;
      try {
        await invoke<boolean>('path_exists', { path: input.file_path, workDir: context.cwd || undefined });
        isUpdate = true;
      } catch {
        isUpdate = false;
      }

      // Write file via Rust (returns success string)
      await invoke<string>('write_file', {
        path: input.file_path,
        content: input.content,
        workDir: context.cwd || undefined
      });

      return {
        success: true,
        data: {
          type: isUpdate ? 'update' : 'create',
          filePath: input.file_path,
          content: input.content,
          numLines: input.content.split('\n').length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: FileWriteInput): Promise<string> {
    return `Write content to a file. Creates new file or overwrites existing.`;
  }

  isReadOnly(): boolean {
    return false;
  }

  isDestructive(_input: FileWriteInput): boolean {
    return true;  // 写入是破坏性操作
  }
}

// ============== Schema 定义 ==============

export const FileWriteInputSchema = z.object({
  file_path: z.string().describe('Path to the file to write'),
  content: z.string().describe('Content to write to the file')
});

export const FileWriteOutputSchema = z.object({
  type: z.enum(['create', 'update']),
  filePath: z.string(),
  content: z.string(),
  numLines: z.number()
});

export type FileWriteInput = z.infer<typeof FileWriteInputSchema>;
export type FileWriteOutput = z.infer<typeof FileWriteOutputSchema>;



// 导出单例
export const fileWriteTool = new FileWriteTool();
