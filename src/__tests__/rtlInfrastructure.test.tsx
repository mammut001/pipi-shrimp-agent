/** @jest-environment jsdom */

import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function RtlSmoke(): JSX.Element {
  return (
    <button type="button" data-testid="rtl-smoke">
      RTL ready
    </button>
  );
}

describe('@testing-library/react infrastructure (INFRA-01)', () => {
  it('renders a minimal React component', () => {
    render(<RtlSmoke />);
    expect(screen.getByTestId('rtl-smoke')).toBeInTheDocument();
    expect(screen.getByTestId('rtl-smoke')).toHaveTextContent('RTL ready');
  });

  it('supports user-event clicks (declared companion dep)', async () => {
    const user = userEvent.setup();
    render(<RtlSmoke />);
    await user.click(screen.getByTestId('rtl-smoke'));
    expect(screen.getByRole('button', { name: 'RTL ready' })).toBeEnabled();
  });
});
