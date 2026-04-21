import {
  getWorkspacePreviewKind,
  isPreviewableWorkspaceFile,
  pickPreferredWorkspacePreview,
} from '@/utils/workspacePreview';

describe('workspacePreview helpers', () => {
  it('classifies previewable workspace files by kind', () => {
    expect(getWorkspacePreviewKind('/tmp/docs/spec.md')).toBe('markdown');
    expect(getWorkspacePreviewKind('/tmp/docs/preview.html')).toBe('html');
    expect(getWorkspacePreviewKind('/tmp/docs/config.json')).toBe('code');
    expect(getWorkspacePreviewKind('/tmp/docs/notes.txt')).toBe('text');
    expect(getWorkspacePreviewKind('/tmp/docs/image.png')).toBe('other');
    expect(isPreviewableWorkspaceFile('/tmp/docs/spec.md')).toBe(true);
    expect(isPreviewableWorkspaceFile('/tmp/docs/image.png')).toBe(false);
  });

  it('prefers generated docs markdown over general workspace files', () => {
    const selected = pickPreferredWorkspacePreview([
      { path: '/tmp/session/README.md', isDirectory: false, section: 'workspace' },
      { path: '/tmp/session/.pipi-shrimp/docs/report.html', isDirectory: false, section: 'generated' },
      { path: '/tmp/session/.pipi-shrimp/docs/brief.md', isDirectory: false, section: 'generated' },
      { path: '/tmp/session/src/index.ts', isDirectory: false, section: 'workspace' },
    ]);

    expect(selected).toBe('/tmp/session/.pipi-shrimp/docs/brief.md');
  });

  it('ignores directories and unsupported files when selecting a default preview', () => {
    const selected = pickPreferredWorkspacePreview([
      { path: '/tmp/session/docs', isDirectory: true, section: 'workspace' },
      { path: '/tmp/session/assets/logo.png', isDirectory: false, section: 'workspace' },
    ]);

    expect(selected).toBeNull();
  });
});