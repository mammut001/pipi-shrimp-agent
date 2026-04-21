import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { workflowService, type FileInfo } from '@/services/workflow';
import { FileIcon } from './ui/FileIcon';
import {
  getWorkspacePreviewKind,
  isPreviewableWorkspaceFile,
  pickPreferredWorkspacePreview,
  type WorkspacePreviewSection,
} from '@/utils/workspacePreview';

const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 200;

export const workspacePreviewChrome = {
  shellBg: 'bg-[#f6f5f2]',
  toolbar: 'border-b border-[#e9e9e7] bg-[#fbfbfa]/92 shadow-[0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl',
  eyebrow: 'text-[10px] font-bold uppercase tracking-[0.24em] text-[#8a867f]',
  secondaryText: 'mt-1 text-xs text-[#6f6e69]',
  statusStrip: 'border-t border-[#e9e9e7] bg-[#fbfbfa]/94 shadow-[0_-1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl',
  statusBadge: 'inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e1] bg-white/90 px-2.5 py-1 text-[11px] text-[#6f6e69] shadow-[0_1px_2px_rgba(15,23,42,0.02)]',
  statusValue: 'font-semibold text-[#37352f]',
  segmented: 'inline-flex rounded-full border border-[#e7e5e1] bg-white/88 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.05)]',
  segmentedButton: 'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
  segmentedButtonSmall: 'rounded-full px-3 py-1 text-[11px] font-semibold transition-[background-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
  segmentedButtonActive: 'bg-[#2f251a] text-white shadow-[0_8px_18px_rgba(47,37,26,0.16)]',
  segmentedButtonInactive: 'text-[#6f6e69] hover:bg-[#f3f3f1] hover:text-[#37352f]',
  segmentedButtonInactiveDisabled: 'text-[#6f6e69] hover:bg-[#f3f3f1] hover:text-[#37352f] disabled:cursor-not-allowed disabled:text-[#b8b3aa]',
  actionButton: 'rounded-full border border-[#e7e5e1] bg-white/92 px-3 py-1.5 text-[11px] font-medium text-[#5f5a52] shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition-[background-color,border-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-[#ded9d1] hover:bg-white hover:text-[#37352f] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] active:translate-y-0',
  terminalDivider: 'group flex h-4 flex-shrink-0 cursor-row-resize items-center justify-center border-t border-[#e9e9e7] bg-[#f7f6f3] transition-[background-color,border-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[#e2dfd9] hover:bg-[#fbfbfa]',
  terminalDividerThumb: 'h-1.5 w-12 rounded-full bg-[#d5d1ca] transition-[background-color,transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-[1.04] group-hover:bg-[#c4beb4] group-hover:shadow-[0_4px_10px_rgba(15,23,42,0.08)]',
  subtlePill: 'rounded-full bg-[#f1efeb] px-2.5 py-1 text-[10px] font-medium text-[#7a756d]',
  canvasCard: 'flex min-h-full w-full flex-col overflow-hidden rounded-[24px] border border-[#e9e7e2] bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]',
  emptyCard: 'max-w-md rounded-[28px] border border-[#e9e7e2] bg-white px-8 py-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)]',
} as const;

type WorkspaceFileEntry = FileInfo & {
  depth: number;
  displayName: string;
  isPreviewable: boolean;
  section: WorkspacePreviewSection;
  isVirtual?: boolean;
};

type CollectState = {
  totalEntries: number;
  truncated: boolean;
};

function isHiddenName(name: string): boolean {
  return name.startsWith('.') && name !== '.pipi-shrimp';
}

