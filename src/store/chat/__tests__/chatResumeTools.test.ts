import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  findNestedResumeTyp,
  normalizeCompileTypstArgs,
  normalizeResumeWorkspacePath,
  normalizeResumeWorkspaceToolArgs,
  parentDirOf,
  trimTrailingSlash,
} from '../chatResumeTools';

describe('chatResumeTools', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes nested resume workspace paths back to the bound workDir', () => {
    expect(trimTrailingSlash('/work///')).toBe('/work');
    expect(parentDirOf('/work/resume/resume.typ')).toBe('/work/resume');
    expect(normalizeResumeWorkspacePath('/work/resume', '/work')).toBe('/work');
    expect(normalizeResumeWorkspacePath('/work/resume/out.svg', '/work')).toBe('/work/out.svg');
    expect(normalizeResumeWorkspacePath('resume/out.svg', '/work')).toBe('/work/out.svg');
    expect(normalizeResumeWorkspacePath('/other/resume/out.svg', '/work')).toBe('/other/resume/out.svg');
  });

  it('rewrites resume tool arguments only when the resume skill is active', () => {
    const args = JSON.stringify({ path: 'resume/out.svg', output_dir: '/work/resume' });

    expect(JSON.parse(normalizeResumeWorkspaceToolArgs('write_file', args, '/work', 'resume'))).toEqual({
      path: '/work/out.svg',
      output_dir: '/work',
    });
    expect(normalizeResumeWorkspaceToolArgs('write_file', args, '/work', 'pdf')).toBe(args);
    expect(normalizeResumeWorkspaceToolArgs('write_file', '{bad json', '/work', 'resume')).toBe('{bad json');
  });

  it('finds nested resume.typ candidates from visible directories', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return [
          { name: '.cache', is_directory: true, path: '/work/.cache' },
          { name: 'draft', is_directory: true, path: '/work/draft' },
          { name: 'resume', is_directory: true, path: '/work/resume' },
        ];
      }
      if (command === 'path_exists') {
        return (args as { path: string }).path === '/work/resume/resume.typ';
      }
      return undefined;
    });

    await expect(findNestedResumeTyp('/work')).resolves.toBe('/work/resume/resume.typ');
  });

  it('normalizes compile_typst_file file and output paths when the original file is missing', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'path_exists') {
        return (args as { path: string }).path === '/work/resume/resume.typ';
      }
      if (command === 'list_files') {
        return [{ name: 'resume', is_directory: true, path: '/work/resume' }];
      }
      return undefined;
    });

    const normalized = await normalizeCompileTypstArgs(
      JSON.stringify({ file_path: '/work/resume.typ', output_dir: '/work' }),
      '/work',
    );

    expect(JSON.parse(normalized)).toEqual({
      file_path: '/work/resume/resume.typ',
      output_dir: '/work/resume',
    });
  });
});
