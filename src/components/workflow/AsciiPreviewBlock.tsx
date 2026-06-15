/**
 * AsciiPreviewBlock — small reusable component for rendering an ASCII
 * wireframe / plan inside a monospace, horizontally-scrollable block.
 *
 * Goals:
 *  - preserve whitespace exactly (the LLM may produce leading spaces and
 *    unicode box-drawing characters that we must not collapse),
 *  - look visually distinct from regular prose (slightly darker background,
 *    monospace font, hairline border),
 *  - support an optional "Copy" button so users can paste the wireframe
 *    into another chat.
 *
 * The component is intentionally self-contained — it does not depend on
 * the workflow store, the chat store, or the i18n bundle for its core
 * rendering, so it can be reused from any feature that surfaces a
 * text-based preview.
 */

import { useState } from 'react';
import { t } from '@/i18n';

interface AsciiPreviewBlockProps {
  text: string;
  /** Optional accessible label. Defaults to a generic "ASCII preview" hint. */
  ariaLabel?: string;
  /** Hide the copy button (e.g. when text is empty). */
  hideCopyButton?: boolean;
  className?: string;
}

export function AsciiPreviewBlock({
  text,
  ariaLabel,
  hideCopyButton = false,
  className = '',
}: AsciiPreviewBlockProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const showCopy = !hideCopyButton && text.trim().length > 0;

  const handleCopy = async () => {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: best-effort, used in older jsdom-less envs.
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  if (!text || text.trim().length === 0) {
    return (
      <div className={`rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-400 ${className}`}>
        {t('workflow.goalPreflight.asciiEmpty')}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border border-gray-200 bg-slate-950 ${className}`}>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 z-10 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-100 transition-colors hover:bg-slate-800"
        >
          {copyState === 'copied'
            ? t('workflow.goalPreflight.copied')
            : copyState === 'failed'
              ? t('workflow.goalPreflight.copyFailed')
              : t('workflow.goalPreflight.copy')}
        </button>
      )}
      <pre
        aria-label={ariaLabel ?? t('workflow.goalPreflight.asciiAriaLabel')}
        className="m-0 max-h-[420px] overflow-x-auto overflow-y-auto p-3 text-[12px] leading-[1.45] text-slate-100"
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export default AsciiPreviewBlock;
