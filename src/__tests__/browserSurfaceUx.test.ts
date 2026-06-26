import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseBrowserSurfaceKind = jest.fn();
const mockUseBrowserMarqueeActive = jest.fn(() => false);
const mockUseBrowserInputBlocked = jest.fn(() => false);
const mockUseBrowserAgentStore = jest.fn();
const mockUseCdpStore = jest.fn();
const mockUseUIStore = jest.fn();
const mockUseBrowserObservabilityStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'zh',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
}));

jest.mock('@/hooks/useBrowserSurfaceKind', () => ({
  useBrowserSurfaceKind: () => mockUseBrowserSurfaceKind(),
}));

jest.mock('@/hooks/useBrowserMarqueeActive', () => ({
  useBrowserMarqueeActive: () => mockUseBrowserMarqueeActive(),
  useBrowserInputBlocked: () => mockUseBrowserInputBlocked(),
}));

jest.mock('@/store', () => {
  const browserAgentHook = (...args: unknown[]) => mockUseBrowserAgentStore(...args);
  (browserAgentHook as typeof browserAgentHook & { getState: jest.Mock }).getState = jest.fn(() => ({
    setupEventListeners: jest.fn(async () => () => {}),
    status: 'idle',
  }));

  return {
    useBrowserAgentStore: browserAgentHook,
    useUIStore: (...args: unknown[]) => mockUseUIStore(...args),
    useCdpStore: (...args: unknown[]) => mockUseCdpStore(...args),
  };
});

jest.mock('@/store/browserObservabilityStore', () => ({
  useBrowserObservabilityStore: (...args: unknown[]) => mockUseBrowserObservabilityStore(...args),
}));

jest.mock('@/utils/browserCommands', () => ({
  showBrowserWindow: jest.fn(),
}));

jest.mock('@/utils/browserTaskPlanner', () => ({
  createTaskEnvelope: jest.fn(),
}));

jest.mock('@/components/BrowserDebugPanel', () => ({
  BrowserDebugPanel: () => createElement('div', null, 'MockBrowserDebugPanel'),
}));

jest.mock('@/components/BrowserActionApprovalPrompt', () => ({
  BrowserActionApprovalPrompt: () => null,
}));

jest.mock('@/components/BrowserSurfaceViewport', () => ({
  BrowserSurfaceViewport: ({ emptyState }: { emptyState?: React.ReactNode }) =>
    createElement('div', { 'data-testid': 'embedded-viewport' }, emptyState ?? 'embedded-viewport'),
}));

jest.mock('@/components/CdpBrowserSurfacePanel', () => ({
  CdpBrowserSurfacePanel: ({ variant }: { variant?: string }) =>
    createElement('div', { 'data-testid': 'cdp-panel', 'data-variant': variant }, 'browser.surface.externalChromeTitle'),
}));

const createBrowserState = (overrides: Record<string, unknown> = {}) => ({
  currentUrl: 'https://example.com',
  status: 'idle',
  authState: 'authenticated',
  logs: [{ timestamp: '12:00:00', level: 'info', message: 'Ready' }],
  pendingTask: null,
  isWindowOpen: true,
  presentationMode: 'mini',
  executeTaskEnvelope: jest.fn(),
  stopTask: jest.fn(),
  clearLogs: jest.fn(),
  addLog: jest.fn(),
  inspectCurrentPage: jest.fn(),
  confirmLoginAndResume: jest.fn(),
  forceResumeWithoutAuth: jest.fn(),
  expandBrowser: jest.fn(),
  collapseBrowser: jest.fn(),
  setupEventListeners: jest.fn(async () => () => {}),
  ...overrides,
});

