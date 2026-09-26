/**
 * @jest-environment jsdom
 *
 * TOP-15-14 — regression coverage for the sanitization layer that protects
 * ChatMessage (assistant markdown) and MarkdownDocumentPreview (document
 * skill output) from XSS.
 *
 * Why these are unit tests on the sanitizer/href-guard functions instead of
 * full component render tests: `jest.setup.js` globally stubs
 * `react-markdown` (`props.children` dumped verbatim as React text, no HTML
 * parsing) because the real package is ESM-only and breaks under this
 * project's CJS Jest transform. Under that stub, `DOMPurify.sanitize()`
 * output is rendered as escaped text regardless of whether sanitization
 * actually stripped anything, and `ChatMessage`'s `code`/`a`/`img`
 * component overrides are never invoked at all — so a component-level test
 * would pass even if the real sanitizer or href guard were broken. Testing
 * the same DOMPurify call signatures and the exported href guards directly
 * exercises the real security-relevant code paths.
 */

import { describe, expect, it } from '@jest/globals';
import DOMPurify from 'dompurify';
import { isSafeMarkdownHref as chatMessageIsSafeHref } from '../ChatMessage';
import {
  isSafeMarkdownHref as documentPreviewIsSafeHref,
  sanitizeMarkdownBody,
} from '../document/MarkdownDocumentPreview';

const XSS_PAYLOADS: Array<{ name: string; markup: string; forbidden: RegExp[] }> = [
  {
    name: 'script tag',
    markup: 'hello <script>window.__pwned = true;</script> world',
    forbidden: [/<script/i],
  },
  {
    name: 'img onerror handler',
    markup: '<img src="x" onerror="window.__pwned = true">',
    forbidden: [/onerror/i],
  },
  {
    name: 'svg onload handler',
    markup: '<svg onload="window.__pwned = true"><circle r="1"></circle></svg>',
    forbidden: [/onload/i],
  },
  {
    name: 'iframe embed',
    markup: '<iframe src="javascript:alert(1)"></iframe>',
    forbidden: [/<iframe/i],
  },
  {
    name: 'object embed',
    markup: '<object data="evil.swf"></object>',
    forbidden: [/<object/i],
  },
  {
    name: 'anchor javascript: href',
    markup: '<a href="javascript:alert(1)">click me</a>',
    forbidden: [/javascript:/i],
  },
];

describe('ChatMessage sanitization: DOMPurify.sanitize(content) (default profile)', () => {
  for (const { name, markup, forbidden } of XSS_PAYLOADS) {
    it(`strips ${name}`, () => {
      const clean = DOMPurify.sanitize(markup);
      for (const pattern of forbidden) {
        expect(clean).not.toMatch(pattern);
      }
    });
  }

  it('never lets a sanitized payload actually execute a handler', () => {
    (window as unknown as { __pwned?: boolean }).__pwned = undefined;
    const container = document.createElement('div');
    container.innerHTML = DOMPurify.sanitize('<img src="x" onerror="window.__pwned = true">');
    document.body.appendChild(container);
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeFalsy();
    container.remove();
  });

  it('leaves benign markdown/HTML untouched', () => {
    const clean = DOMPurify.sanitize('<strong>bold</strong> and <a href="https://example.com">a link</a>');
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('href="https://example.com"');
  });
});

describe('MarkdownDocumentPreview sanitization: sanitizeMarkdownBody (USE_PROFILES html:true)', () => {
  for (const { name, markup, forbidden } of XSS_PAYLOADS) {
    it(`strips ${name}`, () => {
      const clean = sanitizeMarkdownBody(markup);
      for (const pattern of forbidden) {
        expect(clean).not.toMatch(pattern);
      }
    });
  }

  it('leaves benign markdown/HTML untouched', () => {
    const clean = sanitizeMarkdownBody('<strong>bold</strong> and <a href="https://example.com">a link</a>');
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('href="https://example.com"');
  });
});

describe.each([
  ['ChatMessage', chatMessageIsSafeHref],
  ['MarkdownDocumentPreview', documentPreviewIsSafeHref],
])('%s isSafeMarkdownHref', (_label, isSafeMarkdownHref) => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
  ])('rejects %s', (href) => {
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

  it('rejects undefined href', () => {
    expect(isSafeMarkdownHref(undefined)).toBe(false);
  });
});
