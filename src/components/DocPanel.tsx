/**
 * DocPanel - Document list panel for AgentPanel
 *
 * Shows all documents in .pipi-shrimp/docs/ with collapsible section.
 * Features hover menu for opening documents in various editors.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listDocs, readDoc, openFileExternal, openFileWithApp, DocMeta, DocContent } from '@/services/docService';
import { invoke } from '@tauri-apps/api/core';
import { Section } from './ui/Section';
import { DocListSkeleton } from './ui/Skeleton';

interface DocPanelProps {
  workDir: string;
}

interface MenuState {
  doc: DocMeta;
  position: { x: number; y: number };
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

        {/* Doc preview modal */}
        {selectedDoc && (
          <div 
            className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setSelectedDoc(null)}
          >
            <div 
              className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div>
                  <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded mr-2">
                    {selectedDoc.meta.number}
                  </span>
                  <h3 className="text-sm font-bold text-gray-800 inline">
                    {selectedDoc.meta.title}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openFileExternal(selectedDoc.meta.path)}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Open in default editor"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setSelectedDoc(null)}
                    className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-xs text-gray-500 mb-3 flex items-center gap-3">
                  <span>Created: {formatDate(selectedDoc.meta.created)}</span>
                  {selectedDoc.meta.updated && (
                    <span>Updated: {formatDate(selectedDoc.meta.updated)}</span>
                  )}
                </div>
                {selectedDoc.meta.tags.length > 0 && (
                  <div className="flex gap-1 mb-3">
                    {selectedDoc.meta.tags.map(tag => (
                      <span key={tag} className="text-[9px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                  {selectedDoc.body}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
