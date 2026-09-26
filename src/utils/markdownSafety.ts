import DOMPurify from 'dompurify';

const BLOCKED_HREF_SCHEMES = ['javascript:', 'data:', 'vbscript:'];

// Browsers drop tab/newline anywhere in a URL and trim leading C0 controls,
// so `java\tscript:` still navigates as `javascript:`. Strip them before the check.
const URL_IGNORED_CHARS = /[\u0000- \u007f-\u009f]/g;

export function isSafeMarkdownHref(href: string | undefined): boolean {
  if (!href) return false;
  const normalized = href.replace(URL_IGNORED_CHARS, '').toLowerCase();
  return !BLOCKED_HREF_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

/** Assistant chat markdown, rendered with rehype-raw. */
export function sanitizeAssistantMarkdown(content: string): string {
  return DOMPurify.sanitize(content);
}

/** Document-skill markdown preview. */
export function sanitizeDocumentMarkdown(body: string): string {
  return DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });
}
