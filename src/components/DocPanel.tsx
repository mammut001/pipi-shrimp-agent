/**
 * DocPanel - Document list panel for AgentPanel
 *
 * Shows all documents in .pipi-shrimp/docs/ with collapsible section.
 * Features hover menu for opening documents in various editors.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DOCS_CHANGED_EVENT, type DocsChangedEventDetail } from '@/services/browserBenchmarkArtifacts';
import {
  listDocs,
  readDoc,
  openFileExternal,
  openFileWithApp,
  type DocMeta,
  type DocContent,
} from '@/services/docService';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Section } from './ui/Section';
import { DocListSkeleton } from './ui/Skeleton';

interface DocPanelProps {
  workDir: string;
}

interface MenuState {
  doc: DocMeta;
  position: { x: number; y: number };
}

const docPreviewProseClassName = [
  'prose prose-stone prose-sm md:prose-base max-w-none',
  'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-[#2f251a]',
  'prose-p:text-[#4f463d] prose-li:text-[#4f463d] prose-strong:text-[#2f251a]',
  'prose-a:text-[#0f766e] prose-a:no-underline hover:prose-a:text-[#115e59]',
  'prose-blockquote:border-l-[#d6d3d1] prose-blockquote:text-[#57534e]',
  'prose-hr:border-[#ece6dc]',
  'prose-table:text-[0.92em] prose-th:border-b prose-th:border-[#e7e1d7] prose-th:text-[#57534e]',
  'prose-td:border-b prose-td:border-[#f1ede6]',
  'prose-code:rounded prose-code:bg-[#f5f5f4] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[#7c2d12]',
  'prose-code:before:hidden prose-code:after:hidden',
  'prose-pre:rounded-2xl prose-pre:border prose-pre:border-[#2c303a] prose-pre:bg-[#111827] prose-pre:shadow-none',
].join(' ');

export function DocMarkdownPreview({ body }: { body: string }) {
  return (
    <article className={docPreviewProseClassName}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </article>
  );
}

export function DocPanel({ workDir }: DocPanelProps) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocContent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadDocs = useCallback(async () => {
    if (!workDir) return;
    setLoading(true);
    try {
      const docList = await listDocs(workDir);
      setDocs(docList);
    } catch (error) {
      console.error('Failed to load docs:', error);
    } finally {
      setLoading(false);
    }
  }, [workDir]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (!workDir || typeof window === 'undefined') {
      return;
    }

    const handleDocsChanged = (event: Event) => {
      const detail = (event as CustomEvent<DocsChangedEventDetail>).detail;
      if (!detail || detail.workDir === workDir) {
        void loadDocs();
      }
    };

    window.addEventListener(DOCS_CHANGED_EVENT, handleDocsChanged);
    return () => window.removeEventListener(DOCS_CHANGED_EVENT, handleDocsChanged);
  }, [loadDocs, workDir]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuState(null);
      }
    };

    if (menuState) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuState]);

  useEffect(() => {
    if (!selectedDoc || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedDoc(null);
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedDoc]);

  const filteredDocs = docs.filter(doc => 
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleDocClick = async (doc: DocMeta) => {
    try {
      const content = await readDoc(workDir, doc.number);
      setSelectedDoc(content);
    } catch (error) {
      console.error('Failed to read doc:', error);
    }
  };

  const handleMenuClick = (event: React.MouseEvent, doc: DocMeta) => {
    event.stopPropagation();
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setMenuState({
      doc,
      position: { x: rect.right - 120, y: rect.bottom + 4 }
    });
  };

  const handleOpenDefault = async () => {
    if (!menuState) return;
    try {
      await openFileExternal(menuState.doc.path);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
    setMenuState(null);
  };

  const handleOpenVSCode = async () => {
    if (!menuState) return;
    try {
      await openFileWithApp(menuState.doc.path, 'Visual Studio Code');
    } catch (error) {
      console.error('Failed to open with VS Code:', error);
    }
    setMenuState(null);
  };

  const handleRevealInFinder = async () => {
    if (!menuState) return;
    try {
      await invoke('reveal_in_finder', { path: menuState.doc.path });
    } catch (error) {
      console.error('Failed to reveal in finder:', error);
    }
    setMenuState(null);
  };

  const handleOpenSelectedDocDefault = async () => {
    if (!selectedDoc) return;
    try {
      await openFileExternal(selectedDoc.meta.path);
    } catch (error) {
      console.error('Failed to open selected doc:', error);
    }
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <Section
      title="Docs"
      count={docs.length > 0 ? docs.length.toString() : undefined}
      defaultExpanded={false}
    >
      <div className="pt-2 space-y-3">
        {/* Search */}
        {docs.length > 0 && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="w-full text-[11px] pl-7 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-200 transition-colors"
            />
            <svg 
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        )}

        {/* Doc list */}
        {loading ? (
          <DocListSkeleton count={3} />
        ) : filteredDocs.length > 0 ? (
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {filteredDocs.map((doc) => (
              <div
                key={doc.number}
                className="group relative"
              >
                <button
                  onClick={() => handleDocClick(doc)}
                  className="w-full text-left p-2.5 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded mt-0.5">
                      {doc.number}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-800 truncate">
                        {doc.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-gray-400">
                          {formatDate(doc.created)}
                        </span>
                        {doc.tags.length > 0 && (
                          <div className="flex gap-1">
                            {doc.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="text-[8px] text-gray-400 bg-gray-100 px-1 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Hover menu button */}
                <button
                  onClick={(e) => handleMenuClick(e, doc)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-[10px] text-gray-400 font-medium text-center">
              No documents yet
            </p>
            <p className="text-[9px] text-gray-400 mt-1 text-center px-2">
              AI will auto-create docs when you ask
            </p>
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-[10px] text-gray-400">No results for "{searchQuery}"</p>
          </div>
        )}

        {/* Dropdown menu */}
        {menuState && (
          <div
            ref={menuRef}
            className="fixed z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-150"
            style={{ 
              left: `${Math.min(menuState.position.x, window.innerWidth - 180)}px`,
              top: `${menuState.position.y}px`
            }}
          >
            <button
              onClick={handleOpenDefault}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Default Editor
            </button>
            <button
              onClick={handleOpenVSCode}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 1 8.118V21a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V3.461a1 1 0 0 0-.85-.873zM5.115 7.05L6.927 9H2.12l1.995-1.95zm14.95 14.95h-13l3.49-3.49 4.755 4.505V21.08a.993.993 0 0 0 .238.921.986.986 0 0 0 .617.229l3.9-1.61z"/>
              </svg>
              VS Code
            </button>
            <button
              onClick={handleRevealInFinder}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Show in Finder
            </button>
          </div>
        )}

      </div>
      {selectedDoc && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[1000] overflow-y-auto bg-[#1c1917]/58 backdrop-blur-[6px]"
          onClick={() => setSelectedDoc(null)}
        >
          <div className="min-h-full sm:p-4">
            <div
              className="flex min-h-screen w-full flex-col bg-[#f6f1e8] shadow-[0_32px_120px_rgba(15,23,42,0.3)] sm:min-h-[calc(100vh-2rem)] sm:rounded-[28px] sm:border sm:border-white/70"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 border-b border-[#e7ded1] bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(246,241,232,0.98))] px-4 py-4 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <button
                      onClick={() => setSelectedDoc(null)}
                      className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)] transition-colors hover:text-[#2f251a]"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back to Docs
                    </button>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#dceeea] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0f766e]">
                        Doc {selectedDoc.meta.number}
                      </span>
                      <span className="text-[11px] text-[#8a7f72]" title={selectedDoc.meta.path}>
                        {selectedDoc.meta.filename}
                      </span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold tracking-tight text-[#2f251a] sm:text-3xl">
                      {selectedDoc.meta.title}
                    </h3>
                    {selectedDoc.meta.summary && (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#655a4f]">
                        {selectedDoc.meta.summary}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-start">
                    <button
                      onClick={() => void handleOpenSelectedDocDefault()}
                      className="rounded-xl border border-[#e7ded1] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
                      title="Open in default editor"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => setSelectedDoc(null)}
                      className="rounded-xl border border-[#e7ded1] bg-white/90 p-2 text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
                      title="Close document preview"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="border-b border-[#e7ded1] bg-[#f1eadf]/85 px-4 py-5 lg:border-b-0 lg:border-r sm:px-6">
                  <div className="space-y-5 text-sm text-[#5c5247]">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Timeline</p>
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl bg-white/80 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#998c7e]">Created</p>
                          <p className="mt-1 text-sm font-medium text-[#2f251a]">{formatDate(selectedDoc.meta.created)}</p>
                        </div>
                        {selectedDoc.meta.updated && (
                          <div className="rounded-2xl bg-white/80 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#998c7e]">Updated</p>
                            <p className="mt-1 text-sm font-medium text-[#2f251a]">{formatDate(selectedDoc.meta.updated)}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Path</p>
                      <p className="mt-3 break-all rounded-2xl bg-white/80 px-3 py-3 text-[12px] leading-5 text-[#5c5247] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
                        {selectedDoc.meta.path}
                      </p>
                    </div>

                    {selectedDoc.meta.tags.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Tags</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedDoc.meta.tags.map(tag => (
                            <span
                              key={tag}
                              className="rounded-full bg-[#e7ddd0] px-2.5 py-1 text-[11px] font-medium text-[#67584a]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </aside>

                <div className="px-4 py-5 sm:px-6 sm:py-6">
                  <div className="min-h-full rounded-[26px] border border-[#ebe4d9] bg-white px-5 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] sm:px-8 sm:py-8">
                    <DocMarkdownPreview body={selectedDoc.body} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Section>
  );
}
