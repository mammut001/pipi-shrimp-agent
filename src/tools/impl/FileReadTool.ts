import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 文件读取工具
 * 支持文本、图片、PDF 读取
 */
export class FileReadTool extends BaseTool<FileReadInput, FileReadOutput> {
  readonly name = 'FileRead';
  readonly aliases = ['Read', 'file_read'];
  readonly searchHint = 'read file content view open';
  readonly maxResultSizeChars = 100000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = FileReadInputSchema;
  readonly outputSchema = FileReadOutputSchema;

  async execute(input: FileReadInput, context: ToolContext): Promise<ToolResult<FileReadOutput>> {
    try {
      // Detect file type by extension
      const ext = input.file_path.split('.').pop()?.toLowerCase() || '';
      const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

      if (IMAGE_EXTS.has(ext)) {
        // For images, try to read as binary via Rust and return base64
        // If Rust doesn't support binary read yet, return error with clear message
        try {
          const binaryResult = await invoke<{ content: string; path: string }>('read_binary_file', {
            path: input.file_path,
            workDir: context.cwd || undefined
          });

          // Rust returns base64-encoded content in 'content' field
          return {
            success: true,
            data: {
              type: 'image',
              file: {
                base64: binaryResult.content || '',
                type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                originalSize: binaryResult.content?.length ? Math.ceil(binaryResult.content.length * 3 / 4) : 0,
                dimensions: { width: 0, height: 0 }  // TODO: extract from image metadata
              }
            }
          };
        } catch (error) {
          // Binary read not implemented yet in Rust
          return {
            success: false,
            error: `Image reading not yet implemented: ${(error as Error).message}. Please use text files only.`
          };
        }
      }

      // Text read via Rust
      const result = await invoke<{ content: string; path: string }>('read_file', {
        path: input.file_path,
        workDir: context.cwd || undefined
      });

      let content = result.content || '';
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      // Apply offset / limit slicing
      const offset = input.offset ?? 0;
      const limit = input.limit ?? allLines.length;
      const sliced = allLines.slice(offset, offset + limit);
      content = sliced.join('\n');

      // Truncate if over maxResultSizeChars
      let truncated = false;
      if (content.length > this.maxResultSizeChars) {
        content = content.slice(0, this.maxResultSizeChars);
        truncated = true;
      }

      return {
        success: true,
        data: {
          type: 'text',
          file: {
            filePath: input.file_path,
            content,
            numLines: sliced.length,
            startLine: offset,
            totalLines
          }
        },
        metadata: { truncated }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: FileReadInput): Promise<string> {
    return `Read the contents of a file. Supports text files, images (returns base64), and PDFs.`;
  }

  isReadOnly(_input: FileReadInput): boolean {
    return true;
  }

  isConcurrencySafe(_input: FileReadInput): boolean {
    return true;
  }
}

// ============== Schema 定义 ==============

export const FileReadInputSchema = z.object({
  file_path: z.string().describe('Path to the file to read'),
  offset: z.number().int().nonnegative().optional().describe('Line offset to start reading from'),
  limit: z.number().int().positive().optional().describe('Maximum number of lines to read'),
  pages: z.string().optional().describe('PDF pages to read, e.g., "1-5" or "3"')
});

export const FileReadOutputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    file: z.object({
      filePath: z.string(),
      content: z.string(),
      numLines: z.number(),
      startLine: z.number(),
      totalLines: z.number()
    })
  }),
  z.object({
    type: z.literal('image'),
    file: z.object({
      base64: z.string(),
      type: z.string(),
      originalSize: z.number(),
      dimensions: z.object({
        width: z.number(),
        height: z.number()
      })
    })
  }),
  z.object({
    type: z.literal('pdf'),
    file: z.object({
      filePath: z.string(),
      pages: z.string()
    })
  })
]);

export type FileReadInput = z.infer<typeof FileReadInputSchema>;
export type FileReadOutput = z.infer<typeof FileReadOutputSchema>;



// 导出单例
export const fileReadTool = new FileReadTool();
