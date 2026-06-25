import { describe, expect, it } from '@jest/globals';
import {
  BROWSER_NOT_CONNECTED_USER_MESSAGE,
  isBrowserNotConnectedToolResult,
} from '../browserConnectionGate';

describe('browserConnectionGate', () => {
  it('detects the Rust browser-not-connected message', () => {
    expect(isBrowserNotConnectedToolResult(
      'ERROR: 浏览器未连接。请先在界面中点击「连接 Chrome」，然后再重试此操作。',
    )).toBe(true);
  });

  it('detects English not-connected markers', () => {
    expect(isBrowserNotConnectedToolResult('Error: browser not connected')).toBe(true);
  });

  it('ignores unrelated tool errors', () => {
    expect(isBrowserNotConnectedToolResult('Error: permission denied')).toBe(false);
  });

  it('exports a user-facing reconnect message', () => {
    expect(BROWSER_NOT_CONNECTED_USER_MESSAGE).toContain('Chrome');
  });
});
