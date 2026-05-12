export function stripAnsiText(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function writeClipboardTextFallback(text: string): void {
  if (typeof document === 'undefined') {
    throw new Error('Clipboard fallback is unavailable in this environment.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Clipboard fallback copy command failed.');
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  const normalized = stripAnsiText(text);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalized);
      return;
    } catch {
      // Fall through to execCommand for Tauri webview compatibility.
    }
  }

  writeClipboardTextFallback(normalized);
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('File download is unavailable in this environment.');
  }

  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
