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
});