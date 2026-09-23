/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DebugCard,
  StatCell,
  formatDuration,
  formatRelativeTime,
  formatTimeout,
  viewportHighlightStyle,
} from '@/components/browserDebugPanelUi';
import type { BrowserElementBounds, BrowserPageViewport } from '@/types/browserPageState';

describe('browserDebugPanelUi formatters', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('formatRelativeTime covers never / just-now / seconds / minutes / clock', () => {
    expect(formatRelativeTime(null)).toBe('Never');
    expect(formatRelativeTime(Date.now() - 500)).toBe('Just now');
    expect(formatRelativeTime(Date.now() - 15_000)).toBe('15s ago');
    expect(formatRelativeTime(Date.now() - 120_000)).toBe('2m ago');
    expect(formatRelativeTime(Date.now() - 7_200_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('formatDuration covers pending / ms / seconds', () => {
    expect(formatDuration(undefined)).toBe('pending');
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(2_500)).toBe('2.50s');
  });

  it('formatTimeout covers n/a / ms / seconds', () => {
    expect(formatTimeout(null)).toBe('n/a');
    expect(formatTimeout(undefined)).toBe('n/a');
    expect(formatTimeout(500)).toBe('500ms');
    expect(formatTimeout(3_000)).toBe('3s');
  });

  it('viewportHighlightStyle clips bounds into percent styles or returns null', () => {
    const viewport: BrowserPageViewport = {
      width: 100,
      height: 100,
      page_x: 0,
      page_y: 0,
    };
    const bounds: BrowserElementBounds = {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    };

    expect(viewportHighlightStyle(null, viewport)).toBeNull();
    expect(viewportHighlightStyle(bounds, { ...viewport, width: 0 })).toBeNull();
    expect(viewportHighlightStyle(bounds, viewport)).toEqual({
      left: '10%',
      top: '20%',
      width: '30%',
      height: '40%',
    });

    // Fully outside viewport → clipped to empty → null
    expect(
      viewportHighlightStyle(
        { x: 200, y: 200, width: 10, height: 10 },
        viewport,
      ),
    ).toBeNull();
  });
});

describe('browserDebugPanelUi presentational', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders DebugCard title and children', () => {
    act(() => {
      root.render(
        createElement(DebugCard, { title: 'Session' }, createElement('span', null, 'body')),
      );
    });
    expect(container.textContent).toContain('Session');
    expect(container.textContent).toContain('body');
  });

  it('renders StatCell label and value', () => {
    act(() => {
      root.render(createElement(StatCell, { label: 'Mode', value: 'cdp' }));
    });
    expect(container.textContent).toContain('Mode');
    expect(container.textContent).toContain('cdp');
  });
});
