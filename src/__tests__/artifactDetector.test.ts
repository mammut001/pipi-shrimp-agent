import { jest } from '@jest/globals';

import {
  addFileArtifact,
  ARTIFACT_PATH_OUTSIDE_ROOTS,
  detectAndRegisterArtifacts,
  getAllowedArtifactRoots,
  isPathInsideAnyArtifactRoot,
  validateArtifactPathWithinAllowedRoots,
} from '../services/artifactDetector';
import { useArtifactsStore } from '../store/artifactsStore';

jest.mock('../store/artifactsStore', () => {
  const mockAddArtifacts = jest.fn();
  const mockAddArtifact = jest.fn(() => 'artifact-id-1');
  const store = {
    items: [],
    addArtifacts: mockAddArtifacts,
    addArtifact: mockAddArtifact,
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
    if (store.addArtifact.mockClear) store.addArtifact.mockClear();
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

  it('accepts_path_inside_workDir', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /project/report.md',
      workDir: '/project',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
  });

  it('accepts_path_inside_outputDir', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /tmp/pipi-output/plan.md',
      outputDir: '/tmp/pipi-output',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
  });

  it('accepts_outputDir_when_workDir_is_undefined', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Generated /tmp/pipi-output/report.pdf',
      outputDir: '/tmp/pipi-output',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
  });

  it('rejects_absolute_path_when_both_roots_undefined (R7-04)', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /etc/passwd',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('rejects_path_outside_both_roots', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /outside/report.md',
      workDir: '/project',
      outputDir: '/tmp/pipi-output',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('rejects_prefix_trick', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /tmp/outside/file.txt',
      outputDir: '/tmp/out',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('rejects_traversal_escape_from_outputDir', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /tmp/output/../secret.txt',
      outputDir: '/tmp/output',
    });
    expect(store.addArtifacts).not.toHaveBeenCalled();
  });

  it('allows_both_roots_without_confusion', async () => {
    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /tmp/project/report.md',
      workDir: '/tmp/project',
      outputDir: '/tmp/pipi-output',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
    const projectCalls = store.addArtifacts.mock.calls[0][0];
    expect(projectCalls[0].filePath).toBe('/tmp/project/report.md');

    store.addArtifacts.mockClear();

    await detectAndRegisterArtifacts({
      messageId: mockMessageId,
      toolName: 'write_file',
      toolArgs: '{}',
      toolResultText: 'Saved to /tmp/pipi-output/plan.md',
      workDir: '/tmp/project',
      outputDir: '/tmp/pipi-output',
    });
    expect(store.addArtifacts).toHaveBeenCalled();
    const outputCalls = store.addArtifacts.mock.calls[0][0];
    expect(outputCalls[0].filePath).toBe('/tmp/pipi-output/plan.md');
  });

  it('accepts Windows-style paths under workDir root', () => {
    const roots = getAllowedArtifactRoots({ workDir: 'C:\\project' });
    expect(isPathInsideAnyArtifactRoot('C:\\project\\out.txt', roots)).toBe(true);
    expect(isPathInsideAnyArtifactRoot('C:\\outside\\out.txt', roots)).toBe(false);
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

  describe('addFileArtifact (R7-05)', () => {
    it('addFileArtifact_accepts_path_under_workDir', () => {
      const id = addFileArtifact(mockMessageId, '/project/report.pdf', 'report.pdf', {
        workDir: '/project',
      });
      expect(id).toBe('artifact-id-1');
      expect(store.addArtifact).toHaveBeenCalledWith(expect.objectContaining({
        filePath: '/project/report.pdf',
      }));
    });

    it('addFileArtifact_accepts_path_under_outputDir', () => {
      addFileArtifact(mockMessageId, '/tmp/pipi-output/plan.md', 'plan.md', {
        outputDir: '/tmp/pipi-output',
      });
      expect(store.addArtifact).toHaveBeenCalledWith(expect.objectContaining({
        filePath: '/tmp/pipi-output/plan.md',
      }));
    });

    it('addFileArtifact_rejects_absolute_path_when_roots_undefined', () => {
      expect(() => addFileArtifact(mockMessageId, '/etc/passwd')).toThrow(ARTIFACT_PATH_OUTSIDE_ROOTS);
      expect(store.addArtifact).not.toHaveBeenCalled();
    });

    it('addFileArtifact_rejects_path_outside_both_roots', () => {
      expect(() => addFileArtifact(mockMessageId, '/outside/report.md', undefined, {
        workDir: '/project',
        outputDir: '/tmp/pipi-output',
      })).toThrow(ARTIFACT_PATH_OUTSIDE_ROOTS);
      expect(store.addArtifact).not.toHaveBeenCalled();
    });

    it('addFileArtifact_rejects_prefix_trick', () => {
      expect(() => addFileArtifact(mockMessageId, '/tmp/outside/file.txt', undefined, {
        outputDir: '/tmp/out',
      })).toThrow(ARTIFACT_PATH_OUTSIDE_ROOTS);
    });

    it('addFileArtifact_rejects_traversal_escape', () => {
      expect(() => addFileArtifact(mockMessageId, '/tmp/output/../secret.txt', undefined, {
        outputDir: '/tmp/output',
      })).toThrow(ARTIFACT_PATH_OUTSIDE_ROOTS);
    });

    it('addFileArtifact_uses_session_pipiOutputDir', () => {
      const pipiOutputDir = '/home/user/PiPi-Shrimp/chats/session-1';
      addFileArtifact(mockMessageId, `${pipiOutputDir}/docs/report.md`, 'report.md', {
        outputDir: pipiOutputDir,
      });
      expect(store.addArtifact).toHaveBeenCalledWith(expect.objectContaining({
        filePath: `${pipiOutputDir}/docs/report.md`,
      }));
    });
  });

  describe('shared artifact path policy', () => {
    it('artifactDetector_and_addFileArtifact_share_policy', () => {
      const roots = { workDir: '/tmp/project', outputDir: '/tmp/pipi-output' };
      const allowed = validateArtifactPathWithinAllowedRoots('/tmp/pipi-output/plan.md', roots);
      const rejected = validateArtifactPathWithinAllowedRoots('/etc/passwd', roots);

      expect(allowed).toEqual({ ok: true, rootKind: 'outputDir', resolvedPath: '/tmp/pipi-output/plan.md' });
      expect(rejected).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
    });
  });
});