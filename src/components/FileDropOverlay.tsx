/**
 * FileDropOverlay - Global file drag-and-drop overlay
 *
 * Shows a full-screen frosted glass overlay whenever the user drags files
 * into the app window. The rest of the UI blurs out behind it.
 *
 * Features:
 * - Listens to global window drag events
 * - Frosted glass backdrop (backdrop-blur + semi-transparent)
 * - Shows pending files list before confirming import
 * - File list with remove individual files capability
 * - Confirm/Cancel buttons to finalize import
 * - Counter-based dragenter/dragleave to handle nested DOM elements correctly
 */

import { useCallback, useEffect, useState, useRef, type ChangeEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore, useUIStore, useChatStore } from '@/store';

interface PendingFile {
  name: string;
  path: string;
  id: string;
}

/**
 * Generate a unique ID for pending files
 */
function generateFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get file icon based on extension
 */
function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    // Images
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    // Documents
    pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📝',
    // Spreadsheets
    xls: '📊', xlsx: '📊', csv: '📊',
    // Code
    ts: '💻', tsx: '💻', js: '💻', jsx: '💻', py: '🐍', go: '🔵', rs: '🦀',
    java: '☕', c: '⚙️', cpp: '⚙️', h: '⚙️', css: '🎨', html: '🌐',
    json: '📋', xml: '📋', yaml: '📋', yml: '📋',
    // Archives
    zip: '📦', tar: '📦', gz: '📦', rar: '📦',
    // Other
    default: '📄',
  };
  return iconMap[ext || ''] || iconMap.default;
}

