import { jest } from '@jest/globals';

import { detectAndRegisterArtifacts } from '../services/artifactDetector';
import { useArtifactsStore } from '../store/artifactsStore';

jest.mock('../store/artifactsStore', () => {
  const mockAddArtifacts = jest.fn();
  const store = {
    items: [],
    addArtifacts: mockAddArtifacts,
  };
  return {
    useArtifactsStore: {
      getState: () => store,
    },
  };
});

jest.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => "asset://" + path,
}), { virtual: true });

describe('artifactDetector', () => {
  const mockMessageId = 'test-msg-123';
  let store: any;

  beforeEach(() => {
    store = useArtifactsStore.getState();
    store.items = [];
    if (store.addArtifacts.mockClear) store.addArtifacts.mockClear();
  });

  it('should ignore read-only tools like read_file', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'read_file',
      toolArgs: '{}',
      toolResultText: 'File content of /project/report.pdf',
      workDir: '/project',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('should ignore grep_files outout', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'grep_files',
      toolArgs: '{}',
      toolResultText: '/project/report.pdf: 1 match',
      workDir: '/project',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('should register for write_file inside workDir', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /project/report.md',
      workDir: '/project',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
  });

  it('should reject paths outside workDir', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /outside/report.md',
      workDir: '/project',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('should register pdf and svg from compile_typst_file', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'compile_typst_file',
      toolArgs: '{}',
      toolResultText: 'PDF: /project/out/resume.pdf\nSVG: /project/out/resume.svg',
      workDir: '/project',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
    const calls = store.addArtifacts.mock.calls[0][0];
    expect(calls.length).toBe(2);
    expect(calls[0].filePath).toBe('/project/out/resume.pdf');
    expect(calls[1].filePath).toBe('/project/out/resume.svg');
  });

  it('should not register arbitrary ts files for compile_typst_file', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'compile_typst_file',
      toolArgs: '{}',
      toolResultText: 'Some output /project/src/main.ts',
      workDir: '/project',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });
});
