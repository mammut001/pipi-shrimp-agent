import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockReactMarkdown = jest.fn(({ children }: { children: string }) =>
  createElement('section', { 'data-testid': 'markdown-preview' }, children),
);
const mockRemarkGfm = 'remark-gfm-plugin';

jest.mock('dompurify', () => ({
  __esModule: true,
  default: {
    sanitize: (value: string) => value,
  },
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: { children: string }) => mockReactMarkdown(props),
}));

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: mockRemarkGfm,
}));

import { MarkdownDocumentPreview } from '@/components/document/MarkdownDocumentPreview';

describe('MarkdownDocumentPreview', () => {
  beforeEach(() => {
    mockReactMarkdown.mockClear();
  });

  it('forwards sanitized markdown content and GFM plugin to the renderer', () => {
    const body = '# FocusApp\n\n- Ship docs preview\n- Keep metadata readable';
    const markup = renderToStaticMarkup(createElement(MarkdownDocumentPreview, { body }));

    expect(markup).toContain('data-testid="markdown-preview"');
    expect(markup).toContain('prose prose-stone');
    expect(markup).toContain('FocusApp');

    expect(mockReactMarkdown).toHaveBeenCalledTimes(1);
    expect(mockReactMarkdown.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      children: body,
      remarkPlugins: [mockRemarkGfm],
    }));
  });
});