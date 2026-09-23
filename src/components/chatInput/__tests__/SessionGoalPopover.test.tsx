/**
 * @jest-environment jsdom
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionGoalPopover } from '../SessionGoalPopover';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

describe('SessionGoalPopover', () => {
  const onOpenChange = jest.fn();
  const onGoalInputChange = jest.fn();
  const onSave = jest.fn();
  const onClear = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders goal button and opens popover', () => {
    const { rerender } = render(
      <SessionGoalPopover
        open={false}
        onOpenChange={onOpenChange}
        sessionGoal=""
        goalInputText=""
        onGoalInputChange={onGoalInputChange}
        hasSession
        onSave={onSave}
        onClear={onClear}
      />,
    );
    expect(screen.getByTestId('goal-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('goal-button'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(onGoalInputChange).toHaveBeenCalledWith('');

    rerender(
      <SessionGoalPopover
        open
        onOpenChange={onOpenChange}
        sessionGoal="ship it"
        goalInputText="ship it"
        onGoalInputChange={onGoalInputChange}
        hasSession
        onSave={onSave}
        onClear={onClear}
      />,
    );
    expect(screen.getByText('goal.title')).toBeTruthy();
    fireEvent.click(screen.getByText('goal.save'));
    expect(onSave).toHaveBeenCalledWith('ship it');
  });

  it('clear is no-op without session', () => {
    render(
      <SessionGoalPopover
        open
        onOpenChange={onOpenChange}
        sessionGoal="x"
        goalInputText="x"
        onGoalInputChange={onGoalInputChange}
        hasSession={false}
        onSave={onSave}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText('goal.clear'));
    expect(onClear).not.toHaveBeenCalled();
  });
});
