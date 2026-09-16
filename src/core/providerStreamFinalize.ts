/**
 * Provider stream finalize helpers (truncated replies / clean terminal state).
 *
 * Keep this in `core/` so QueryEngine / queryLoop can observe truncation
 * without importing the chat store.
 */

/** Notice appended when the provider stream ends without a clean finish. */
export const PROVIDER_STREAM_TRUNCATED_NOTICE =
  '\n\n⚠️ **Reply truncated** — provider stream ended before a clean finish.';

export type ProviderStreamCompletionMeta = {
  truncated?: boolean;
  finish_reason?: string | null;
  stop_reason?: string | null;
  content?: unknown;
};

/**
 * True when native finalize marked the reply truncated, or the finish/stop
 * reason is a known cut-off (`length` / `content_filter`).
 */
export function isTruncatedProviderResponse(
  response: ProviderStreamCompletionMeta | null | undefined,
): boolean {
  if (!response) {
    return false;
  }
  if (response.truncated === true) {
    return true;
  }
  const reason = response.finish_reason ?? response.stop_reason;
  return reason === 'length' || reason === 'content_filter';
}

/**
 * Ensure truncated streams surface a clear terminal marker on assistant text
 * (no silent half-visible cutoff). Idempotent if the notice is already present.
 */
export function appendTruncatedReplyNotice(content: string): string {
  if (!content.trim()) {
    return content;
  }
  if (content.includes('**Reply truncated**')) {
    return content;
  }
  return `${content}${PROVIDER_STREAM_TRUNCATED_NOTICE}`;
}
