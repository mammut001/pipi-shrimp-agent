import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getCurrentBrowserUrlMock = jest.fn<() => Promise<string>>();
const invokeMock = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

jest.mock('../../utils/browserPageStateClient', () => ({
  getCurrentBrowserUrl: () => getCurrentBrowserUrlMock(),
}));

describe('cdp runtime state bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    invokeMock.mockReset();
    getCurrentBrowserUrlMock.mockReset();
  });

  it('cdp_task_started_updates_browser_runtime_state', async () => {
    const { useCdpStore } = await import('../cdpStore');

    useCdpStore.getState().setCdpRuntimeTaskStarted({
      label: 'Check GitHub stars',
      targetUrl: 'https://github.com/example/repo',
    });

    const runtime = useCdpStore.getState().runtime;
    expect(runtime.taskStatus).toBe('running');
    expect(runtime.activeTaskLabel).toBe('Check GitHub stars');
    expect(runtime.currentUrl).toBe('https://github.com/example/repo');
  });

  it('cdp_task_completed_updates_runtime_state', async () => {
    const { useCdpStore } = await import('../cdpStore');

    useCdpStore.getState().setCdpRuntimeTaskStarted({
      label: 'Check GitHub stars',
      targetUrl: 'https://github.com/example/repo',
    });
    useCdpStore.getState().setCdpRuntimeTaskCompleted({
      result: '42 stars',
      currentUrl: 'https://github.com/example/repo',
    });

    const runtime = useCdpStore.getState().runtime;
    expect(runtime.taskStatus).toBe('completed');
    expect(runtime.lastResult).toBe('42 stars');
    expect(runtime.currentUrl).toBe('https://github.com/example/repo');
    expect(runtime.lastError).toBeNull();
  });

  it('cdp_task_failed_updates_runtime_state', async () => {
    const { useCdpStore } = await import('../cdpStore');

    useCdpStore.getState().setCdpRuntimeTaskStarted({
      label: 'Open page',
      targetUrl: 'https://example.com',
    });
    useCdpStore.getState().setCdpRuntimeTaskFailed({
      error: 'Request timed out',
      currentUrl: 'https://example.com/partial',
      action: 'navigate',
    });

    const runtime = useCdpStore.getState().runtime;
    expect(runtime.taskStatus).toBe('failed');
    expect(runtime.lastError).toBe('Request timed out');
    expect(runtime.lastFailedAction).toBe('navigate');
    expect(runtime.currentUrl).toBe('https://example.com/partial');
  });

  it('refreshCdpRuntimeState_merges_connection_and_current_url', async () => {
    invokeMock.mockResolvedValueOnce({
      connected: true,
      launch_mode: 'attach',
      health_status: 'healthy',
      health_failures: 0,
      health_last_transition_at_ms: 0,
      websocket_url: 'ws://localhost:9222/devtools/page/1',
      current_url: null,
      last_error: null,
      target_id: 'target-1',
      session_id: 'session-1',
      last_activity_at_ms: 0,
      idle_timeout_ms: 300000,
    });
    getCurrentBrowserUrlMock.mockResolvedValueOnce('https://chrome.example/current');

    const { useCdpStore } = await import('../cdpStore');
    const runtime = await useCdpStore.getState().refreshCdpRuntimeState();

    expect(runtime.currentUrl).toBe('https://chrome.example/current');
    expect(runtime.healthStatus).toBe('healthy');
    expect(runtime.launchMode).toBe('attach');
    expect(useCdpStore.getState().status).toBe('connected');
  });
});