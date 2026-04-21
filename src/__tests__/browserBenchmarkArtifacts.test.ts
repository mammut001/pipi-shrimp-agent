const createDocMock = jest.fn();
const addFileArtifactMock = jest.fn();
const openPanelMock = jest.fn();

jest.mock('@/services/docService', () => ({
  createDoc: (...args: unknown[]) => createDocMock(...args),
}));

jest.mock('@/services/artifactDetector', () => ({
  addFileArtifact: (...args: unknown[]) => addFileArtifactMock(...args),
}));

jest.mock('@/store/artifactsStore', () => ({
  useArtifactsStore: {
    getState: () => ({
      openPanel: openPanelMock,
    }),
  },
}));

import { DOCS_CHANGED_EVENT, saveBrowserBenchmarkArtifact } from '@/services/browserBenchmarkArtifacts';

describe('saveBrowserBenchmarkArtifact', () => {
  beforeEach(() => {
    createDocMock.mockReset();
    addFileArtifactMock.mockReset();
    openPanelMock.mockReset();
    createDocMock.mockResolvedValue({
      number: '019',
      filename: '019-browser-benchmark-report.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/019-browser-benchmark-report.md',
      index_updated: true,
    });
    addFileArtifactMock.mockReturnValue('artifact-1');

    Object.defineProperty(globalThis, 'CustomEvent', {
      value: class CustomEvent<T = unknown> extends Event {
        detail: T;

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
      configurable: true,
      writable: true,
    });
  });

  it('persists markdown into docs and opens the artifact panel', async () => {
    const dispatchEvent = jest.fn();

    Object.defineProperty(globalThis, 'window', {
      value: {
        dispatchEvent,
      },
      configurable: true,
      writable: true,
    });

    const result = await saveBrowserBenchmarkArtifact({
      sessionId: 'session-1',
      workDir: '/tmp/pipi/session-1',
      markdown: '# Browser Benchmark Report',
      generatedAtMs: Date.UTC(2025, 2, 11, 10, 20, 30),
    });

    expect(createDocMock).toHaveBeenCalledWith('/tmp/pipi/session-1', expect.objectContaining({
      body: '# Browser Benchmark Report',
      tags: ['browser', 'observability', 'benchmark'],
    }));
    expect(addFileArtifactMock).toHaveBeenCalledWith(
      'browser-benchmark:session-1',
      '/tmp/pipi/session-1/.pipi-shrimp/docs/019-browser-benchmark-report.md',
      '019-browser-benchmark-report.md',
    );
    expect(openPanelMock).toHaveBeenCalledWith('browser-benchmark:session-1', 'artifact-1');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DOCS_CHANGED_EVENT }));
    expect(result).toEqual({
      artifactId: 'artifact-1',
      messageId: 'browser-benchmark:session-1',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/019-browser-benchmark-report.md',
    });
  });

  it('rejects when no workDir is available', async () => {
    await expect(
      saveBrowserBenchmarkArtifact({
        sessionId: 'session-1',
        workDir: null,
        markdown: '# Browser Benchmark Report',
      }),
    ).rejects.toThrow('A session workDir is required to persist benchmark reports.');

    expect(createDocMock).not.toHaveBeenCalled();
  });
});