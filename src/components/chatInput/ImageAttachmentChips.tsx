/**
 * ImageAttachmentChips — preview strip for ChatInput image attachments (AG-13).
 */

import { buildImageDataUrl } from '@/services/vision/imageAttachments';
import type { ImageAttachment } from '@/types/vision';
import { t } from '@/i18n';

export interface ImageAttachmentChipsProps {
  attachments: ImageAttachment[];
  onRemove: (id: string) => void;
}

export function ImageAttachmentChips({ attachments, onRemove }: ImageAttachmentChipsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 pt-3">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5"
        >
          <img
            src={buildImageDataUrl(attachment)}
            alt={attachment.origPath || 'attachment'}
            className="h-10 w-10 rounded object-cover"
          />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-gray-700">
              {attachment.origPath || t('chat.imageAttachment')}
            </div>
            <div className="text-[10px] text-gray-400">
              {(attachment.bytes / 1024).toFixed(1)} KB
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="text-gray-300 transition-colors hover:text-gray-500"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
