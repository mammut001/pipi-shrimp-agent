/**
 * Strip provider-specific stream artifacts that should never reach the UI.
 * MiniMax M3 sometimes emits `]<]minimax[>` control tokens in text deltas.
 */
// Match `<]minimax[>` tokens, plus a leading `]` only when it is not part of `[]` UI text.
const MINIMAX_STREAM_ARTIFACT_PATTERN = /(?<!\[)\]<]minimax\[>|<\]minimax\[>/g;

export function stripProviderStreamArtifacts(content: string): string {
  if (!content) {
    return content;
  }

  return content.replace(MINIMAX_STREAM_ARTIFACT_PATTERN, '');
}