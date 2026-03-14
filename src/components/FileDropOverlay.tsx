/**
 * FileDropOverlay - Global file drag-and-drop overlay
 *
 * Shows a full-screen frosted glass overlay whenever the user drags files
 * into the app window. The rest of the UI blurs out behind it.
 *
 * Features:
 * - Listens to global window drag events
 * - Frosted glass backdrop (backdrop-blur + semi-transparent)
 * - Drop to import files into settingsStore.importedFiles
 * - Click "Select files" button uses native file input
 * - Counter-based dragenter/dragleave to handle nested DOM elements correctly
 */

import { useCallback, useEffect, useState, useRef, type ChangeEvent } from 'react';
import { useSettingsStore, useUIStore } from '@/store';

export function FileDropOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  // dragCounter tracks nested dragenter/dragleave so we don't flicker on child elements
  const dragCounterRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { addImportedFiles } = useSettingsStore();
  const { addNotification } = useUIStore();

  /** Convert a list of File objects into our {name, path} format */
  const processFiles = useCallback(
    (files: FileList) => {
      if (files.length === 0) return;
      const fileData: { name: string; path: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Tauri injects a `.path` property on the File object for native drops
        const path = (file as unknown as { path?: string }).path || file.name;
        fileData.push({ name: file.name, path });
      }
      addImportedFiles(fileData);
      addNotification('success', `${fileData.length} 个文件已导入`);
    },
    [addImportedFiles, addNotification]
  );

  // --- Global window event handlers ---

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only activate for file drags (not text selection etc.)
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounterRef.current++;
      // Only set dragging if we have files and counter just went from 0 to 1
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only decrement if we're leaving the outer container
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !overlayRef.current?.contains(relatedTarget)) {
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        setIsDragging(false);
        dragCounterRef.current = 0;
      }
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Required to allow the drop event to fire
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  // Esc key dismisses the overlay
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  }, []);

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

  /** Click handler: triggers hidden file input */
  const handleClickImport = () => {
    fileInputRef.current?.click();
  };

  /** Handle file selection from native file input */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileData: { name: string; path: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = (file as unknown as { path?: string }).path || file.name;
      fileData.push({ name: file.name, path });
    }

    addImportedFiles(fileData);
    addNotification('success', `${fileData.length} 个文件已导入`);
    setIsDragging(false);
    dragCounterRef.current = 0;

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Only render when dragging - completely unmount when hidden to avoid blocking events
  if (!isDragging) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center"
    >
      {/* Hidden file input for native file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Frosted glass backdrop — blurs everything behind */}
      <div className="absolute inset-0 bg-white/40 backdrop-blur-md" />

      {/* Drop zone card */}
      <div
        className="relative z-10 flex flex-col items-center gap-5 w-72 bg-white/80 backdrop-blur-sm
                   rounded-2xl shadow-2xl border-2 border-dashed border-blue-400 px-8 py-10
                   transition-all"
      >
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
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

        {/* Text */}
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">拖放文件</p>
          <p className="text-sm text-gray-500 mt-1">松手即可导入到上下文</p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400 font-medium">或</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Click to select */}
        <button
          onClick={handleClickImport}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                     rounded-xl transition-colors shadow-sm active:scale-[0.98]"
        >
          选择文件
        </button>

        {/* Dismiss hint */}
        <p className="text-[10px] text-gray-400">按 Esc 取消</p>
      </div>
    </div>
  );
}

export default FileDropOverlay;
