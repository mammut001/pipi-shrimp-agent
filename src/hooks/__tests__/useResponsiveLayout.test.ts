/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useResponsiveLayout } from '../useResponsiveLayout';

describe('useResponsiveLayout', () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('allows right panel on laptop/desktop viewports (>= 720px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });

    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.tier).toBe('sm');
    expect(result.current.forceHideRightPanel).toBe(false);
    expect(result.current.forceCollapseSidebar).toBe(false);
  });

  it('only force hides right panel on xs mobile screens (< 720px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 600,
    });

    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.tier).toBe('xs');
    expect(result.current.forceHideRightPanel).toBe(true);
    expect(result.current.forceCollapseSidebar).toBe(true);
  });
});
