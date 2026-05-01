import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseBrowserAgentStore = jest.fn();
const mockFocusChatPane = jest.fn();
const mockExpandBrowserToSplit = jest.fn();
const mockOpenBrowserExternal = jest.fn();
const mockCloseBrowserDock = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../store/browserAgentStore', () => ({
  useBrowserAgentStore: (...args: unknown[]) => mockUseBrowserAgentStore(...args),
}));

jest.mock('../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      focusChatPane: mockFocusChatPane,
      browserDockMode: 'split',
      expandBrowserToSplit: mockExpandBrowserToSplit,
      openBrowserExternal: mockOpenBrowserExternal,
      closeBrowserDock: mockCloseBrowserDock,
    }),
  },
}));

jest.mock('../utils/browserCommands', () => ({
  goBack: jest.fn(),
}));

let BrowserPanel: typeof import('@/components/BrowserPanel').BrowserPanel;

const createStoreState = (overrides: Record<string, unknown> = {}) => ({
  status: 'idle',
  isWindowOpen: true,
  logs: [],
  currentUrl: 'https://example.com',
  error: null,
  mode: 'agent_controlled',
  authState: 'authenticated',
  blockReason: null,
  inspection: {
    url: 'https://example.com',
    title: 'Example',
    authState: 'authenticated',
    matchedSignals: [],
    safeForAgent: true,
    matchedProfileId: 'generic_authenticated_site',
  },
  lastCompletedTaskId: null,
  openWindow: jest.fn(),
  closeWindow: jest.fn(),
  executeTask: jest.fn(() => Promise.resolve()),
  stopTask: jest.fn(),
  clearLogs: jest.fn(),
  inspectCurrentPage: jest.fn(() => Promise.resolve()),
  confirmLoginAndResume: jest.fn(() => Promise.resolve()),
  forceResumeWithoutAuth: jest.fn(() => Promise.resolve()),
  switchToManualMode: jest.fn(),
  setupEventListeners: jest.fn(async () => () => {}),
  resetToReady: jest.fn(),
  ...overrides,
});

describe('BrowserPanel', () => {
  beforeAll(async () => {
    ({ BrowserPanel } = await import('@/components/BrowserPanel'));
  });

  beforeEach(() => {
    mockUseBrowserAgentStore.mockReturnValue(createStoreState());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders in normal mode by default and hides advanced debugging sections', () => {
    const markup = renderToStaticMarkup(createElement(BrowserPanel));

    expect(markup).toContain('browser.showAdvancedInfo');
    expect(markup).toContain('browser.statusSummary');
    expect(markup).toContain('browser.enterTaskInstruction');
    expect(markup).not.toContain('browser.executionLog');
    expect(markup).not.toContain('browser.quickTasks');
    expect(markup).not.toContain('Google News');
    expect(markup).not.toContain('browser.manualControl');
  });

  it('changes the main action wording when waiting for the user to resume', () => {
    mockUseBrowserAgentStore.mockReturnValue(
      createStoreState({
        status: 'waiting_user_resume',
        authState: 'auth_required',
        blockReason: 'login_required',
        inspection: {
          url: 'https://example.com/login',
          title: 'Login',
          authState: 'auth_required',
          matchedSignals: ['login_form'],
          safeForAgent: false,
          matchedProfileId: 'example',
          blockReason: 'login_required',
        },
      })
    );

    const markup = renderToStaticMarkup(createElement(BrowserPanel));

    expect(markup).toContain('browser.executeAfterLogin');
    expect(markup).toContain('browser.iHaveLoggedIn');
    expect(markup).toContain('browser.continueCheck');
    expect(markup).not.toContain('browser.executionLog');
  });
});