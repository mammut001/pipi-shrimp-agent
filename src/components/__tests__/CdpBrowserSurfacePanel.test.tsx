/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mockBrowserNavigate = jest.fn();
const mockShowBrowserWindow = jest.fn();
const mockRefreshCdpRuntimeState = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (code: string) => code,
}));

jest.mock('@/utils/browserCommands', () => ({
  browserNavigate: (...args: unknown[]) => mockBrowserNavigate(...args),
  showBrowserWindow: (...args: unknown[]) => mockShowBrowserWindow(...args),
}));

import { CdpBrowserSurfacePanel } from '../CdpBrowserSurfacePanel';
import { useBrowserAgentStore, useCdpStore } from '@/store';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { INITIAL_CDP_RUNTIME } from '@/store/cdpRuntime';

describe('CdpBrowserSurfacePanel URL bar and controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBrowserNavigate.mockResolvedValue('Navigated');
    mockRefreshCdpRuntimeState.mockResolvedValue(INITIAL_CDP_RUNTIME);

    useCdpStore.setState({
      status: 'connected',
      connectionState: {
        connected: true,
        endpoint: 'http://127.0.0.1:9222',
        attached_target_id: 'target-1',
        session_id: 'session-1',
        current_url: 'https://example.com',
        title: 'Example Domain',
        health_status: 'ok',
        launch_mode: 'manual',
        last_error: null,
      },
      runtime: {
        ...INITIAL_CDP_RUNTIME,
        currentUrl: 'https://example.com',
      },
      refreshCdpRuntimeState: mockRefreshCdpRuntimeState as never,
    });

    useBrowserAgentStore.setState({
      status: 'idle',
      logs: [],
      pendingTask: null,
      currentUrl: '',
    });

    useBrowserObservabilityStore.setState({
      latestPageState: null,
      activeFailureSnapshot: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders editable URL bar with initial displayUrl when connected', () => {
    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    const button = screen.getByTestId('cdp-surface-navigate-button') as HTMLButtonElement;

    expect(input).toBeInTheDocument();
    expect(input.value).toBe('https://example.com');
    expect(button).toBeInTheDocument();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('browser.surface.navigate');
  });

  it('renders URL bar in compact variant as well', () => {
    render(<CdpBrowserSurfacePanel variant="compact" />);

    expect(screen.getByTestId('cdp-surface-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('cdp-surface-navigate-button')).toBeInTheDocument();
  });

  it('disables navigate button when disconnected', () => {
    useCdpStore.setState({
      status: 'disconnected',
      connectionState: null,
      runtime: INITIAL_CDP_RUNTIME,
    });

    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    const button = screen.getByTestId('cdp-surface-navigate-button') as HTMLButtonElement;

    expect(input.value).toBe('');
    expect(button.disabled).toBe(true);

    // Typing a URL still keeps button disabled while disconnected
    fireEvent.change(input, { target: { value: 'https://github.com' } });
    expect(button.disabled).toBe(true);

    // Submitting form or pressing Enter does not trigger navigate
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockBrowserNavigate).not.toHaveBeenCalled();
  });

  it('disables navigate button when URL input is empty', () => {
    useCdpStore.setState({
      status: 'connected',
      connectionState: {
        connected: true,
        endpoint: 'http://127.0.0.1:9222',
        attached_target_id: 'target-1',
        session_id: 'session-1',
        current_url: '',
        title: '',
        health_status: 'ok',
        launch_mode: 'manual',
        last_error: null,
      },
      runtime: INITIAL_CDP_RUNTIME,
    });

    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    const button = screen.getByTestId('cdp-surface-navigate-button') as HTMLButtonElement;

    expect(input.value).toBe('');
    expect(button.disabled).toBe(true);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockBrowserNavigate).not.toHaveBeenCalled();
  });

  it('calls browserNavigate and refreshCdpRuntimeState on navigate submit', async () => {
    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    const button = screen.getByTestId('cdp-surface-navigate-button') as HTMLButtonElement;

    fireEvent.change(input, { target: { value: 'https://example.org/test' } });
    expect(button.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockBrowserNavigate).toHaveBeenCalledWith('https://example.org/test');
    expect(mockRefreshCdpRuntimeState).toHaveBeenCalledTimes(1);
  });

  it('prepends https:// if protocol is missing and navigates on Enter key', async () => {
    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'news.ycombinator.com' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(mockBrowserNavigate).toHaveBeenCalledWith('https://news.ycombinator.com');
    expect(mockRefreshCdpRuntimeState).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('https://news.ycombinator.com');
  });

  it('displays inline error on navigation failure and clears error on input change', async () => {
    mockBrowserNavigate.mockRejectedValueOnce(new Error('Connection refused'));

    render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    const button = screen.getByTestId('cdp-surface-navigate-button') as HTMLButtonElement;

    fireEvent.change(input, { target: { value: 'https://bad-host.local' } });

    await act(async () => {
      fireEvent.click(button);
    });

    const errorEl = await screen.findByTestId('cdp-surface-nav-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Connection refused');

    // Changing input clears the error
    fireEvent.change(input, { target: { value: 'https://good-host.local' } });
    expect(screen.queryByTestId('cdp-surface-nav-error')).toBeNull();
  });

  it('syncs displayUrl when external page changes and field is not dirty', async () => {
    const { rerender } = render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    expect(input.value).toBe('https://example.com');

    // Simulate external page navigation updated in store
    act(() => {
      useCdpStore.setState({
        connectionState: {
          connected: true,
          endpoint: 'http://127.0.0.1:9222',
          attached_target_id: 'target-1',
          session_id: 'session-1',
          current_url: 'https://new-external-page.com',
          title: 'New Page',
          health_status: 'ok',
          launch_mode: 'manual',
          last_error: null,
        },
        runtime: {
          ...INITIAL_CDP_RUNTIME,
          currentUrl: 'https://new-external-page.com',
        },
      });
    });

    rerender(<CdpBrowserSurfacePanel variant="expanded" />);
    await waitFor(() => {
      expect(input.value).toBe('https://new-external-page.com');
    });
  });

  it('preserves user typing when displayUrl updates while field is dirty', async () => {
    const { rerender } = render(<CdpBrowserSurfacePanel variant="expanded" />);

    const input = screen.getByTestId('cdp-surface-url-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://my-custom-url.org' } });

    act(() => {
      useCdpStore.setState({
        connectionState: {
          connected: true,
          endpoint: 'http://127.0.0.1:9222',
          attached_target_id: 'target-1',
          session_id: 'session-1',
          current_url: 'https://another-external-page.com',
          title: 'Another Page',
          health_status: 'ok',
          launch_mode: 'manual',
          last_error: null,
        },
        runtime: {
          ...INITIAL_CDP_RUNTIME,
          currentUrl: 'https://another-external-page.com',
        },
      });
    });

    rerender(<CdpBrowserSurfacePanel variant="expanded" />);
    // User's custom input is preserved
    expect(input.value).toBe('https://my-custom-url.org');
  });
});
