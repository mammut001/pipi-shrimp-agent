/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BrowserDebugPanelHeader,
  CdpRawStateDebugCard,
  RecentActionsDebugCard,
  RecentCommandsDebugCard,
  SessionDebugCard,
} from '@/components/browserDebugPanelSections';
import type {
  BrowserActionTrace,
  BrowserCommandTrace,
  BrowserDebugSessionInfo,
} from '@/types/browserObservability';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
}));

const baseSession: BrowserDebugSessionInfo = {
  connected: true,
  mode: 'attach',
  wsStatus: 'open',
  currentTarget: 'page-1',
  lastHealthPingAt: Date.now() - 5_000,
  sessionId: 'sess-1',
  targetId: 'tgt-1',
  currentUrl: 'https://example.com',
  websocketUrl: 'ws://localhost:9222',
  lastError: null,
  source: 'frontend',
};

describe('browserDebugPanelSections', () => {
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

  it('BrowserDebugPanelHeader shows Live badge and fires refresh', () => {
    const onRefresh = jest.fn();
    act(() => {
      root.render(createElement(BrowserDebugPanelHeader, { isUsingMockData: false, onRefresh }));
    });
    expect(container.textContent).toContain('Live');
    expect(container.textContent).toContain('Browser Debug');
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('BrowserDebugPanelHeader shows Mock badge when using mock data', () => {
    act(() => {
      root.render(createElement(BrowserDebugPanelHeader, { isUsingMockData: true, onRefresh: () => undefined }));
    });
    expect(container.textContent).toContain('Mock');
    expect(container.textContent).toContain('Mock-backed');
  });

  it('SessionDebugCard renders session fields and last error', () => {
    act(() => {
      root.render(
        createElement(SessionDebugCard, {
          session: { ...baseSession, lastError: 'boom' },
        }),
      );
    });
    expect(container.textContent).toContain('attach');
    expect(container.textContent).toContain('https://example.com');
    expect(container.textContent).toContain('Last Error');
    expect(container.textContent).toContain('boom');
  });

  it('CdpRawStateDebugCard renders n/a when connectionState is null', () => {
    act(() => {
      root.render(createElement(CdpRawStateDebugCard, { connectionState: null, lastSyncedAt: null }));
    });
    expect(container.textContent).toContain('CDP Raw State');
    expect(container.textContent).toContain('n/a');
    expect(container.textContent).toContain('Never');
  });

  it('RecentCommandsDebugCard empty and populated paths', () => {
    act(() => {
      root.render(createElement(RecentCommandsDebugCard, { visibleCommands: [] }));
    });
    expect(container.textContent).toContain('No command traces yet.');

    const command: BrowserCommandTrace = {
      id: 'cmd-1',
      method: 'Page.navigate',
      summary: 'go',
      status: 'success',
      durationMs: 120,
      source: 'frontend',
      startedAt: Date.now(),
    };
    act(() => {
      root.render(createElement(RecentCommandsDebugCard, { visibleCommands: [command] }));
    });
    expect(container.textContent).toContain('Page.navigate');
    expect(container.textContent).toContain('success');
    expect(container.textContent).toContain('120ms');
  });

  it('RecentActionsDebugCard empty and populated paths', () => {
    act(() => {
      root.render(createElement(RecentActionsDebugCard, { visibleActions: [] }));
    });
    expect(container.textContent).toContain('No action records yet.');

    const action: BrowserActionTrace = {
      id: 'act-1',
      name: 'click',
      detail: 'button#go',
      status: 'completed',
      createdAt: Date.now() - 2_000,
      source: 'frontend',
    };
    act(() => {
      root.render(createElement(RecentActionsDebugCard, { visibleActions: [action] }));
    });
    expect(container.textContent).toContain('click');
    expect(container.textContent).toContain('completed');
    expect(container.textContent).toContain('button#go');
  });
});
