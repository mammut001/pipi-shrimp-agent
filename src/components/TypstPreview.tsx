/**
 * TypstPreview - Typst document preview component
 *
 * Features:
 * - Real-time rendering of Typst content to SVG
 * - Debounced compilation (300ms) to avoid excessive backend calls
 * - Loading state with smooth opacity transition
 * - Error boundary displaying compilation errors
 * - A4 paper-like styling for academic documents
 * - Dark mode support
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import DOMPurify from 'dompurify';

/**
 * Props for TypstPreview component
 */
interface TypstPreviewProps {
  /** The raw Typst source content to render */
  rawContent: string;
  /** Optional className for container styling */
  className?: string;
  /** Optional output directory — when set, PDF exports save here directly */
  outputDir?: string;
}

/**
 * Custom debounce hook implementation (no external dependency)
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * TypstPreview - Renders Typst content as SVG with real-time preview
 */
export function TypstPreview({ rawContent, className = '', outputDir }: TypstPreviewProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Canvas zoom/pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Debounce the content to avoid excessive compiles (300ms for better performance)
  const debouncedContent = useDebounce(rawContent, 300);

  // Track the current render request to handle race conditions
  const renderIdRef = useRef(0);

  // Ref for the SVG container — used to make SVGs responsive after injection
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const renderTypst = useCallback(async (content: string, currentRenderId: number) => {
    if (!content.trim()) {
      setSvgContent('');
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      const result = await invoke<string>('render_typst_to_svg', { source: content });

      // Only update state if this is still the latest render request
      if (currentRenderId === renderIdRef.current) {
        setSvgContent(result);
        setError(null);
      }
    } catch (err) {
      // Only show error if this is still the latest render request
      if (currentRenderId === renderIdRef.current) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setSvgContent('');
      }
    } finally {
      // Only update loading state if this is still the latest render request
      if (currentRenderId === renderIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Effect to trigger rendering when debounced content changes
  useEffect(() => {
    setIsLoading(true);
    renderIdRef.current += 1;
    const currentRenderId = renderIdRef.current;

    renderTypst(debouncedContent, currentRenderId);
  }, [debouncedContent, renderTypst]);

  // Fit-to-width: auto-scale content to fit viewport width
  const fitToWidth = useCallback(() => {
    if (!viewportRef.current || !svgContainerRef.current) return;
    requestAnimationFrame(() => {
      const vw = viewportRef.current!.clientWidth;
      const cw = svgContainerRef.current!.scrollWidth;
      if (cw === 0) return;
      const newZoom = Math.min((vw - 48) / cw, 1.5);
      const offsetX = (vw - cw * newZoom) / 2;
      setZoom(newZoom);
      setPan({ x: offsetX, y: 24 });
    });
  }, []);

  // Auto fit when SVG content loads
  useEffect(() => {
    if (svgContent) fitToWidth();
  }, [svgContent, fitToWidth]);

  // Wheel zoom (mouse-centered, must use native addEventListener)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const SENSITIVITY = 0.0008;
      const delta = -e.deltaY * SENSITIVITY;

      setZoom(prevZoom => {
        const newZoom = Math.min(Math.max(prevZoom * (1 + delta * 10), 0.1), 5);
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scale = newZoom / prevZoom;

        setPan(prevPan => ({
          x: mouseX - scale * (mouseX - prevPan.x),
          y: mouseY - scale * (mouseY - prevPan.y),
        }));

        return newZoom;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Mouse drag panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  // Toolbar zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.25, 5));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.25, 0.1));
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomPercent = Math.round(zoom * 100);

  // Export to PDF - first select folder, then save
  const handleExportPDF = useCallback(async () => {
    if (!rawContent.trim()) {
      alert('No content to export');
      return;
    }

    setIsExporting(true);
    try {
      let folderPath: string | undefined;

      if (outputDir) {
        // Use session output directory directly
        folderPath = outputDir;
      } else {
        // Fall back to folder selection dialog
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Select folder to save PDF',
        });

        if (!selected) {
          setIsExporting(false);
          return;
        }

        folderPath = Array.isArray(selected) ? selected[0] : selected;
      }

      if (folderPath) {
        // Generate timestamp-based filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `${timestamp}.pdf`;
        const filePath = `${folderPath}/${fileName}`;

        console.log('[TypstPreview] Exporting PDF to:', filePath);
        const result = await invoke<string>('render_typst_to_pdf', { source: rawContent, filePath });
        console.log('[TypstPreview] PDF exported successfully:', result);
        alert(`PDF saved to:\n${result}`);
      }
    } catch (err) {
      console.error('[TypstPreview] Export failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Export failed: ${errorMessage}`);
    } finally {
      setIsExporting(false);
    }
  }, [rawContent, outputDir]);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar with Export + Zoom controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-t-lg flex-shrink-0">
        {/* Export PDF Button */}
        <button
          onClick={handleExportPDF}
          disabled={isExporting || !svgContent}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

        {/* Zoom Controls */}
        <button
          onClick={handleZoomOut}
          className="w-6 h-6 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-sm font-bold"
        >−</button>

        <button
          onClick={handleReset}
          className="px-2 py-0.5 text-[11px] font-mono text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded min-w-[40px] text-center"
          title="Reset zoom"
        >
          {zoomPercent}%
        </button>

        <button
          onClick={handleZoomIn}
          className="w-6 h-6 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-sm font-bold"
        >+</button>

        <button
          onClick={fitToWidth}
          className="px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          title="Fit to width"
        >Fit</button>

        {/* Loading indicator in toolbar */}
        {isLoading && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-400">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Rendering
          </div>
        )}
      </div>

      {/* Canvas Viewport */}
      <div
        ref={viewportRef}
        className={`
          relative flex-1 overflow-hidden
          bg-gray-100 dark:bg-gray-800
          transition-opacity duration-200
          ${isLoading ? 'opacity-60' : 'opacity-100'}
        `}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Transform Layer */}
        <div
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
        >
          {svgContent ? (
            <div
              ref={svgContainerRef}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svgContent, {
                USE_PROFILES: { svg: true, svgFilters: true },
                FORBID_TAGS: ['script'],
                FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
              }) }}
            />
          ) : !isLoading && !error ? (
            <div className="flex items-center justify-center py-12 text-gray-400" style={{ width: 400 }}>
              <p className="text-sm">Enter Typst content to preview...</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mt-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <h4 className="font-medium text-red-800 dark:text-red-400 text-sm">
                Typst Compilation Error
              </h4>
              <pre className="mt-2 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                {error}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TypstPreview;
