/**
 * @jest-environment jsdom
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useChatInputImageAttachments } from '../useChatInputImageAttachments';

const fileToImageAttachment = jest.fn(async (file: File, source: string) => ({
  id: `att-${file.name}`,
  name: file.name,
  mimeType: file.type,
  source,
  dataUrl: 'data:image/png;base64,xx',
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  fileToImageAttachment: (...args: unknown[]) => (fileToImageAttachment as any)(...args),
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../imageAttachmentInput', () => ({
  extractImageFilesFromClipboard: (data: DataTransfer | null) => {
    const items = Array.from(data?.items ?? []);
    return items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  },
  extractImageFilesFromFileList: (list: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/')),
  extractImageFilesFromDataTransfer: (dt: DataTransfer | null) => Array.from(dt?.files ?? []).filter((f) => f.type.startsWith('image/')),
}));

describe('useChatInputImageAttachments', () => {
  const addNotification = jest.fn();
  let attachments: any[];
  const setAttachments = jest.fn((updater: any) => {
    attachments = typeof updater === 'function' ? updater(attachments) : updater;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    attachments = [];
  });

  it('appends converted image attachments and notifies success', async () => {
    const { result } = renderHook(() => useChatInputImageAttachments({
      setAttachments,
      addNotification: addNotification as any,
    }));

    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    await act(async () => {
      await result.current.appendImageAttachments([file], 'paste');
    });

    expect(fileToImageAttachment).toHaveBeenCalledWith(file, 'paste');
    expect(attachments).toHaveLength(1);
    expect(addNotification).toHaveBeenCalledWith('success', expect.stringContaining('chat.imagesAdded'));
  });

  it('notifies error when conversion fails', async () => {
    fileToImageAttachment.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChatInputImageAttachments({
      setAttachments,
      addNotification: addNotification as any,
    }));

    await act(async () => {
      await result.current.appendImageAttachments(
        [new File(['x'], 'bad.png', { type: 'image/png' })],
        'upload',
      );
    });

    expect(addNotification).toHaveBeenCalledWith('error', expect.stringContaining('chat.imagesAddFailed'));
  });
});
