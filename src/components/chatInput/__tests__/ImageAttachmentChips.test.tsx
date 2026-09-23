/**
 * @jest-environment jsdom
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageAttachmentChips } from '../ImageAttachmentChips';
import type { ImageAttachment } from '@/types/vision';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/services/vision/imageAttachments', () => ({
  buildImageDataUrl: () => 'data:image/png;base64,xx',
}));

describe('ImageAttachmentChips', () => {
  it('returns null when empty', () => {
    const { container } = render(
      <ImageAttachmentChips attachments={[]} onRemove={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders chip and remove', () => {
    const onRemove = jest.fn();
    const attachment: ImageAttachment = {
      id: 'a1',
      source: 'upload',
      mime: 'image/png',
      bytes: 2048,
      encoding: 'base64',
      data: 'xx',
      origPath: 'shot.png',
      createdAt: 0,
    };
    render(<ImageAttachmentChips attachments={[attachment]} onRemove={onRemove} />);
    expect(screen.getByText('shot.png')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('common.delete'));
    expect(onRemove).toHaveBeenCalledWith('a1');
  });
});
