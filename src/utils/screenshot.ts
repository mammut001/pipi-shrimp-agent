import type { BrowserScreenshotRef } from '@/types/browserPageState';

const MIN_BASE64_IMAGE_LENGTH = 50;
const IMAGE_URL_PREFIX = /^(data:image\/|blob:|https?:\/\/|app:|asset:|tauri:)/i;
const IMAGE_FILE_PATH = /^(~\/|\/|\.\/|\.\.\/|[A-Za-z]:[\\/]).+\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i;
const RAW_BASE64_IMAGE = /^[A-Za-z0-9+/=\s]+$/;

function normalizeInput(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRawBase64ImagePayload(value: string): boolean {
  return value.length >= MIN_BASE64_IMAGE_LENGTH && RAW_BASE64_IMAGE.test(value);
}

export function normalizeScreenshotSrc(value: string | null | undefined): string | null {
  const normalized = normalizeInput(value);
  if (!normalized) {
    return null;
  }

  if (IMAGE_URL_PREFIX.test(normalized) || IMAGE_FILE_PATH.test(normalized)) {
    return normalized;
  }

  if (isRawBase64ImagePayload(normalized)) {
    return `data:image/png;base64,${normalized.replace(/\s+/g, '')}`;
  }

  return null;
}

export function normalizeBrowserScreenshotSrc(
  screenshot?: BrowserScreenshotRef | null,
): string | null {
  if (!screenshot?.value) {
    return null;
  }

  if (screenshot.kind === 'data_url') {
    return normalizeScreenshotSrc(screenshot.value);
  }

  if (screenshot.kind === 'base64_png') {
    return normalizeScreenshotSrc(screenshot.value);
  }

  return normalizeScreenshotSrc(screenshot.value);
}