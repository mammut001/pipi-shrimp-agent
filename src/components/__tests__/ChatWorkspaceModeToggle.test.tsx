/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';

import { ChatWorkspaceModeToggle } from '../ChatWorkspaceModeToggle';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

describe('ChatWorkspaceModeToggle', () => {
  it('renders chat and preview controls and switches into preview when allowed', () => {
    const onChange = jest.fn();
    const { getByTestId, getByRole } = render(
      createElement(ChatWorkspaceModeToggle, {
        mode: 'chat',
        canPreview: true,
        onChange,
      }),
    );

    expect(getByTestId('chat-workspace-mode-toggle')).toBeTruthy();
    expect(getByRole('button', { name: 'nav.chat' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: 'common.preview' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(getByRole('button', { name: 'common.preview' }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  it('keeps preview disabled when the session has no workspace path', () => {
    const onChange = jest.fn();
    const { getByRole } = render(
      createElement(ChatWorkspaceModeToggle, {
        mode: 'chat',
        canPreview: false,
        onChange,
      }),
    );

    const preview = getByRole('button', { name: 'common.preview' }) as HTMLButtonElement;
    expect(preview.disabled).toBe(true);
    fireEvent.click(preview);
    expect(onChange).not.toHaveBeenCalled();
  });
});
