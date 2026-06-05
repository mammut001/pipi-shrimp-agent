import { describe, expect, it } from '@jest/globals';

import { resolveSubagentWorkingDirLabel } from '../subagent';

describe('resolveSubagentWorkingDirLabel', () => {
  it('returns the bound workdir when present', () => {
    expect(resolveSubagentWorkingDirLabel({ workDir: '/tmp/project' })).toBe('/tmp/project');
  });

  it('falls back to a browser-safe label when no workdir is bound', () => {
    expect(resolveSubagentWorkingDirLabel({ workDir: undefined })).toBe('[no bound working directory]');
    expect(resolveSubagentWorkingDirLabel({ workDir: '   ' })).toBe('[no bound working directory]');
  });
});
