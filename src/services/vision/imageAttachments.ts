import type { ImageAttachment } from '@/types/vision';

const IMAGE_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function normalizeMime(mime: string | undefined, fallbackName?: string): string | null {
  const trimmed = mime?.trim().toLowerCase();
  if (trimmed?.startsWith('image/')) {
    return trimmed === 'image/jpg' ? 'image/jpeg' : trimmed;
  }

  const ext = fallbackName?.split('.').pop()?.toLowerCase();
  if (ext && IMAGE_MIME_MAP[ext]) {
    return IMAGE_MIME_MAP[ext];
  }

  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function fileToImageAttachment(
  file: File,
  source: ImageAttachment['source'],
): Promise<ImageAttachment> {
  const mime = normalizeMime(file.type, file.name);
  if (!mime) {
    throw new Error(`Unsupported image type: ${file.name}`);
  }

  const data = arrayBufferToBase64(await file.arrayBuffer());

  return {
    id: crypto.randomUUID(),
    source,
    mime,
    bytes: file.size,
    encoding: 'base64',
    data,
    origPath: file.name,
    createdAt: Date.now(),
  };
}

export function createImageAttachmentFromBase64(args: {
  mime: string;
  data: string;
  bytes: number;
  source: ImageAttachment['source'];
  origPath?: string;
}): ImageAttachment {
  const mime = normalizeMime(args.mime, args.origPath);
  if (!mime) {
    throw new Error(`Unsupported image type: ${args.origPath ?? args.mime}`);
  }

  return {
    id: crypto.randomUUID(),
    source: args.source,
    mime,
    bytes: args.bytes,
    encoding: 'base64',
    data: args.data,
    origPath: args.origPath,
    createdAt: Date.now(),
  };
}

export function buildImageDataUrl(attachment: ImageAttachment): string {
  return `data:${attachment.mime};base64,${attachment.data}`;
}

export function describeImageAttachments(attachments: ImageAttachment[]): string {
  if (attachments.length === 0) {
    return '0 image attachments';
  }

  const names = attachments
    .map((attachment, index) => attachment.origPath || `image-${index + 1}`)
    .slice(0, 3);
  const suffix = attachments.length > 3 ? ` +${attachments.length - 3} more` : '';
  return `${attachments.length} image attachment${attachments.length > 1 ? 's' : ''}: ${names.join(', ')}${suffix}`;
}
