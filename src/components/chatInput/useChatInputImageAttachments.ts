/**
 * Image attachment append + paste/file/drop handlers for ChatInput (AG-13).
 */

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { fileToImageAttachment } from '@/services/vision/imageAttachments';
import { t } from '@/i18n';
import type { ImageAttachment } from '@/types/vision';
import {
  extractImageFilesFromClipboard,
  extractImageFilesFromFileList,
  extractImageFilesFromDataTransfer,
} from './imageAttachmentInput';

export interface UseChatInputImageAttachmentsParams {
  setAttachments: Dispatch<SetStateAction<ImageAttachment[]>>;
  addNotification: (type: any, message: string) => void;
}

export function useChatInputImageAttachments({
  setAttachments,
  addNotification,
}: UseChatInputImageAttachmentsParams) {
  const appendImageAttachments = useCallback(async (
    files: File[],
    source: ImageAttachment['source'],
  ) => {
    if (files.length === 0) {
      return;
    }

    try {
      const nextAttachments = await Promise.all(files.map((file) => fileToImageAttachment(file, source)));
      setAttachments((current) => [...current, ...nextAttachments]);
      addNotification('success', `${t('chat.imagesAdded')}: ${nextAttachments.length}`);
    } catch (error) {
      addNotification('error', `${t('chat.imagesAddFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [addNotification, setAttachments]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = extractImageFilesFromClipboard(e.clipboardData);
    if (imageFiles.length === 0) return; // plain text paste — let browser handle it normally

    e.preventDefault(); // stop the tofu characters from being inserted
    void appendImageAttachments(imageFiles, 'paste');
  }, [appendImageAttachments]);

  const handleFileSelection = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = extractImageFilesFromFileList(e.target.files);
    await appendImageAttachments(files, 'upload');
    e.target.value = '';
  }, [appendImageAttachments]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const files = extractImageFilesFromDataTransfer(e.dataTransfer);
    if (files.length === 0) {
      return;
    }
    e.preventDefault();
    void appendImageAttachments(files, 'upload');
  }, [appendImageAttachments]);

  return {
    appendImageAttachments,
    handlePaste,
    handleFileSelection,
    handleDrop,
  };
}
