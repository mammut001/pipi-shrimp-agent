/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';

import { SearchInput } from '../SearchInput';

describe('SearchInput', () => {
  it('clears the query on Escape when there is a value', () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    const { getByRole } = render(
      createElement(SearchInput, {
        value: 'hello',
        onChange,
        onClear,
      }),
    );

    fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('blurs when Escape is pressed on an empty query', () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    const { getByRole } = render(
      createElement(SearchInput, {
        value: '',
        onChange,
        onClear,
      }),
    );
    const input = getByRole('textbox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClear).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
  });
});
