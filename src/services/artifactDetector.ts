/**
 * Artifact detection utility — scans tool results for generated files
 * and registers them in the artifacts store.
 *
 * Call `detectAndRegisterArtifacts()` after tool execution to automatically
 * populate the ArtifactsBadge / ArtifactsPanel for the current message.
 */

import { useArtifactsStore, type ArtifactFileType } from '@/store/artifactsStore';
import { convertFileSrc } from '@tauri-apps/api/core';

/** File extensions → artifact type mapping */
const EXT_MAP: Record<string, ArtifactFileType> = {
  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  // SVG
  svg: 'svg',
  // PDF
  pdf: 'pdf',
  // Code
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', rs: 'code',
  typ: 'code', html: 'code', css: 'code', json: 'code', toml: 'code', yaml: 'code',
  // Text
  txt: 'text', md: 'text', log: 'text',
};

/** MIME type lookup */
const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  bmp: 'image/bmp',
};

/** Detect file type from extension */
function detectFileType(filePath: string): ArtifactFileType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? 'unknown';
}

/** Get MIME type from extension */
function getMimeType(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext];
}

/** Extract file name from absolute path */
function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/**
 * Patterns for extracting file paths from tool output text.
 * Matches absolute paths that look like generated output files.
 */
const FILE_PATH_PATTERNS = [
  // Absolute paths ending with known extensions
  /(?:^|\s|["'`])(\/.+?\.(?:png|jpg|jpeg|gif|webp|bmp|svg|pdf|html|typ))(?:\s|["'`]|$)/gim,
  // "saved to /path/to/file" patterns
  /(?:saved?|wrote|written|created|generated|compiled|output)\s+(?:to|at|in)?\s*[:"]?\s*(\/.+?\.\w+)/gi,
  // "File: /path" patterns
  /(?:file|path|output):\s*(\/.+?\.\w+)/gi,
];

/**
 * Extract file paths from tool result text
 */
export function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();

  for (const pattern of FILE_PATH_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const p = match[1].trim().replace(/["'`]+$/g, '');
      // Only include paths that look like real files (not URLs, not too short)
      if (p.startsWith('/') && p.length > 5 && !p.includes('://')) {
        paths.add(p);
      }
    }
  }

  return Array.from(paths);
}

/**
 * Register file paths as artifacts for a given message.
 * Uses Tauri's convertFileSrc to create web-accessible URLs.
 */
export function registerFileArtifacts(messageId: string, filePaths: string[]): void {
  const store = useArtifactsStore.getState();

  // Filter out paths that are already registered for this message
  const existing = new Set(
    store.items.filter(i => i.messageId === messageId).map(i => i.filePath)
  );

  const newItems = filePaths
    .filter(p => !existing.has(p))
    .filter(p => {
      const ft = detectFileType(p);
      // Only register previewable file types
      return ft !== 'unknown';
    })
    .map(filePath => ({
      name: fileName(filePath),
      filePath,
      url: convertFileSrc(filePath),
      fileType: detectFileType(filePath),
      mimeType: getMimeType(filePath),
      messageId,
    }));

  if (newItems.length > 0) {
    store.addArtifacts(newItems);
  }
}

/**
 * All-in-one: scan tool result text, extract file paths, register them.
 * Call this after each tool execution round.
 */
export function detectAndRegisterArtifacts(messageId: string, toolResultText: string): void {
  const paths = extractFilePaths(toolResultText);
  if (paths.length > 0) {
    registerFileArtifacts(messageId, paths);
  }
}

/**
 * Manually add a single file artifact (for direct use when you already know the path).
 */
export function addFileArtifact(messageId: string, filePath: string, name?: string): string {
  const store = useArtifactsStore.getState();
  return store.addArtifact({
    name: name ?? fileName(filePath),
    filePath,
    url: convertFileSrc(filePath),
    fileType: detectFileType(filePath),
    mimeType: getMimeType(filePath),
    messageId,
  });
}
