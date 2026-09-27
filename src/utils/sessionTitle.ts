/**
 * Session titles derived from the conversation, so the sidebar does not stay
 * a list of "Chat 1", "Chat 2".
 */

const MAX_TITLE_LENGTH = 30;

/** Titles the app assigns on creation (`Chat 3`), which are safe to replace. */
export function isDefaultSessionTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? '').trim();
  return trimmed === '' || /^Chat \d+$/.test(trimmed);
}

/** First meaningful line of the user's opening message, shortened for the sidebar. */
export function deriveSessionTitle(content: string): string | null {
  const firstLine = content
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)/, '')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }
  const characters = Array.from(firstLine);
  if (characters.length <= MAX_TITLE_LENGTH) {
    return firstLine;
  }
  return `${characters.slice(0, MAX_TITLE_LENGTH).join('').trimEnd()}…`;
}
