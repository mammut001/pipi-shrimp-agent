/**
 * When a workflow agent turn writes files and returns no assistant text,
 * the handoff string still has to carry the path or tool result.
 * Summary notify only keeps the first 600 characters, so the path comes first.
 */

export interface FileWriteCapture {
  name: string;
  args: string;
  result?: string;
}

const FILE_WRITE_TOOL_NAMES = new Set([
  'filewrite',
  'write',
  'file_write',
  'writefile',
  'write_file',
  'fileedit',
  'edit',
  'replace',
  'file_edit',
  'edit_file',
  'strreplace',
  'search_replace',
  'apply_patch',
  'create_directory',
  'ssh_upload_file',
]);

const PATH_KEYS = [
  'file_path',
  'filePath',
  'path',
  'filepath',
  'target_file',
  'targetPath',
  'notebook_path',
];

const RESULT_SNIPPET_CHARS = 400;

export function isFileWriteToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (FILE_WRITE_TOOL_NAMES.has(normalized)) return true;
  const underscored = normalized.replace(/[\s-]+/g, '_');
  if (FILE_WRITE_TOOL_NAMES.has(underscored)) return true;
  const compact = underscored.replace(/_/g, '');
  return compact === 'filewrite'
    || compact === 'writefile'
    || compact === 'fileedit'
    || compact === 'strreplace'
    || compact === 'searchreplace'
    || compact === 'sshuploadfile';
}

export function extractWrittenPath(toolArgs: string): string | null {
  const text = toolArgs.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of PATH_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  } catch {
    // Arguments are not JSON. Fall through to a path field scan.
  }

  const match = text.match(/"(?:file_path|filePath|path|filepath|target_file|targetPath)"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match?.[1]) return null;
  try {
    const decoded = JSON.parse(`"${match[1]}"`) as unknown;
    return typeof decoded === 'string' && decoded.trim() ? decoded.trim() : null;
  } catch {
    return match[1];
  }
}

export function formatFileWriteHandoff(writes: readonly FileWriteCapture[]): string {
  const lines: string[] = [];
  for (const write of writes) {
    const writtenPath = extractWrittenPath(write.args);
    if (writtenPath) {
      lines.push(`[file write] ${writtenPath}`);
    }
    const result = (write.result ?? '').replace(/\s+/g, ' ').trim();
    if (result) {
      lines.push(`${write.name}: ${result.slice(0, RESULT_SNIPPET_CHARS)}`);
    } else if (!writtenPath && write.args.trim()) {
      lines.push(`${write.name}: ${write.args.trim().slice(0, RESULT_SNIPPET_CHARS)}`);
    }
  }
  return lines.join('\n').trim();
}

function sameToolName(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

export function recordFileWriteCall(
  writes: FileWriteCapture[],
  call: { name: string; arguments?: string },
): void {
  if (!isFileWriteToolName(call.name)) return;
  writes.push({
    name: call.name,
    args: call.arguments ?? '',
    result: undefined,
  });
}

export function recordFileWriteResult(
  writes: FileWriteCapture[],
  result: { name: string; result?: string },
): void {
  if (!isFileWriteToolName(result.name)) return;
  const pending = [...writes].reverse().find((entry) => (
    entry.result === undefined && sameToolName(entry.name, result.name)
  ));
  if (pending) {
    pending.result = result.result ?? '';
    return;
  }
  writes.push({
    name: result.name,
    args: '',
    result: result.result ?? '',
  });
}
