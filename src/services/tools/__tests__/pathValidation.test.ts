import { describe, expect, it } from '@jest/globals';
import { validatePath } from '../pathValidation';

describe('pathValidation', () => {
  it('rejects sibling-prefix paths outside workDir', () => {
    const result = validatePath('/project2/secret.txt', '/project');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/outside working directory/i);
  });

  it('allows paths inside workDir', () => {
    const result = validatePath('/project/src/main.ts', '/project');
    expect(result.isValid).toBe(true);
  });

  it('rejects path traversal outside workDir', () => {
    const result = validatePath('../outside/secret.txt', '/project');
    expect(result.isValid).toBe(false);
  });

  // AUDIT-FIX [R7-16]: Windows system dirs and sensitive files.
  describe('Windows paths (R7-16)', () => {
    it('rejects C:\\Windows\\System32 paths', () => {
      const result = validatePath('C:\\Windows\\System32\\drivers\\etc\\hosts');
      expect(result.isValid).toBe(false);
      // Either blocked-file (sensitive) or blocked-dir (system) is acceptable;
      // what matters is that the path is rejected.
      expect(result.error).toMatch(/(system directory|sensitive file)/i);
    });

    it('rejects C:\\Program Files paths', () => {
      const result = validatePath('C:\\Program Files\\tool.exe');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/(system directory|sensitive file)/i);
    });

    it('rejects C:\\ProgramData paths', () => {
      const result = validatePath('C:\\ProgramData\\Microsoft\\config.xml');
      expect(result.isValid).toBe(false);
    });

    it('rejects Windows sensitive files case-insensitively', () => {
      const lower = validatePath('c:\\windows\\system32\\config\\sam');
      const upper = validatePath('C:\\WINDOWS\\System32\\Config\\SAM');
      expect(lower.isValid).toBe(false);
      expect(upper.isValid).toBe(false);
    });

    it('allows benign Windows paths', () => {
      const result = validatePath('C:\\Users\\alice\\Documents\\notes.txt');
      expect(result.isValid).toBe(true);
    });

    it('still blocks /etc/ on Unix paths', () => {
      const result = validatePath('/etc/passwd');
      expect(result.isValid).toBe(false);
    });
  });
});