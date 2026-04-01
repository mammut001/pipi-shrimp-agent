import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface ProjectFilesViewProps {
  workDir: string | null;
  onFileSelect?: (path: string) => void;
}

export const ProjectFilesView: React.FC<ProjectFilesViewProps> = ({ workDir, onFileSelect }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  const loadFiles = async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<FileEntry[]>('list_files', { path: dirPath });
      // Sort: Directories first, then alphabetical
      const sorted = result.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(sorted);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (workDir) {
      loadFiles(workDir);
    } else {
      setFiles([]);
    }
  }, [workDir]);

  if (!workDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-xs gap-4 p-8 text-center bg-gray-50/30">
        <div className="p-4 bg-white rounded-full shadow-sm border border-gray-100">
          <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </div>
        <div className="max-w-[200px] flex flex-col gap-1">
          <span className="font-bold text-gray-500 uppercase tracking-widest text-[10px]">No Project Bound</span>
          <span className="leading-relaxed opacity-70 text-[10px]">Bind a folder to see your files here.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/60 bg-gray-50/50">
        <div className="flex items-center gap-2 overflow-hidden">
          <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="text-[10px] font-bold text-gray-600 truncate uppercase tracking-tight">{workDir.split('/').pop()}</span>
        </div>
        <button 
          onClick={() => loadFiles(workDir)}
          disabled={loading}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
        >
          <svg className={`w-3 h-3 text-gray-400 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Explorer List */}
      <div className="flex-1 overflow-auto p-2 scrollbar-thin">
        {loading && files.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-300 text-[10px] animate-pulse">
            Loading explorer...
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-[10px] rounded-lg border border-red-100 italic">
            Error: {error}
          </div>
        )}
        {!loading && files.length === 0 && !error && (
          <div className="flex items-center justify-center h-32 text-gray-300 text-[10px]">
            The project directory is empty or inaccessible.
          </div>
        )}
        
        {files.map((file) => (
          <div 
            key={file.path}
            onClick={() => {
              if (onFileSelect) onFileSelect(file.path);
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer group whitespace-nowrap"
          >
            {/* Icon */}
            {file.is_dir ? (
              <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            )}
            
            <span className="flex-1 text-[11px] text-gray-700 font-medium truncate">{file.name}</span>
            
            {!file.is_dir && file.size > 0 && (
              <span className="text-[9px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
        ))}
      </div>
      
      {/* Footer Info */}
      <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/30">
        <div className="flex items-center justify-between text-[9px] text-gray-400">
          <span>{files.length} items found</span>
          <span className="italic uppercase tracking-widest opacity-60">Project Browser</span>
        </div>
      </div>
    </div>
  );
};
