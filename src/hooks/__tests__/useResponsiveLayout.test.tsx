/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from '@jest/globals';
import { useResponsiveLayout } from '../useResponsiveLayout';

const originalWidth = window.innerWidth;

function resizeViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('useResponsiveLayout', () => {
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  });

  it('updates layout at the documented 720px and 1180px boundaries', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 719 });
    const { result } = renderHook(() => useResponsiveLayout());

    expect(result.current).toMatchObject({
      tier: 'xs',
      isCompact: true,
      isSmall: true,
      forceHideRightPanel: true,
      forceCollapseSidebar: true,
      width: 719,
    });

    resizeViewport(720);
    expect(result.current).toMatchObject({
      tier: 'sm',
      isCompact: false,
      isSmall: true,
      forceHideRightPanel: true,
      forceCollapseSidebar: false,
      width: 720,
    });

    resizeViewport(1179);
    expect(result.current).toMatchObject({ tier: 'sm', width: 1179 });

    resizeViewport(1180);
    expect(result.current).toMatchObject({
      tier: 'md',
      isCompact: false,
      isSmall: false,
      forceHideRightPanel: false,
      forceCollapseSidebar: false,
      width: 1180,
    });

    // Keep a 1280px laptop viewport in the full three-column layout.
    resizeViewport(1280);
    expect(result.current).toMatchObject({ tier: 'md', forceHideRightPanel: false, width: 1280 });
  });
});
