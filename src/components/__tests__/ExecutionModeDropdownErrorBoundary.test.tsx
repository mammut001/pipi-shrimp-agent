/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExecutionModeDropdownErrorBoundary } from '../chatInput/ExecutionModeDropdownErrorBoundary';

function ThrowDuringRender(): never {
  throw new Error('dropdown failed to render');
}

describe('ExecutionModeDropdownErrorBoundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders its child while the dropdown is healthy', () => {
    render(
      <ExecutionModeDropdownErrorBoundary>
        <button type="button">Choose mode</button>
      </ExecutionModeDropdownErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Choose mode' })).toBeInTheDocument();
    expect(screen.queryByTestId('execution-mode-dropdown-fallback')).not.toBeInTheDocument();
  });

  it('shows a disabled fallback after a render error', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ExecutionModeDropdownErrorBoundary>
        <ThrowDuringRender />
      </ExecutionModeDropdownErrorBoundary>,
    );

    const fallback = screen.getByTestId('execution-mode-dropdown-fallback');
    expect(fallback).toBeDisabled();
    expect(fallback).toHaveAttribute('aria-disabled', 'true');
    expect(fallback).toHaveAttribute('title', 'Mode selector unavailable');
    expect(fallback).toHaveTextContent('Mode');
  });
});
