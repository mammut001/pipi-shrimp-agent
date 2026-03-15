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
import { invoke } from '@tauri-apps/api/tauri';

/**
 * Props for TypstPreview component
 */
interface TypstPreviewProps {
  /** The raw Typst source content to render */
  rawContent: string;
  /** Optional className for container styling */
  className?: string;
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
export function TypstPreview({ rawContent, className = '' }: TypstPreviewProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the content to avoid excessive compiles
  const debouncedContent = useDebounce(rawContent, 400);

  // Track the current render request to handle race conditions
  const renderIdRef = useRef(0);

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

  // Detect dark mode
  const isDarkMode = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Preview Container - A4 Paper Style */}
      <div
        className={`
          relative overflow-hidden
          bg-white rounded-lg shadow-md
          ${isDarkMode ? 'dark' : ''}
          transition-opacity duration-200
          ${isLoading ? 'opacity-70' : 'opacity-100'}
        `}
      >
        {/* Loading Indicator */}
        {isLoading && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Rendering...</span>
          </div>
        )}

        {/* SVG Content Area */}
        <div
          className={`
            p-6 min-h-[200px] max-h-[70vh] overflow-auto
            bg-white dark:bg-gray-900
            ${isDarkMode ? 'dark:invert dark:prose-invert' : ''}
          `}
          style={{ aspectRatio: '1 / 1.414' }} // A4 aspect ratio
        >
          {svgContent ? (
            <div
              className="w-full h-full flex justify-center items-start overflow-auto"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : !error ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
              <p>Enter Typst content to preview...</p>
            </div>
          ) : null}
        </div>

        {/* Footer with dimensions hint */}
        <div className="px-6 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500">
          A4 Preview
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
