import { describe, it, expect } from '@jest/globals';
import {
  extractImageFilesFromClipboard,
  extractImageFilesFromFileList,
  extractImageFilesFromDataTransfer,
  hasImageItems,
} from '../imageAttachmentInput';

describe('imageAttachmentInput', () => {
  it('handles null inputs safely', () => {
    expect(extractImageFilesFromClipboard(null)).toEqual([]);
    expect(extractImageFilesFromFileList(null)).toEqual([]);
    expect(extractImageFilesFromDataTransfer(null)).toEqual([]);
    expect(hasImageItems(null)).toBe(false);
  });

  it('extracts image files from clipboard DataTransfer items', () => {
    const pngFile = new File(['dummy png'], 'test.png', { type: 'image/png' });
    const textFile = new File(['dummy text'], 'test.txt', { type: 'text/plain' });

    const clipboardData = {
      items: [
        { type: 'image/png', getAsFile: () => pngFile },
        { type: 'text/plain', getAsFile: () => textFile },
        { type: 'image/jpeg', getAsFile: () => null },
      ],
    } as unknown as DataTransfer;

    const result = extractImageFilesFromClipboard(clipboardData);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(pngFile);
  });

  it('extracts image files from FileList', () => {
    const pngFile = new File(['png'], 'a.png', { type: 'image/png' });
    const textFile = new File(['txt'], 'b.txt', { type: 'text/plain' });

    const fileList = [pngFile, textFile] as unknown as FileList;
    const result = extractImageFilesFromFileList(fileList);
    expect(result).toEqual([pngFile]);
  });

  it('extracts image files from drag DataTransfer', () => {
    const pngFile = new File(['png'], 'a.png', { type: 'image/png' });
    const dataTransfer = {
      files: [pngFile],
    } as unknown as DataTransfer;

    expect(extractImageFilesFromDataTransfer(dataTransfer)).toEqual([pngFile]);
  });

  it('checks hasImageItems properly', () => {
    const textItems = {
      items: [{ type: 'text/plain' }],
    } as unknown as DataTransfer;
    expect(hasImageItems(textItems)).toBe(false);

    const imageItems = {
      items: [{ type: 'image/png' }],
    } as unknown as DataTransfer;
    expect(hasImageItems(imageItems)).toBe(true);
  });
});
