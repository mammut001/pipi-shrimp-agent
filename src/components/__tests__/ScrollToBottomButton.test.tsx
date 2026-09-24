/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import { ScrollToBottomButton } from '../chat/ScrollToBottomButton';

describe('ScrollToBottomButton', () => {
  it('stays hidden when the chat is already at the bottom', () => {
    render(<ScrollToBottomButton visible={false} onClick={() => undefined} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an accessible control and scrolls when clicked', () => {
    const onClick = jest.fn();
    render(<ScrollToBottomButton visible onClick={onClick} />);

    const button = screen.getByRole('button');
    const label = button.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(button.textContent?.trim()).toBe(label);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
