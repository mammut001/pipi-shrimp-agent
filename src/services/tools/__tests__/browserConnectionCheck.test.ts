import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const requestChromeConnection = jest.fn<() => Promise<boolean>>();

jest.mock('@/store/cdpStore', () => ({
  useCdpStore: {
    getState: () => ({
      status: 'disconnected',
      requestChromeConnection,
    }),
  },
}));

import { browserConnectionCheck } from '../preToolUseHooks';

describe('browserConnectionCheck', () => {
  beforeEach(() => {
    requestChromeConnection.mockReset();
  });

  it('passes through non-browser tools', async () => {
    await expect(browserConnectionCheck({
      toolName: 'read_file',
      toolArgs: '{}',
      sessionId: 's1',
      permissionMode: 'auto-edits',
    })).resolves.toEqual({ approved: true });
    expect(requestChromeConnection).not.toHaveBeenCalled();
  });

  it('opens the connector modal for browser tools when disconnected', async () => {
    requestChromeConnection.mockResolvedValue(true);

    await expect(browserConnectionCheck({
      toolName: 'browser_navigate',
      toolArgs: '{"url":"https://example.com"}',
      sessionId: 's1',
      permissionMode: 'auto-edits',
    })).resolves.toEqual({ approved: true });

    expect(requestChromeConnection).toHaveBeenCalledTimes(1);
  });

  it('blocks browser tools when the user dismisses the modal', async () => {
    requestChromeConnection.mockResolvedValue(false);

    await expect(browserConnectionCheck({
      toolName: 'browser_get_page',
      toolArgs: '{}',
      sessionId: 's1',
      permissionMode: 'auto-edits',
    })).resolves.toMatchObject({
      approved: false,
      blockedBy: 'browser-connection',
    });
  });
});
