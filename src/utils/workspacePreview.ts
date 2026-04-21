export type WorkspacePreviewKind = 'markdown' | 'html' | 'code' | 'text' | 'other';

export type WorkspacePreviewSection = 'generated' | 'workspace';

export interface WorkspacePreviewCandidate {
  path: string;
  isDirectory: boolean;
  section: WorkspacePreviewSection;
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.py',
  '.sh',
  '.yaml',
  '.yml',
  '.css',
  '.scss',
  '.sql',
  '.toml',
  '.rs',
]);
const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.csv']);

function fileExtension(path: string): string {
  const normalized = path.toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));

  if (lastDot === -1 || lastDot < lastSlash) {
    return '';
  }

  return normalized.slice(lastDot);
}

export function getWorkspacePreviewKind(path: string): WorkspacePreviewKind {
  const extension = fileExtension(path);

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown';
  }

  if (HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return 'code';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  return 'other';
}

export function isPreviewableWorkspaceFile(path: string): boolean {
  return getWorkspacePreviewKind(path) !== 'other';
}

function previewPriority(candidate: WorkspacePreviewCandidate): number {
  if (candidate.isDirectory) {
    return Number.MAX_SAFE_INTEGER;
  }

  const kind = getWorkspacePreviewKind(candidate.path);
  const inDocsPath = candidate.path.includes('/docs/') || candidate.path.includes('\\docs\\');
  const sectionBias = candidate.section === 'generated' ? -2 : 0;
  const docsBias = inDocsPath ? -1 : 0;

  switch (kind) {
    case 'markdown':
      return 2 + sectionBias + docsBias;
    case 'html':
      return 4 + sectionBias + docsBias;
    case 'text':
      return 6 + sectionBias;
    case 'code':
      return 8 + sectionBias;
    default:
      return Number.MAX_SAFE_INTEGER - 1;
  }
}

export function pickPreferredWorkspacePreview(candidates: WorkspacePreviewCandidate[]): string | null {
  const best = candidates
    .filter((candidate) => !candidate.isDirectory)
    .filter((candidate) => isPreviewableWorkspaceFile(candidate.path))
    .sort((left, right) => {
      const priorityDelta = previewPriority(left) - previewPriority(right);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.path.localeCompare(right.path);
    })[0];

  return best?.path ?? null;
}