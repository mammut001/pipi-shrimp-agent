import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FileReadTool } from '../FileReadTool';
import { FileWriteTool } from '../FileWriteTool';
import type { ToolContext } from '../../base/Tool';

const mockInvoke = jest.mocked(invoke);
const context = { cwd: '/workspace/project' } as ToolContext;

describe('FileReadTool and FileWriteTool scoped file operations', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('passes the scoped work directory to reads and applies the requested line window', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: 'first\nsecond\nthird',
      path: '/workspace/project/notes.txt',
    });

    const result = await new FileReadTool().execute(
      { file_path: 'notes.txt', offset: 1, limit: 1 },
      context,
    );

    expect(mockInvoke).toHaveBeenCalledWith('read_file', {
      path: 'notes.txt',
      workDir: '/workspace/project',
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'text',
        file: {
          filePath: 'notes.txt',
          content: 'second',
          numLines: 1,
          startLine: 1,
          totalLines: 3,
        },
      },
    });
  });

  it('creates a new file when the scoped existence check returns false', async () => {
    mockInvoke.mockResolvedValueOnce(false).mockResolvedValueOnce('written');

    const result = await new FileWriteTool().execute(
      { file_path: 'reports/run.md', content: 'first line\nsecond line' },
      context,
    );

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'path_exists', {
      path: 'reports/run.md',
      workDir: '/workspace/project',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'write_file', {
      path: 'reports/run.md',
      content: 'first line\nsecond line',
      workDir: '/workspace/project',
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'create',
        filePath: 'reports/run.md',
        numLines: 2,
      },
    });
  });

  it('requires explicit force before overwriting an existing file', async () => {
    mockInvoke.mockResolvedValueOnce(true);

    const result = await new FileWriteTool().execute(
      { file_path: 'reports/run.md', content: 'replacement' },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