describe('browser surface UX', () => {
  let BrowserSurfaceHost: typeof import('@/components/BrowserSurfaceHost').BrowserSurfaceHost;
  let BrowserMiniPreview: typeof import('@/components/BrowserMiniPreview').BrowserMiniPreview;

  beforeAll(async () => {
    ({ BrowserSurfaceHost } = await import('@/components/BrowserSurfaceHost'));
    ({ BrowserMiniPreview } = await import('@/components/BrowserMiniPreview'));
  });

  beforeEach(() => {
    mockUseBrowserAgentStore.mockReturnValue(createBrowserState());
    mockUseUIStore.mockReturnValue({
      openBrowserExternal: jest.fn(),
      closeBrowserDock: jest.fn(),
      focusChatPane: jest.fn(),
    });
    mockUseCdpStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        status: 'disconnected',
        connectionState: null,
        runtime: {
          currentUrl: null,
          healthStatus: null,
          launchMode: null,
          taskStatus: 'idle',
          activeTaskLabel: null,
          lastError: null,
          lastResult: null,
          lastUpdatedAt: null,
          lastFailedAction: null,
        },
        syncConnectionState: jest.fn(),
        refreshCdpRuntimeState: jest.fn(),
      }),
    );
    mockUseBrowserObservabilityStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({ debugPanelEnabled: false, latestPageState: null }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('BrowserSurfaceHost_renders_embedded_viewport_for_embedded_surface', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('embedded_webview');

    const markup = renderToStaticMarkup(createElement(BrowserSurfaceHost));

    expect(markup).toContain('data-testid="embedded-viewport"');
    expect(markup).toContain('browser.noBrowserSurface');
    expect(markup).not.toContain('data-testid="cdp-panel"');
  });

  it('BrowserSurfaceHost_renders_cdp_panel_for_cdp_connected', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');

    const markup = renderToStaticMarkup(createElement(BrowserSurfaceHost));

    expect(markup).toContain('data-testid="cdp-panel"');
    expect(markup).toContain('browser.surface.externalChromeTitle');
    expect(markup).not.toContain('browser.noBrowserSurface');
    expect(markup).not.toContain('No browser surface yet');
  });

  it('BrowserMiniPreview_cdp_mode_does_not_show_no_surface', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');
    mockUseBrowserAgentStore.mockReturnValue(createBrowserState({
      currentUrl: '',
      status: 'uninitialized',
      isWindowOpen: false,
    }));
    mockUseCdpStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        status: 'connected',
        connectionState: {
          current_url: 'https://github.com/example/repo',
          launch_mode: 'attach',
          health_status: 'healthy',
        },
        runtime: {
          currentUrl: 'https://github.com/example/repo',
          healthStatus: 'healthy',
          launchMode: 'attach',
          taskStatus: 'completed',
          activeTaskLabel: null,
          lastError: null,
          lastResult: '42 stars',
          lastUpdatedAt: Date.now(),
          lastFailedAction: null,
        },
        syncConnectionState: jest.fn(),
        refreshCdpRuntimeState: jest.fn(),
      }),
    );

    const markup = renderToStaticMarkup(createElement(BrowserMiniPreview));

    expect(markup).toContain('data-testid="cdp-browser-controller"');
    expect(markup).not.toContain('browser.noBrowserSurface');
    expect(markup).not.toContain('browser.unknownSite');
    expect(markup).not.toContain('browser.status.uninitialized');
    expect(markup).not.toContain('browser.guidance.idleTitle');
    expect(markup).toContain('browser.surface.externalChromeControllerDescription');
    expect(markup).toContain('browser.surface.currentChromePage');
    expect(markup).toContain('browser.surface.expandConsole');
    expect(markup).toContain('browser.surface.openExternalChrome');
  });

  it('BrowserMiniPreview_embedded_mode_still_shows_viewport', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('embedded_webview');

    const markup = renderToStaticMarkup(createElement(BrowserMiniPreview));

    expect(markup).toContain('data-testid="embedded-viewport"');
    expect(markup).toContain('browser.expandToSplit');
    expect(markup).toContain('browser.openNewWindow');
  });

  it('expand_button_label_is_context_aware', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');
    const cdpMarkup = renderToStaticMarkup(createElement(BrowserMiniPreview));
    expect(cdpMarkup).toContain('browser.surface.expandConsole');
    expect(cdpMarkup).not.toContain('browser.expandToSplit');

    mockUseBrowserSurfaceKind.mockReturnValue('embedded_webview');
    const embeddedMarkup = renderToStaticMarkup(createElement(BrowserMiniPreview));
    expect(embeddedMarkup).toContain('browser.expandToSplit');
  });

  it('open_button_label_is_context_aware', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');
    expect(renderToStaticMarkup(createElement(BrowserMiniPreview))).toContain('browser.surface.openExternalChrome');

    mockUseBrowserSurfaceKind.mockReturnValue('embedded_webview');
    expect(renderToStaticMarkup(createElement(BrowserMiniPreview))).toContain('browser.openNewWindow');
  });

  it('BrowserMiniPreview_shows_cdp_state_when_cdp_runtime_active', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');
    mockUseBrowserAgentStore.mockReturnValue(createBrowserState({
      currentUrl: '',
      status: 'uninitialized',
      isWindowOpen: false,
    }));
    mockUseCdpStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        status: 'disconnected',
        connectionState: null,
        runtime: {
          currentUrl: 'https://github.com/example/repo',
          healthStatus: 'healthy',
          launchMode: 'attach',
          taskStatus: 'completed',
          activeTaskLabel: 'Check stars',
          lastError: null,
          lastResult: '42 stars',
          lastUpdatedAt: Date.now(),
          lastFailedAction: null,
        },
        syncConnectionState: jest.fn(),
        refreshCdpRuntimeState: jest.fn(),
      }),
    );

    const markup = renderToStaticMarkup(createElement(BrowserMiniPreview));

    expect(markup).not.toContain('browser.guidance.openWindowTitle');
    expect(markup).not.toContain('browser.status.uninitialized');
    expect(markup).toContain('browser.surface.externalChromeTitle');
    expect(markup).toContain('https://github.com/example/repo');
  });

  it('BrowserSurfaceHost_shows_cdp_panel_when_cdp_runtime_active', () => {
    mockUseBrowserSurfaceKind.mockReturnValue('cdp_external');

    const markup = renderToStaticMarkup(createElement(BrowserSurfaceHost));

    expect(markup).toContain('data-testid="cdp-panel"');
    expect(markup).not.toContain('browser.noBrowserSurface');
    expect(markup).not.toContain('browser.surface.noEmbeddedSurface');
  });
});
