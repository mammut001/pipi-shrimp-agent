import { addFileArtifact } from '@/services/artifactDetector';
import { createDoc } from '@/services/docService';
import { useArtifactsStore } from '@/store/artifactsStore';

export const DOCS_CHANGED_EVENT = 'pipi:docs-changed';

export interface DocsChangedEventDetail {
  workDir: string;
  path: string;
}

interface SaveBrowserBenchmarkArtifactOptions {
  sessionId?: string | null;
  workDir?: string | null;
  markdown: string;
  generatedAtMs?: number;
}

function formatBenchmarkDocTitle(timestamp: number): string {
  const formatted = new Date(timestamp).toLocaleString('sv-SE', {
    hour12: false,
  }).replace(' ', ' ');

  return `Browser Benchmark Report ${formatted}`;
}

export async function saveBrowserBenchmarkArtifact({
  sessionId,
  workDir,
  markdown,
  generatedAtMs = Date.now(),
}: SaveBrowserBenchmarkArtifactOptions): Promise<{ artifactId: string; messageId: string; path: string }> {
  if (!workDir) {
    throw new Error('A session workDir is required to persist benchmark reports.');
  }

  const doc = await createDoc(workDir, {
    title: formatBenchmarkDocTitle(generatedAtMs),
    body: markdown,
    tags: ['browser', 'observability', 'benchmark'],
    summary: 'Browser observability benchmark report exported from the debug panel.',
  });

  const messageId = `browser-benchmark:${sessionId ?? 'workspace'}`;
  const artifactId = addFileArtifact(messageId, doc.path, doc.filename);

  useArtifactsStore.getState().openPanel(messageId, artifactId);

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent<DocsChangedEventDetail>(DOCS_CHANGED_EVENT, {
      detail: {
        workDir,
        path: doc.path,
      },
    }));
  }

  return {
    artifactId,
    messageId,
    path: doc.path,
  };
}