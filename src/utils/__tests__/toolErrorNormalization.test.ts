import { normalizeStructuredToolError } from '../toolErrorNormalization';

describe('normalizeStructuredToolError', () => {
  const noProjectJson = JSON.stringify({
    error: true,
    error_kind: 'permission_denied',
    message: "No Project Folder is bound to this session. Set a Project Folder (the user's repo) before running workspace tools like list_files, write_file, create_directory, execute_command, or compile_typst_file.",
    tool: 'write_file',
    cause: "No Project Folder is bound to this session. Set a Project Folder (the user's repo) before running workspace tools like list_files, write_file, create_directory, execute_command, or compile_typst_file.",
  });

  it('normalizes missing project folder error into user-friendly Chinese message', () => {
    const normalized = normalizeStructuredToolError(noProjectJson, 'zh-CN');
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe('no_project_folder');
    expect(normalized?.userMessage).toBe('当前会话还没有绑定项目文件夹。请先选择项目文件夹，再执行读取、写入或命令操作。');
    expect(normalized?.noOpNotice).toContain('未执行任何文件或命令操作');
    expect(normalized?.actionKind).toBe('select_project_folder');
    expect(normalized?.rawDetails).toBe(noProjectJson);
  });

  it('normalizes missing project folder error into user-friendly English message', () => {
    const normalized = normalizeStructuredToolError(noProjectJson, 'en-US');
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe('no_project_folder');
    expect(normalized?.userMessage).toBe('No Project Folder is bound to this session. Please select a Project Folder before reading, writing, or executing commands.');
    expect(normalized?.noOpNotice).toContain('No file or command operation was performed');
    expect(normalized?.actionKind).toBe('select_project_folder');
  });

  it('handles plain text containing No Project Folder is bound', () => {
    const text = 'Error: No Project Folder is bound to this session.';
    const normalized = normalizeStructuredToolError(text, 'zh-CN');
    expect(normalized?.kind).toBe('no_project_folder');
    expect(normalized?.userMessage).toContain('当前会话还没有绑定项目文件夹');
  });

  it('returns null for normal success output', () => {
    const successResult = 'File written successfully to src/main.rs';
    expect(normalizeStructuredToolError(successResult, 'zh-CN')).toBeNull();
  });
});
