/**
 * Typst code block extraction utilities
 */

/**
 * Extract all Typst code blocks from markdown content
 * Matches ```typst ... ``` blocks
 */
function extractTypstBlocks(content: string): string[] {
  const regex = /```typst\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1].trim());
  }

  return blocks;
}

/**
 * Get the latest Typst code block from an array of messages
 * Searches from the most recent message to the oldest
 */
export function getLatestTypstBlock(
  messages: { content: string }[]
): string | null {
  // Search in reverse order (newest first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = extractTypstBlocks(messages[i].content);
    if (blocks.length > 0) {
      return blocks[blocks.length - 1]; // Return the last block in that message
    }
  }
  return null;
}

