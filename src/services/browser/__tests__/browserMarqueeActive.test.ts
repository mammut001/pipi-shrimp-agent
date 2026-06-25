import { beforeEach, describe, expect, it } from '@jest/globals';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useUIStore } from '@/store/uiStore';
import {
  isBrowserInputBlocked,
  isBrowserMarqueeActive,
} from '../browserMarqueeActive';

describe('browserMarqueeActive', () => {
  beforeEach(() => {
    useBrowserAgentStore.setState({ status: 'idle' } as Partial<ReturnType<typeof useBrowserAgentStore.getState>>);
    useUIStore.setState({
      taskProgress: [],
      permissionQueue: [],
    });
  });

  it('blocks input while the browser agent is running', () => {
    useBrowserAgentStore.setState({ status: 'running' } as Partial<ReturnType<typeof useBrowserAgentStore.getState>>);

    expect(isBrowserInputBlocked()).toBe(true);
    expect(isBrowserMarqueeActive()).toBe(true);
  });

  it('does not block input while waiting for the user to log in', () => {
    useBrowserAgentStore.setState({ status: 'waiting_user_resume' } as Partial<ReturnType<typeof useBrowserAgentStore.getState>>);

    expect(isBrowserInputBlocked()).toBe(false);
    expect(isBrowserMarqueeActive()).toBe(false);
  });

  it('blocks input while chat browser tools are executing', () => {
    useUIStore.setState({
      taskProgress: [{
        id: 'tool-1',
        label: 'browser_navigate',
        status: 'running',
      }],
    });

    expect(isBrowserInputBlocked()).toBe(true);
    expect(isBrowserMarqueeActive()).toBe(true);
  });

  it('shows marquee during validation but not before execution starts', () => {
    useUIStore.setState({
      taskProgress: [{
        id: 'tool-2',
        label: 'browser_extract_content',
        status: 'validating',
      }],
    });

    expect(isBrowserInputBlocked()).toBe(false);
    expect(isBrowserMarqueeActive()).toBe(true);
  });

  it('does not block while browser tools await user confirmation', () => {
    useUIStore.setState({
      taskProgress: [{
        id: 'tool-3',
        label: 'browser_click',
        status: 'awaiting_confirmation',
      }],
      permissionQueue: [{
        id: 'perm-1',
        toolName: 'browser_click',
        toolInput: '{}',
      }],
    });

    expect(isBrowserInputBlocked()).toBe(false);
    expect(isBrowserMarqueeActive()).toBe(false);
  });
});