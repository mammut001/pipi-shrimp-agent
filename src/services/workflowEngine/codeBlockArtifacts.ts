/** Pure helpers for extracting fenced code-block file artifacts from agent output. */

export function extractCodeBlockArtifacts(text: string): Array<{ relativePath: string; content: string }> {
  const artifacts: Array<{ relativePath: string; content: string }> = [];
  const seenPaths = new Set<string>();

  // Pattern 1: ```lang:filepath or ```lang filepath or ```filepath
  // Example: ```python 02_scaffold.py or ```json:02_scaffold.json
  const codeBlockRegex = /```[ \t]*([a-zA-Z0-9_+\-#]+)?[: \t]+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const relativePath = match[2].trim();
    const content = match[3];
    if (relativePath && !seenPaths.has(relativePath) && !relativePath.startsWith('http') && !relativePath.includes('://')) {
      seenPaths.add(relativePath);
      artifacts.push({ relativePath, content });
    }
  }

  // Pattern 2: ```lang filename="filepath" or filename=filepath
  const filenameAttrRegex = /```[a-zA-Z0-9_+\-#]*[ \t]+filename=["']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)["']?[ \t]*\r?\n([\s\S]*?)```/g;
  while ((match = filenameAttrRegex.exec(text)) !== null) {
    const relativePath = match[1].trim();
    const content = match[2];
    if (relativePath && !seenPaths.has(relativePath)) {
      seenPaths.add(relativePath);
      artifacts.push({ relativePath, content });
    }
  }

  // Pattern 3: Header followed by code block: ### 02_scaffold.py or **02_scaffold.py**
  const headerBlockRegex = /(?:###|\*\*|File:)[ \t]*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?[ \t]*\r?\n+```[a-zA-Z0-9_+\-#]*[ \t]*\r?\n([\s\S]*?)```/g;
  while ((match = headerBlockRegex.exec(text)) !== null) {
    const relativePath = match[1].trim();
    const content = match[2];
    if (relativePath && !seenPaths.has(relativePath)) {
      seenPaths.add(relativePath);
      artifacts.push({ relativePath, content });
    }
  }

  return artifacts;
}
