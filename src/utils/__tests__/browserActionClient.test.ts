import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const invokeMock = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { executeBrowserScript } from '../browserActionClient';

describe('browserActionClient cdp_execute_script policy args (R3-06)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('ok');
  });

  it('passes headless_agent source by default', async () => {
    await executeBrowserScript('(function(){})()');

    expect(invokeMock).toHaveBeenCalledWith('cdp_execute_script', {
      script: '(function(){})()',
      source: 'headless_agent',
      sessionId: null,
      approvalToken: null,
      executionMode: null,
      toolCallId: null,
    });
  });

  it('forwards explicit policy metadata for assistant-originated scripts', async () => {
    await executeBrowserScript('window.alert(1)', {
      source: 'assistant_tool_call',
      sessionId: 'chat-session-1',
      approvalToken: 'approval-token',
      executionMode: 'agent',
      toolCallId: 'tool-call-1',
    });

    expect(invokeMock).toHaveBeenCalledWith('cdp_execute_script', {
      script: 'window.alert(1)',
      source: 'assistant_tool_call',
      sessionId: 'chat-session-1',
      approvalToken: 'approval-token',
      executionMode: 'agent',
      toolCallId: 'tool-call-1',
    });
  });
});