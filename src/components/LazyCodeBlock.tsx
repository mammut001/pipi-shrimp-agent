/**
 * LazyCodeBlock — Self-contained code-block renderer.
 *
 * This file statically imports react-syntax-highlighter + vscDarkPlus so that
 * when ChatMessage lazy-imports *this* module via React.lazy(), the entire
 * Prism bundle (~800 KB) is split into its own chunk and only fetched when a
 * code block first appears on screen.
 */

import { memo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface LazyCodeBlockProps {
  language: string;
  children: string;
}

const LazyCodeBlock = memo(function LazyCodeBlock({ language, children }: LazyCodeBlockProps) {
  return (
    <SyntaxHighlighter
      language={language || 'text'}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        padding: '1rem',
        fontSize: '0.85rem',
        backgroundColor: '#1e1e1e',
        borderRadius: '0 0 0.75rem 0.75rem',
        maxWidth: '100%',
        overflowX: 'auto',
      }}
      codeTagProps={{
        className: 'break-all',
      }}
    >
      {children}
    </SyntaxHighlighter>
  );
});

export default LazyCodeBlock;