function joinPath(base: string, next: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${next}`;
}

function sortDirectoryEntries(entries: FileInfo[]): FileInfo[] {
  return [...entries].sort((left, right) => {
    if (left.is_directory !== right.is_directory) {
      return left.is_directory ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function scanDirectory(
  path: string,
  depth: number,
  section: WorkspacePreviewSection,
  entries: WorkspaceFileEntry[],
  state: CollectState,
): Promise<void> {
  if (state.totalEntries >= MAX_SCAN_ENTRIES) {
    state.truncated = true;
    return;
  }

  let directoryEntries: FileInfo[] = [];
  try {
    directoryEntries = sortDirectoryEntries(await workflowService.listDirectory(path));
  } catch {
    return;
  }

  for (const entry of directoryEntries) {
    if (state.totalEntries >= MAX_SCAN_ENTRIES) {
      state.truncated = true;
      break;
    }

    if (isHiddenName(entry.name)) {
      continue;
    }

    const nextEntry: WorkspaceFileEntry = {
      ...entry,
      depth,
      displayName: entry.name,
      isPreviewable: !entry.is_directory && isPreviewableWorkspaceFile(entry.path),
      section,
    };

    entries.push(nextEntry);
    state.totalEntries += 1;

    if (entry.is_directory && depth + 1 < MAX_SCAN_DEPTH) {
      await scanDirectory(entry.path, depth + 1, section, entries, state);
    }
  }
}

async function collectWorkspaceEntries(workDir: string): Promise<{
  entries: WorkspaceFileEntry[];
  truncated: boolean;
}> {
  const entries: WorkspaceFileEntry[] = [];
  const state: CollectState = {
    totalEntries: 0,
    truncated: false,
  };

  let rootEntries: FileInfo[] = [];
  try {
    rootEntries = sortDirectoryEntries(await workflowService.listDirectory(workDir));
  } catch {
    return { entries, truncated: false };
  }

  for (const entry of rootEntries) {
    if (state.totalEntries >= MAX_SCAN_ENTRIES) {
      state.truncated = true;
      break;
    }

    if (isHiddenName(entry.name)) {
      continue;
    }

    if (entry.name === '.pipi-shrimp' && entry.is_directory) {
      const docsPath = joinPath(entry.path, 'docs');
      let docsEntries: FileInfo[] = [];

      try {
        docsEntries = sortDirectoryEntries(await workflowService.listDirectory(docsPath));
      } catch {
        continue;
      }

      const virtualEntry: WorkspaceFileEntry = {
        name: 'Generated docs',
        path: docsPath,
        is_directory: true,
        size: 0,
        modified: entry.modified,
        depth: 0,
        displayName: 'Generated docs',
        isPreviewable: false,
        section: 'generated',
        isVirtual: true,
      };

      entries.push(virtualEntry);
      state.totalEntries += 1;

      for (const docsEntry of docsEntries) {
        if (state.totalEntries >= MAX_SCAN_ENTRIES) {
          state.truncated = true;
          break;
        }

        const nextEntry: WorkspaceFileEntry = {
          ...docsEntry,
          depth: 1,
          displayName: docsEntry.name,
          isPreviewable: !docsEntry.is_directory && isPreviewableWorkspaceFile(docsEntry.path),
          section: 'generated',
        };

        entries.push(nextEntry);
        state.totalEntries += 1;

        if (docsEntry.is_directory && 2 < MAX_SCAN_DEPTH) {
          await scanDirectory(docsEntry.path, 2, 'generated', entries, state);
        }
      }

      continue;
    }

    const nextEntry: WorkspaceFileEntry = {
      ...entry,
      depth: 0,
      displayName: entry.name,
      isPreviewable: !entry.is_directory && isPreviewableWorkspaceFile(entry.path),
      section: 'workspace',
    };

    entries.push(nextEntry);
    state.totalEntries += 1;

    if (entry.is_directory && 1 < MAX_SCAN_DEPTH) {
      await scanDirectory(entry.path, 1, 'workspace', entries, state);
    }
  }

  return {
    entries,
    truncated: state.truncated,
  };
}

function previewModeLabel(path: string | null): string {
  if (!path) {
    return 'Preview';
  }

  switch (getWorkspacePreviewKind(path)) {
    case 'markdown':
      return 'Markdown Preview';
    case 'html':
      return 'HTML Preview';
    case 'code':
      return 'Code Preview';
    case 'text':
      return 'Text Preview';
    default:
      return 'Preview';
  }
}

function fileLanguage(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx')) return 'markdown';
  if (normalized.endsWith('.tsx') || normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.jsx') || normalized.endsWith('.js')) return 'javascript';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.py')) return 'python';
  if (normalized.endsWith('.sh')) return 'bash';
  if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) return 'yaml';
  if (normalized.endsWith('.css') || normalized.endsWith('.scss')) return 'css';
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'html';
  if (normalized.endsWith('.rs')) return 'rust';
  if (normalized.endsWith('.sql')) return 'sql';
  return 'text';
}

async function revealInFinder(path: string): Promise<void> {
  await invoke('reveal_in_finder', { path });
}

export function useSessionWorkspacePreview(workDir: string | null, enabled: boolean) {
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  const refreshEntries = useCallback(async () => {
    if (!enabled || !workDir) {
      setEntries([]);
      setSelectedFilePath(null);
      setSelectedContent('');
      setFileError(null);
      setFileLoading(false);
      setIsTruncated(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const result = await collectWorkspaceEntries(workDir);
      setEntries(result.entries);
      setIsTruncated(result.truncated);
      setSelectedFilePath((currentPath) => {
        if (currentPath && result.entries.some((entry) => entry.path === currentPath && entry.isPreviewable)) {
          return currentPath;
        }

        return pickPreferredWorkspacePreview(
          result.entries.map((entry) => ({
            path: entry.path,
            isDirectory: entry.is_directory,
            section: entry.section,
          })),
        );
      });
    } catch {
      setEntries([]);
      setSelectedFilePath(null);
      setIsTruncated(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [enabled, workDir]);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setSelectedFilePath(null);
      setSelectedContent('');
      setFileError(null);
      setFileLoading(false);
      setIsTruncated(false);
      return;
    }

    void refreshEntries();
    const intervalId = window.setInterval(() => {
      void refreshEntries();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refreshEntries]);

  useEffect(() => {
    if (!enabled || !selectedFilePath) {
      setSelectedContent('');
      setFileError(null);
      return;
    }

    if (!isPreviewableWorkspaceFile(selectedFilePath)) {
      setSelectedContent('');
      setFileError('This file is not previewable yet.');
      return;
    }

    setFileLoading(true);
    setFileError(null);
    workflowService
      .readFile(selectedFilePath)
      .then((response) => {
        setSelectedContent(response.content);
      })
      .catch((error) => {
        setSelectedContent('');
        setFileError(String(error));
      })
      .finally(() => {
        setFileLoading(false);
      });
  }, [enabled, selectedFilePath]);

  return {
    entries,
    selectedFilePath,
    setSelectedFilePath,
    selectedContent,
    fileLoading,
    fileError,
    isRefreshing,
    isTruncated,
    refreshEntries,
    revealInFinder,
  };
}

function EmptyState({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 py-12">
      <div className={workspacePreviewChrome.emptyCard}>
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[#8a867f]">{eyebrow}</p>
        <h3 className="mt-4 text-3xl font-semibold tracking-tight text-[#2f251a]">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#6f6e69]">{description}</p>
      </div>
    </div>
  );
}

export function SessionWorkspacePreviewPane({
  workDir,
  selectedFilePath,
  selectedContent,
  fileLoading,
  fileError,
  onRevealPath,
}: {
  workDir: string | null;
  selectedFilePath: string | null;
  selectedContent: string;
  fileLoading: boolean;
  fileError: string | null;
  onRevealPath: (path: string) => Promise<void>;
}) {
  const previewKind = useMemo(() => getWorkspacePreviewKind(selectedFilePath ?? ''), [selectedFilePath]);
  const filename = selectedFilePath?.split('/').pop() ?? null;
  const canRenderPreview = previewKind === 'markdown' || previewKind === 'html';
  const [viewMode, setViewMode] = useState<'preview' | 'code'>(canRenderPreview ? 'preview' : 'code');

  useEffect(() => {
    setViewMode(canRenderPreview ? 'preview' : 'code');
  }, [canRenderPreview, selectedFilePath]);

  const renderSourceView = () => {
    if (!selectedFilePath) {
      return null;
    }

    if (previewKind === 'text') {
      return (
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-8 py-8 font-mono text-[13px] leading-6 text-[#4a3c2d]">
          {selectedContent}
        </pre>
      );
    }

    return (
      <div className="flex-1 overflow-auto bg-[#0f1720]">
        <SyntaxHighlighter
          language={fileLanguage(selectedFilePath)}
          style={oneDark}
          customStyle={{
            margin: 0,
            minHeight: '100%',
            background: '#0f1720',
            padding: '24px',
            fontSize: '12px',
          }}
        >
          {selectedContent}
        </SyntaxHighlighter>
      </div>
    );
  };

  if (!workDir) {
    return (
      <EmptyState
        eyebrow="Workspace Preview"
        title="No workspace yet"
        description="Start a chat session that produces files, then switch back here to preview Markdown or HTML output in the center stage."
      />
    );
  }

  if (!selectedFilePath) {
    return (
      <EmptyState
        eyebrow="Workspace Preview"
        title="Pick a document"
        description="Use the file manager on the right to open a generated Markdown or HTML file. The preview surface is optimized for docs, notes, and deliverables."
      />
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col ${workspacePreviewChrome.shellBg}`}>
      <div className={`${workspacePreviewChrome.toolbar} px-5 py-3`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#efede8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a756d]">
                {previewModeLabel(selectedFilePath)}
              </span>
              {filename && (
                <span className={workspacePreviewChrome.subtlePill}>
                  {filename}
                </span>
              )}
            </div>
            <p className="mt-3 truncate text-sm font-medium text-[#2f251a]">{selectedFilePath}</p>
          </div>

          <div className="flex items-center gap-2">
            <div className={workspacePreviewChrome.segmented}>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                disabled={!canRenderPreview}
                className={`${workspacePreviewChrome.segmentedButtonSmall} ${
                  viewMode === 'preview'
                    ? workspacePreviewChrome.segmentedButtonActive
                    : workspacePreviewChrome.segmentedButtonInactiveDisabled
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode('code')}
                className={`${workspacePreviewChrome.segmentedButtonSmall} ${
                  viewMode === 'code'
                    ? workspacePreviewChrome.segmentedButtonActive
                    : workspacePreviewChrome.segmentedButtonInactive
                }`}
              >
                Code
              </button>
            </div>

            <button
              type="button"
              onClick={() => void onRevealPath(selectedFilePath)}
              className={workspacePreviewChrome.actionButton}
            >
              Reveal
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className={workspacePreviewChrome.canvasCard}>
          {fileLoading ? (
            <div className="flex flex-1 items-center justify-center px-8 py-12 text-sm text-[#7a756d]">
              Loading preview...
            </div>
          ) : fileError ? (
            <div className="flex flex-1 items-center justify-center px-8 py-12">
              <div className="max-w-lg rounded-2xl border border-red-100 bg-red-50 px-6 py-5 text-sm text-red-600">
                {fileError}
              </div>
            </div>
          ) : viewMode === 'preview' && previewKind === 'markdown' ? (
            <div className="flex-1 overflow-auto px-8 py-10">
              <article className="prose prose-stone max-w-none prose-headings:font-semibold prose-pre:rounded-2xl prose-pre:border prose-pre:border-[#2c303a] prose-code:before:hidden prose-code:after:hidden">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedContent}</ReactMarkdown>
              </article>
            </div>
          ) : viewMode === 'preview' && previewKind === 'html' ? (
            <iframe
              title={filename ?? 'HTML preview'}
              sandbox=""
              srcDoc={selectedContent}
              className="h-full min-h-[720px] w-full bg-white"
            />
          ) : (
            renderSourceView()
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceFileGroup({
  title,
  badge,
  entries,
  selectedFilePath,
  onSelectFile,
  onRevealPath,
}: {
  title: string;
  badge: string;
  entries: WorkspaceFileEntry[];
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onRevealPath: (path: string) => Promise<void>;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between px-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a756d]">{title}</h3>
        <span className="rounded-full bg-[#efede8] px-2 py-0.5 text-[10px] font-semibold text-[#7a756d]">{badge}</span>
      </div>

      <div className="space-y-1">
        {entries.map((entry) => {
          const isSelected = selectedFilePath === entry.path;
          const handleClick = () => {
            if (entry.is_directory || !entry.isPreviewable) {
              void onRevealPath(entry.path);
              return;
            }

            onSelectFile(entry.path);
          };

          return (
            <button
              key={entry.path}
              type="button"
              onClick={handleClick}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-[background-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isSelected
                  ? 'bg-white text-[#2f251a] shadow-[0_10px_26px_rgba(15,23,42,0.06)] ring-1 ring-[#e7e2da]'
                  : 'text-[#5f5a52] hover:-translate-y-px hover:bg-white/88 hover:text-[#37352f] hover:shadow-[0_8px_18px_rgba(15,23,42,0.035)]'
              }`}
              style={{ paddingLeft: `${1 + entry.depth * 0.9}rem` }}
            >
              {entry.is_directory ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f1f3f5] text-[#6a7686]">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v6H4a2 2 0 01-2-2V6z" />
                  </svg>
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-[inset_0_0_0_1px_rgba(231,229,225,0.95)]">
                  <FileIcon filename={entry.name} />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${isSelected ? 'font-semibold' : 'font-medium'}`}>{entry.displayName}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#938d83]">{entry.path}</p>
              </div>

              {entry.is_directory ? (
                <span className="rounded-full bg-[#eef1f4] px-2 py-0.5 text-[10px] font-medium text-[#6c7786]">folder</span>
              ) : entry.isPreviewable ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isSelected ? 'bg-[#ece6dd] text-[#5c4f40]' : 'bg-[#f2efea] text-[#7b756d]'
                }`}>
                  preview
                </span>
              ) : (
                <span className="rounded-full bg-[#f0efec] px-2 py-0.5 text-[10px] font-medium text-[#8f8a81]">
                  reveal
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function SessionWorkspaceFileManagerPane({
  workDir,
  entries,
  selectedFilePath,
  onSelectFile,
  onRevealPath,
  onRefresh,
  isRefreshing,
  isTruncated,
}: {
  workDir: string | null;
  entries: WorkspaceFileEntry[];
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onRevealPath: (path: string) => Promise<void>;
  onRefresh: () => void;
  isRefreshing: boolean;
  isTruncated: boolean;
}) {
  const generatedEntries = useMemo(
    () => entries.filter((entry) => entry.section === 'generated'),
    [entries],
  );
  const workspaceEntries = useMemo(
    () => entries.filter((entry) => entry.section === 'workspace'),
    [entries],
  );

  return (
    <div className={`flex h-full min-h-0 flex-col ${workspacePreviewChrome.shellBg}`}>
      <div className={`${workspacePreviewChrome.toolbar} px-4 py-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8a867f]">File Manager</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-[#2f251a]">Session workspace</h2>
            <p className="mt-1 text-xs leading-5 text-[#6f6e69]">
              Preview-friendly files stay clickable. Other files and folders still open in Finder for quick inspection.
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className={workspacePreviewChrome.actionButton}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {workDir && (
          <button
            type="button"
            onClick={() => void onRevealPath(workDir)}
            className="mt-4 w-full truncate rounded-[18px] border border-[#e7e5e1] bg-white/92 px-3 py-2.5 text-left text-[11px] font-medium text-[#686158] shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition-[background-color,border-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:border-[#ded9d1] hover:bg-white hover:text-[#37352f] hover:shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
            title={workDir}
          >
            {workDir}
          </button>
        )}

        {isTruncated && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">
            File listing is trimmed to the first {MAX_SCAN_ENTRIES} entries for responsiveness.
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 space-y-6 overflow-y-auto px-3 py-4">
        {!workDir ? (
          <div className="rounded-[24px] border border-dashed border-[#ddd9d1] bg-white/72 px-5 py-6 text-sm leading-6 text-[#7a756d]">
            The file manager appears once the current chat session has a working directory.
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#ddd9d1] bg-white/72 px-5 py-6 text-sm leading-6 text-[#7a756d]">
            No files detected yet. Run a task that writes docs or artifacts, then refresh this panel.
          </div>
        ) : (
          <>
            <WorkspaceFileGroup
              title="Generated Docs"
              badge="preferred"
              entries={generatedEntries}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
              onRevealPath={onRevealPath}
            />
            <WorkspaceFileGroup
              title="Workspace Files"
              badge="session"
              entries={workspaceEntries}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
              onRevealPath={onRevealPath}
            />
          </>
        )}
      </div>
    </div>
  );
}