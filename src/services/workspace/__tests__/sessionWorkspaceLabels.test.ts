/**
 * sessionWorkspaceLabels unit tests
 *
 * These cover the pure helpers that distinguish "Workspace Folder" from
 * "Context Files" in the UI. The helpers are intentionally platform-agnostic
 * (they accept both POSIX and Windows-style separators) so we can run the
 * tests in jsdom without mocking OS-specific APIs.
 */

import { describe, it, expect } from '@jest/globals';
import {
  formatContextFilePath,
  getParentDirectory,
  getWorkspaceDisplayName,
  isContextFileInsideWorkspace,
  isSamePath,
} from '@/services/workspace/sessionWorkspaceLabels';

describe('getWorkspaceDisplayName', () => {
  it('returns the final path segment', () => {
    expect(getWorkspaceDisplayName('/Users/alice/projects/pipishrimp')).toBe('pipishrimp');
  });

  it('handles Windows-style separators', () => {
    expect(getWorkspaceDisplayName('C:\\Users\\alice\\projects\\pipishrimp')).toBe('pipishrimp');
  });

  it('falls back to the input when path is empty', () => {
    expect(getWorkspaceDisplayName('')).toBe('');
    expect(getWorkspaceDisplayName(null)).toBe('');
    expect(getWorkspaceDisplayName(null, 'No workspace')).toBe('No workspace');
  });

  it('strips trailing separators before extracting the name', () => {
    expect(getWorkspaceDisplayName('/Users/alice/projects/')).toBe('projects');
  });
});

describe('isSamePath', () => {
  it('matches identical paths', () => {
    expect(isSamePath('/a/b', '/a/b')).toBe(true);
  });

  it('matches paths that differ only by slash style or trailing slash', () => {
    expect(isSamePath('C:/a/b', 'C:\\a\\b')).toBe(true);
    expect(isSamePath('C:/a/b/', 'C:/a/b')).toBe(true);
  });

  it('is case-insensitive on Windows-style paths', () => {
    expect(isSamePath('C:\\Users\\Alice', 'c:\\users\\alice')).toBe(true);
  });

  it('returns false for missing inputs or different paths', () => {
    expect(isSamePath(null, '/a')).toBe(false);
    expect(isSamePath('/a', null)).toBe(false);
    expect(isSamePath('/a/b', '/a/c')).toBe(false);
  });
});

describe('isContextFileInsideWorkspace', () => {
  it('returns true when the file lives under the workspace', () => {
    expect(
      isContextFileInsideWorkspace('/proj/src/main.ts', '/proj'),
    ).toBe(true);
    expect(
      isContextFileInsideWorkspace('C:\\proj\\src\\main.ts', 'C:/proj'),
    ).toBe(true);
  });

  it('returns false when the file is outside the workspace', () => {
    expect(
      isContextFileInsideWorkspace('/other/src/main.ts', '/proj'),
    ).toBe(false);
    expect(
      isContextFileInsideWorkspace('/proj-other/main.ts', '/proj'),
    ).toBe(false);
  });

  it('is false when the workspace is the file itself (file is at the workspace root)', () => {
    // Path-equality is not "inside"; only descendants are.
    expect(
      isContextFileInsideWorkspace('/proj', '/proj'),
    ).toBe(false);
  });

  it('returns false when either input is missing', () => {
    expect(isContextFileInsideWorkspace(null, '/proj')).toBe(false);
    expect(isContextFileInsideWorkspace('/proj/src/main.ts', null)).toBe(false);
    expect(isContextFileInsideWorkspace('', '')).toBe(false);
  });
});

describe('formatContextFilePath', () => {
  it('returns a workspace-relative path when the file is inside the workspace', () => {
    expect(
      formatContextFilePath('/proj/src/main.ts', '/proj'),
    ).toBe('src/main.ts');
  });

  it('falls back to the absolute path when the file is outside the workspace', () => {
    expect(
      formatContextFilePath('/other/main.ts', '/proj'),
    ).toBe('/other/main.ts');
  });

  it('returns the original path when the workspace is missing', () => {
    expect(formatContextFilePath('/proj/src/main.ts', null)).toBe('/proj/src/main.ts');
  });

  it('returns "" for empty input so callers can render a placeholder', () => {
    expect(formatContextFilePath('', '/proj')).toBe('');
  });
});

describe('getParentDirectory', () => {
  it('returns the directory one level up', () => {
    expect(getParentDirectory('/proj/src/main.ts')).toBe('proj/src');
    expect(getParentDirectory('C:\\proj\\src\\main.ts')).toBe('C:/proj/src');
  });

  it('returns "" for a single-segment path or empty input', () => {
    expect(getParentDirectory('main.ts')).toBe('');
    expect(getParentDirectory('')).toBe('');
    expect(getParentDirectory(null)).toBe('');
  });
});
