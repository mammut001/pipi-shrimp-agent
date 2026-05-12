import { jest } from '@jest/globals';

const writeFileMock = jest.fn(async () => '/tmp/workflow-run/output.md');

jest.mock('@/services/workflow', () => ({
  workflowService: {
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  },
}));

import {
  normalizeWorkflowRunRelativePath,
  resolveWorkflowRunFilePath,
  workflowRunFileService,
} from '../workflow/runFileService';

describe('workflowRunFileService', () => {
  beforeEach(() => {
    writeFileMock.mockClear();
  });

  it('resolves safe relative paths under the run directory', () => {
    expect(normalizeWorkflowRunRelativePath('artifacts/output.md')).toBe('artifacts/output.md');
    expect(resolveWorkflowRunFilePath('/tmp/workflow-run/', 'artifacts/output.md')).toBe('/tmp/workflow-run/artifacts/output.md');
  });

  it('rejects absolute and escaping paths', () => {
    expect(() => normalizeWorkflowRunRelativePath('../outside.md')).toThrow('cannot escape');
    expect(() => normalizeWorkflowRunRelativePath('/tmp/outside.md')).toThrow('relative paths');
    expect(() => resolveWorkflowRunFilePath('relative-dir', 'output.md')).toThrow('absolute path');
  });

  it('writes files only after resolving them inside the run directory', async () => {
    const filePath = await workflowRunFileService.writeRunFile('/tmp/workflow-run', 'logs/output.md', 'content');

    expect(filePath).toBe('/tmp/workflow-run/logs/output.md');
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/workflow-run/logs/output.md', 'content');
  });
});