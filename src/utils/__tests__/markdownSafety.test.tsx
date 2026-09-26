/**
 * @jest-environment jsdom
 *
 * TOP-15-14 — XSS hardening for assistant chat markdown and document previews.
 *
 * jest.setup.js stubs react-markdown to render `props.children` verbatim as
 * text, so the component-wiring tests below see exactly the string each
 * component hands to ReactMarkdown: if a component stops sanitizing, the raw
 * payload shows up in textContent and the test fails.
 */

import React from 'react';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import type { Message } from '@/types/chat';
import {
  isSafeMarkdownHref,
  sanitizeAssistantMarkdown,
  sanitizeDocumentMarkdown,
} from '../markdownSafety';

jest.mock('@/store', () => ({
  useUIStore: Object.assign(jest.fn(), {
    getState: () => ({ setArtifactId: jest.fn(), setAgentPanelTab: jest.fn() }),
  }),
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  buildImageDataUrl: () => 'data:image/png;base64,abc',
}));

import { ChatMessage } from '@/components/ChatMessage';
import { MarkdownDocumentPreview } from '@/components/document/MarkdownDocumentPreview';

const XSS_PAYLOADS: Array<{ name: string; markup: string; forbidden: RegExp }> = [
  { name: 'script tag', markup: 'hi <script>window.__pwned = true;</script>', forbidden: /<script/i },
  { name: 'img onerror', markup: '<img src="x" onerror="window.__pwned = true">', forbidden: /onerror/i },
  { name: 'svg onload', markup: '<svg onload="window.__pwned = true"><circle r="1"></circle></svg>', forbidden: /onload/i },
  { name: 'iframe', markup: '<iframe src="javascript:alert(1)"></iframe>', forbidden: /<iframe/i },
  { name: 'object', markup: '<object data="evil.swf"></object>', forbidden: /<object/i },
  { name: 'anchor javascript: href', markup: '<a href="javascript:alert(1)">x</a>', forbidden: /javascript:/i },
];

describe.each([
  ['sanitizeAssistantMarkdown', sanitizeAssistantMarkdown],
  ['sanitizeDocumentMarkdown', sanitizeDocumentMarkdown],
])('%s', (_label, sanitize) => {
  it.each(XSS_PAYLOADS)('strips $name', ({ markup, forbidden }) => {
    expect(sanitize(markup)).not.toMatch(forbidden);
  });

  it('keeps benign HTML', () => {
    const clean = sanitize('<strong>bold</strong> <a href="https://example.com">link</a>');
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('href="https://example.com"');
  });
});

describe('isSafeMarkdownHref', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
  ])('rejects %j', (href) => {
    expect(isSafeMarkdownHref(href)).toBe(false);
  });

  it.each([
    'https://example.com',
    'http://example.com/path?x=1',
    'mailto:someone@example.com',
    '/relative/path',
    '#anchor',
  ])('allows %s', (href) => {
    expect(isSafeMarkdownHref(href)).toBe(true);
  });

  it('rejects an empty href', () => {
    expect(isSafeMarkdownHref(undefined)).toBe(false);
    expect(isSafeMarkdownHref('')).toBe(false);
  });
});

describe('components hand ReactMarkdown sanitized content', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  async function render(element: React.ReactElement): Promise<string> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(element);
    });
    return container.querySelector('[data-testid="react-markdown"]')?.textContent ?? '';
  }

  const payload = 'safe text <img src="x" onerror="window.__pwned = true"><script>alert(1)</script>';

  it('ChatMessage sanitizes assistant content before rendering', async () => {
    const message: Message = { id: 'm1', role: 'assistant', content: payload, timestamp: Date.now() };
    const rendered = await render(<ChatMessage message={message} />);
    expect(rendered).toContain('safe text');
    expect(rendered).not.toMatch(/onerror|<script/i);
  });

  it('MarkdownDocumentPreview sanitizes the document body before rendering', async () => {
    const rendered = await render(<MarkdownDocumentPreview body={payload} />);
    expect(rendered).toContain('safe text');
    expect(rendered).not.toMatch(/onerror|<script/i);
  });
});