export function FileDropOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // dragCounter tracks nested dragenter/dragleave so we don't flicker on child elements
  const dragCounterRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const { addImportedFiles } = useSettingsStore();
  const { addNotification } = useUIStore();
  const { currentSessionId, addSessionWorkingFiles } = useChatStore();

  /** Add files to pending list (don't import yet) */
  const addToPending = useCallback((files: FileList) => {
    if (files.length === 0) return;
    const newFiles: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Tauri injects a `.path` property on the File object for native drops
      const path = (file as unknown as { path?: string }).path || file.name;
      newFiles.push({
        name: file.name,
        path,
        id: generateFileId(),
      });
    }
    setPendingFiles((prev) => {
      // Avoid duplicates by checking path
      const existingPaths = new Set(prev.map((f) => f.path));
      const uniqueNewFiles = newFiles.filter((f) => !existingPaths.has(f.path));
      return [...prev, ...uniqueNewFiles];
    });
  }, []);

  /** Remove a file from pending list */
  const removePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  /** Clear all pending files */
  const clearPendingFiles = useCallback(() => {
    setPendingFiles([]);
  }, []);

  /** Confirm import - add all pending files to current session (or global if no session) */
  const confirmImport = useCallback(() => {
    if (pendingFiles.length === 0) return;

    const fileData = pendingFiles.map(({ name, path, id }) => ({ id, name, path, addedAt: Date.now() }));

    // Add to current session's working files if session exists
    if (currentSessionId) {
      addSessionWorkingFiles(currentSessionId, fileData);
      addNotification('success', `${fileData.length} 个文件已添加到当前 session`);
    } else {
      // Fallback to global imported files
      addImportedFiles(pendingFiles.map(({ name, path }) => ({ name, path })));
      addNotification('success', `${fileData.length} 个文件已导入`);
    }

    setPendingFiles([]);
    setIsDragging(false);
    dragCounterRef.current = 0;
  }, [pendingFiles, currentSessionId, addImportedFiles, addSessionWorkingFiles, addNotification]);

  /** Cancel and close overlay */
  const cancelOverlay = useCallback(() => {
    setPendingFiles([]);
    setIsDragging(false);
    dragCounterRef.current = 0;
  }, []);

  // --- Global window event handlers ---

  const handleDragEnter = useCallback((e: DragEvent) => {
    // Only activate for file drags (not text selection etc.)
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    // Only set dragging if we have files and counter just went from 0 to 1
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    // Skip non-file drags to avoid interfering with click events in WKWebView
    if (!e.dataTransfer?.types.includes('Files') && dragCounterRef.current === 0) return;
    e.preventDefault();
    // Only decrement if we're leaving the outer container
    const relatedTarget = e.relatedTarget as Node | null;
    if (!overlayRef.current?.contains(relatedTarget)) {
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        setIsDragging(false);
        dragCounterRef.current = 0;
      }
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    // Only handle file drags; non-file dragover events should pass through
    // to avoid trapping WKWebView click events misidentified as drags
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    // Required to allow the drop event to fire
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        // Don't close overlay, just add files to pending list
        addToPending(files);
      }
    },
    [addToPending]
  );

  // Handle drop on the drop zone specifically
  const handleDropZoneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        addToPending(files);
      }
    },
    [addToPending]
  );

  const handleDropZoneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Esc key dismisses the overlay
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelOverlay();
    }
  }, [cancelOverlay]);

  useEffect(() => {
    // Use capture phase to ensure we get events before other handlers
    window.addEventListener('dragenter', handleDragEnter, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('drop', handleDrop, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter, true);
      window.removeEventListener('dragleave', handleDragLeave, true);
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop, handleKeyDown]);

  // Tauri native file drop events (handles OS-level drag from Finder/Explorer)
  // Tauri intercepts these before DOM events when fileDropEnabled=true (the default)
  useEffect(() => {
    const unlistens: Array<() => void> = [];

    // User hovers over window with files → show overlay
    listen<string[]>('tauri://file-drop-hover', () => {
      dragCounterRef.current = 1;
      setIsDragging(true);
    }).then((u) => unlistens.push(u));

    // User drops files → add paths to pending list (don't auto-close, let user confirm)
    listen<string[]>('tauri://file-drop', (event) => {
      const paths = event.payload ?? [];
      if (paths.length === 0) return;
      const newFiles: PendingFile[] = paths.map((p) => ({
        name: p.split('/').pop()?.split('\\').pop() || p,
        path: p,
        id: generateFileId(),
      }));
      setPendingFiles((prev) => {
        const existingPaths = new Set(prev.map((f) => f.path));
        return [...prev, ...newFiles.filter((f) => !existingPaths.has(f.path))];
      });
      // Ensure overlay stays visible so user can confirm
      setIsDragging(true);
    }).then((u) => unlistens.push(u));

    // User cancelled drag (moved out of window)
    listen('tauri://file-drop-cancelled', () => {
      // Only close overlay if no files were dropped yet
      setPendingFiles((prev) => {
        if (prev.length === 0) {
          setIsDragging(false);
          dragCounterRef.current = 0;
        }
        return prev;
      });
    }).then((u) => unlistens.push(u));

    return () => {
      unlistens.forEach((u) => u());
    };
  }, []);

  /** Click handler: triggers hidden file input */
  const handleClickImport = () => {
    fileInputRef.current?.click();
  };

  /** Handle file selection from native file input */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Add to pending list instead of direct import
    addToPending(files);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Only render when dragging - completely unmount when hidden to avoid blocking events
  if (!isDragging) {
    return null;
  }

  const hasPendingFiles = pendingFiles.length > 0;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        // Close when clicking outside drop zone
        if (e.target === overlayRef.current) {
          cancelOverlay();
        }
      }}
    >
      {/* Hidden file input for native file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Drop zone card */}
      <div
        ref={dropZoneRef}
        onDrop={handleDropZoneDrop}
        onDragOver={handleDropZoneDragOver}
        onDragEnter={(e) => e.stopPropagation()}
        className={`relative z-10 flex flex-col w-[420px] max-h-[80vh] bg-white/95 backdrop-blur-sm
                   rounded-2xl shadow-2xl border-2 transition-all overflow-hidden
                   ${hasPendingFiles ? 'border-blue-300' : 'border-dashed border-blue-400'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              hasPendingFiles ? 'bg-green-50' : 'bg-blue-50'
            }`}>
              {hasPendingFiles ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-blue-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {hasPendingFiles ? '已选择文件' : '拖放文件'}
              </h2>
              {hasPendingFiles && (
                <p className="text-xs text-gray-500">{pendingFiles.length} 个文件</p>
              )}
            </div>
          </div>
          <button
            onClick={cancelOverlay}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* File list area */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {hasPendingFiles ? (
            /* Show pending files list */
            <div className="space-y-2">
              {pendingFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl group hover:bg-gray-100 transition-colors"
                >
                  <span className="text-xl">{getFileIcon(file.name)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-400 truncate">{file.path}</p>
                  </div>
                  <button
                    onClick={() => removePendingFile(file.id)}
                    className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                    title="移除文件"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* Show drop hint */
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8 text-blue-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="text-base font-semibold text-gray-700 mb-1">拖放文件到此处</p>
              <p className="text-xs text-gray-400">松手后文件将添加到列表</p>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        <div className="px-4 py-4 border-t border-gray-100 bg-gray-50/50">
          {hasPendingFiles ? (
            /* Show confirm/cancel buttons */
            <div className="space-y-3">
              <button
                onClick={confirmImport}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold
                         rounded-xl transition-colors shadow-sm active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                确认导入 {pendingFiles.length} 个文件
              </button>
              <div className="flex gap-2">
                <button
                  onClick={clearPendingFiles}
                  className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 text-gray-600 text-sm font-medium
                           rounded-xl transition-colors border border-gray-200"
                >
                  清空列表
                </button>
                <button
                  onClick={cancelOverlay}
                  className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 text-gray-600 text-sm font-medium
                           rounded-xl transition-colors border border-gray-200"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            /* Show select file button */
            <div className="space-y-3">
              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">或</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              <button
                onClick={handleClickImport}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold
                         rounded-xl transition-colors shadow-sm active:scale-[0.98]"
              >
                选择文件
              </button>

              <p className="text-center text-[11px] text-gray-400">按 Esc 取消</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileDropOverlay;
