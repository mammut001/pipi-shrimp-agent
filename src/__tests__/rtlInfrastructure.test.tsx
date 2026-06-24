/** @jest-environment jsdom */

import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

function RtlSmoke(): JSX.Element {
  return <div data-testid="rtl-smoke">RTL ready</div>;
}

describe('@testing-library/react infrastructure (INFRA-01)', () => {
  it('renders a minimal React component', () => {
    render(<RtlSmoke />);
    expect(screen.getByTestId('rtl-smoke').textContent).toBe('RTL ready');
  });
});