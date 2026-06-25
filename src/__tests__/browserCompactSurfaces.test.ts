import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseBrowserAgentStore = jest.fn();
const mockBrowserAgentGetState = jest.fn();
const mockUseUIStore = jest.fn();
const mockUseCdpStore = jest.fn();
const mockUseBrowserObservabilityStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'zh',
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
}));

jest.mock('@/store', () => {
  const browserAgentHook = (...args: unknown[]) => mockUseBrowserAgentStore(...args);
  (browserAgentHook as typeof browserAgentHook & { getState: typeof mockBrowserAgentGetState }).getState = (...args: unknown[]) => mockBrowserAgentGetState(...args);

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
  createTaskEnvelope: jest.fn((url: string, userIntent: string, executionPrompt: string) => ({
    id: 'envelope-1',
    connectorType: 'browser_web',
    siteProfileId: 'generic_authenticated_site',
    targetUrl: url,
    userIntent,
    executionPrompt,
    requiresLogin: false,
    authPolicy: 'none',
    allowedControlMode: 'agent_controlled',
  })),
}));

jest.mock('@/components/BrowserDebugPanel', () => ({
  BrowserDebugPanel: () => createElement('div', null, 'MockBrowserDebugPanel'),
}));

jest.mock('@/components/BrowserSurfaceViewport', () => ({
  BrowserSurfaceViewport: ({ emptyState }: { emptyState?: React.ReactNode }) =>
    createElement('div', null, emptyState ?? 'MockBrowserSurfaceViewport'),
}));

let BrowserMiniPreview: typeof import('@/components/BrowserMiniPreview').BrowserMiniPreview;
let BrowserCompactSummary: typeof import('@/components/BrowserCompactSummary').BrowserCompactSummary;

const createBrowserState = (overrides: Record<string, unknown> = {}) => ({
  currentUrl: 'https://example.com/dashboard',
  status: 'idle',
  authState: 'authenticated',
  logs: [{ timestamp: '12:00:00', level: 'info', message: 'Ready to help on this page.' }],
  pendingTask: {
    id: 'task-1',
    connectorType: 'browser_web',
    siteProfileId: 'generic_authenticated_site',
    targetUrl: 'https://example.com/dashboard',
    userIntent: 'Summarize this page',
    executionPrompt: 'Summarize this page',
    requiresLogin: false,
    authPolicy: 'none',
    allowedControlMode: 'agent_controlled',
  },
  isWindowOpen: true,
  presentationMode: 'mini',
  executeTaskEnvelope: jest.fn(() => Promise.resolve()),
  stopTask: jest.fn(),
  clearLogs: jest.fn(),
  addLog: jest.fn(),
  inspectCurrentPage: jest.fn(() => Promise.resolve()),
  confirmLoginAndResume: jest.fn(() => Promise.resolve()),
  forceResumeWithoutAuth: jest.fn(() => Promise.resolve()),
  expandBrowser: jest.fn(),
  collapseBrowser: jest.fn(),
  setupEventListeners: jest.fn(async () => () => {}),
  ...overrides,
});

describe('compact browser surfaces', () => {
  beforeAll(async () => {
    ({ BrowserMiniPreview } = await import('@/components/BrowserMiniPreview'));
    ({ BrowserCompactSummary } = await import('@/components/BrowserCompactSummary'));
  });

  beforeEach(() => {
    const state = createBrowserState();
    mockUseBrowserAgentStore.mockReturnValue(state);
    mockBrowserAgentGetState.mockReturnValue({
      setupEventListeners: jest.fn(async () => () => {}),
      status: state.status,
    });
    mockUseUIStore.mockReturnValue({
      openBrowserExternal: jest.fn(),
      closeBrowserDock: jest.fn(),
      focusChatPane: jest.fn(),
    });
    mockUseCdpStore.mockImplementation((selector: (state: { status: string; connectionState: null }) => unknown) =>
      selector({ status: 'disconnected', connectionState: null })
    );
    mockUseBrowserObservabilityStore.mockImplementation((selector: (state: { debugPanelEnabled: boolean }) => unknown) =>
      selector({ debugPanelEnabled: true })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders BrowserMiniPreview in normal mode by default', () => {
    const markup = renderToStaticMarkup(createElement(BrowserMiniPreview));

    expect(markup).toContain('browser.showAdvancedInfo');
    expect(markup).toContain('browser.statusSummary');
    expect(markup).toContain('browser.currentTask');
    expect(markup).toContain('browser.recentActivity');
    expect(markup).not.toContain('browser.executionLog');
    expect(markup).not.toContain('browser.debug');
    expect(markup).not.toContain('browser.loggedIn');
    expect(markup).not.toContain('MockBrowserDebugPanel');
  });

  it('shows next-step action wording in BrowserMiniPreview when waiting for login', () => {
    mockUseBrowserAgentStore.mockReturnValue(
      createBrowserState({
        status: 'waiting_user_resume',
        authState: 'auth_required',
      })
    );

    const markup = renderToStaticMarkup(createElement(BrowserMiniPreview));

    expect(markup).toContain('browser.executeAfterLogin');
    expect(markup).toContain('browser.iHaveLoggedIn');
    expect(markup).toContain('browser.continueCheck');
  });

  it('renders BrowserCompactSummary in normal mode by default', () => {
    const markup = renderToStaticMarkup(createElement(BrowserCompactSummary));

    expect(markup).toContain('browser.showAdvancedInfo');
    expect(markup).toContain('browser.statusSummary');
    expect(markup).toContain('browser.currentTask');
    expect(markup).toContain('browser.recentActivity');
    expect(markup).not.toContain('browser.executionLog');
    expect(markup).not.toContain('browser.authState');
    expect(markup).not.toContain('browser.loggedIn');
  });
});