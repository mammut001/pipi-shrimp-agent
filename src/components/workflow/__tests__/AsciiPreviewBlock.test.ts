/**
 * AsciiPreviewBlock — small rendering tests
 *
 * The component is intentionally simple. We render it to a string with
 * `renderToStaticMarkup` (no DOM, no React 18 createRoot required) and
 * assert that the ASCII text is preserved verbatim and that the wrapper
 * is visually distinct from regular prose.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AsciiPreviewBlock } from '../AsciiPreviewBlock';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

describe('AsciiPreviewBlock', () => {
  it('renders a monospace <pre> block with the input text intact', () => {
    const sample = '┌────────┐\n│ Login  │\n└────────┘';
    const markup = renderToStaticMarkup(createElement(AsciiPreviewBlock, { text: sample }));

    expect(markup).toContain('┌────────┐');
    expect(markup).toContain('│ Login  │');
    expect(markup).toContain('└────────┘');
    expect(markup).toContain('<pre');
    expect(markup).toContain('monospace');
  });

  it('preserves leading whitespace exactly', () => {
    const sample = '    indented\n        more indented';
    const markup = renderToStaticMarkup(createElement(AsciiPreviewBlock, { text: sample }));
    expect(markup).toContain('    indented');
    expect(markup).toContain('        more indented');
  });

  it('renders an empty-state placeholder when the text is empty', () => {
    const markup = renderToStaticMarkup(createElement(AsciiPreviewBlock, { text: '' }));
    expect(markup).toContain('workflow.goalPreflight.asciiEmpty');
    expect(markup).not.toContain('<pre');
  });
});
