/**
 * FileIcon - Consistent file type icon component
 *
 * Shows a colored badge with file extension for easy visual identification.
 */



interface FileIconProps {
  filename: string;
  className?: string;
}

export function FileIcon({ filename, className = '' }: FileIconProps) {
  const ext = filename.split('.').pop()?.toLowerCase();

  // TypeScript / TSX
  if (ext === 'ts' || ext === 'tsx') return (
    <div className={`p-1 px-1.5 bg-blue-50 rounded text-blue-600 font-bold text-[8px] uppercase ring-1 ring-blue-100 flex-shrink-0 ${className}`}>TS</div>
  );
  // Rust
  if (ext === 'rs') return (
    <div className={`p-1 px-1.5 bg-orange-50 rounded text-orange-600 font-bold text-[8px] uppercase ring-1 ring-orange-100 flex-shrink-0 ${className}`}>RS</div>
  );
  // Markdown
  if (ext === 'md' || ext === 'mdx') return (
    <div className={`p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0 ${className}`}>MD</div>
  );
  // JSON
  if (ext === 'json') return (
    <div className={`p-1 px-1.5 bg-yellow-50 rounded text-yellow-600 font-bold text-[8px] uppercase ring-1 ring-yellow-100 flex-shrink-0 ${className}`}>{'{}'}</div>
  );
  // Python
  if (ext === 'py') return (
    <div className={`p-1 px-1.5 bg-yellow-100 rounded text-yellow-700 font-bold text-[8px] uppercase ring-1 ring-yellow-200 flex-shrink-0 ${className}`}>PY</div>
  );
  // Go
  if (ext === 'go') return (
    <div className={`p-1 px-1.5 bg-cyan-50 rounded text-cyan-600 font-bold text-[8px] uppercase ring-1 ring-cyan-100 flex-shrink-0 ${className}`}>GO</div>
  );
  // Java
  if (ext === 'java') return (
    <div className={`p-1 px-1.5 bg-red-50 rounded text-red-600 font-bold text-[8px] uppercase ring-1 ring-red-100 flex-shrink-0 ${className}`}>JV</div>
  );
  // CSS
  if (ext === 'css') return (
    <div className={`p-1 px-1.5 bg-blue-100 rounded text-blue-700 font-bold text-[8px] uppercase ring-1 ring-blue-200 flex-shrink-0 ${className}`}>CSS</div>
  );
  // HTML
  if (ext === 'html' || ext === 'htm') return (
    <div className={`p-1 px-1.5 bg-orange-100 rounded text-orange-700 font-bold text-[8px] uppercase ring-1 ring-orange-200 flex-shrink-0 ${className}`}>HTML</div>
  );
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return (
    <div className={`p-1 px-1.5 bg-purple-50 rounded text-purple-600 font-bold text-[8px] uppercase ring-1 ring-purple-100 flex-shrink-0 ${className}`}>IMG</div>
  );
  // Config files
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(ext || '')) return (
    <div className={`p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0 ${className}`}>CFG</div>
  );

  // Default file icon
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 flex-shrink-0 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}
