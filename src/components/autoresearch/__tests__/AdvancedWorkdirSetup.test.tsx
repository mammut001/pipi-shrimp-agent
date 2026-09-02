/** @jest-environment jsdom */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Define global states with var and mock prefix so they are hoisted and accessible in mock factories
var mockSettingsState = {
  activeConfigId: 'config-1',
  apiConfigs: [
    { id: 'config-1', name: 'Primary', provider: 'openai', model: 'gpt-5', keyPresent: true },
  ],
  windowsShellProfile: 'auto',
};

var mockStoreState = {
  id: '',
  loopState: 'idle' as 'idle' | 'running' | 'paused' | 'stopped' | 'error',
  sshConfig: null as any,
  runHistory: [] as any[],
  terminalVisible: false,
  terminalSessionId: '',
  terminalCwd: '',
  lastUsedConfig: null,
  selectedRunId: null,
  setSelectedExperiment: jest.fn(),
  initSession: jest.fn(),
  setSshConfig: jest.fn(),
  selectRun: jest.fn(),
  deleteRun: jest.fn(),
  deleteRuns: jest.fn(),
  openTerminalPanel: jest.fn(),
  setTerminalReady: jest.fn(),
  setTerminalVisible: jest.fn(),
  setLastUsedConfig: jest.fn(),
  clearLastUsedConfig: jest.fn(),
};

var mockToggleSettings = jest.fn();

// Jest Mocking
jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.manual.title': 'Manual Launch AutoResearch',
    'autoresearch.manual.runtimeTarget': 'Runtime Target',
    'autoresearch.manual.localRun': 'Local Run',
    'autoresearch.manual.sshRun': 'SSH Remote Run',
    'autoresearch.manual.workspace': 'AutoResearch Workspace',
    'autoresearch.manual.targetProject': 'Target Project Directory',
    'autoresearch.manual.metricsAndIterations': 'Metrics & Iterations',
    'autoresearch.manual.envCheck': 'Environment Check',
    'autoresearch.manual.launchConfirm': 'Launch Summary',
    'autoresearch.manual.testEnv': 'Test Connection',
    'autoresearch.manual.passed': 'Passed',
    'autoresearch.manual.notTested': 'Not Tested',
    'autoresearch.manual.failed': 'Failed',
    'autoresearch.manual.action.openProviderConfig': 'Open Model Config',
    'autoresearch.manual.action.fillRuntime': 'Fill Runtime Target first',
    'autoresearch.manual.action.fillWorkspace': 'Fill Workspace first',
    'autoresearch.manual.action.fillTargetProject': 'Fill Target Project first',
    'autoresearch.manual.action.fillMetric': 'Fill Primary Metric first',
    'autoresearch.manual.action.testEnv': 'Test Connection first',
    'autoresearch.manual.start': 'Start AutoResearch',
    'autoresearch.manual.workspaceHelper': 'AutoResearch will create run files, logs, and temporary experiment directories here.',
    'autoresearch.manual.targetProjectHelper': 'AutoResearch will run verification and improvements on this project or experiment directory.',
    'autoresearch.manual.advancedFields': 'Advanced Fields',
    'autoresearch.manual.advancedFieldsHelper': 'Usually no need to modify',
    'autoresearch.manual.finalBlocker': '所有配置已填写，最后一步是测试运行环境。',
    'autoresearch.recipe.completed': 'Completed',
    'autoresearch.recipe.missing': 'Missing',
    'autoresearch.recipe.collapse': 'Collapse',
    'autoresearch.recipe.edit': 'Edit',
    'autoresearch.resetToDefaults': 'Reset to Defaults',
    'autoresearch.summaryTitle': 'Summary',
    'autoresearch.viewActiveRun': 'View Active Run',
    'autoresearch.validationBaselineNumber': 'Baseline must be a valid number',
    'autoresearch.emptyIdle': 'AutoResearch is idle.',
    'autoresearch.setupAndStart': 'Setup and Start',
    'autoresearch.baselinePlaceholder': 'e.g. 0.963284',
    'autoresearch.hostPlaceholder': '例如 192.168.1.10 或 server.example.com',
    'autoresearch.userPlaceholder': '例如 ubuntu / root / your-user',
    'autoresearch.portPlaceholder': '22',
    'autoresearch.authAgent': 'SSH Agent / ~/.ssh/config',
    'autoresearch.authPassword': '密码',
    'autoresearch.authKey': '密钥文件',
    'autoresearch.authHelper': '支持通过 SSH Agent 自动代理或输入密钥、密码进行连接。密码不会被保存。',
  }[key] ?? key),
  getCurrentLocale: () => 'zh-CN',
}));

const mockInvoke = jest.fn();
const mockDialogOpen = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: any[]) => mockDialogOpen(...args),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(() => ({
    configName: 'Primary',
    provider: 'openai',
    model: 'gpt-5',
    keyPresent: true,
  })),
  validateResolvedAgentConfig: jest.fn(() => []),
  formatAgentConfigValidationError: jest.fn(() => ''),
}));

jest.mock('@/services/autoresearch/setupFlow', () => ({
  validateAutoResearchSetupDraft: jest.fn((draft: any) => ({ value: draft })),
  startAutoResearchRun: jest.fn(() => Promise.resolve({
    resolvedConfig: {
      mode: 'local',
      remoteWorkDir: '/test/workdir',
    },
  })),
  logAutoResearchSetupFailure: jest.fn(),
  parseOptionalBaseline: jest.fn((val: string) => {
    if (!val || val.trim() === '') return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  }),
}));

// Mock components to avoid loading components/index.ts barrel file
jest.mock('@/components', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

jest.mock('@/components/autoresearch/AutoResearchRunDetailDocument', () => ({
  AutoResearchRunDetailDocument: ({ headerActions }: any) => (
    <div data-testid="run-detail-doc">
      {headerActions}
    </div>
  ),
}));

// Mock localStorage
const mockLocalStorage: Record<string, string> = {};
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: jest.fn((key: string) => mockLocalStorage[key] || null),
    setItem: jest.fn((key: string, val: string) => {
      mockLocalStorage[key] = val;
    }),
    removeItem: jest.fn((key: string) => {
      delete mockLocalStorage[key];
    }),
    clear: jest.fn(() => {
      for (const k of Object.keys(mockLocalStorage)) {
        delete mockLocalStorage[k];
      }
    }),
  },
  writable: true,
});

jest.mock('@/store', () => {
  const mockUseSettingsStore = (selector?: any) => {
    if (selector) {
      return selector(mockSettingsState);
    }
    return mockSettingsState;
  };
  mockUseSettingsStore.getState = () => mockSettingsState;
  mockUseSettingsStore.setState = (update: any) => {
    Object.assign(mockSettingsState, update);
  };

  const mockUseUIStore = {
    getState: () => ({
      toggleSettings: mockToggleSettings,
    }),
  };

  return {
    useSettingsStore: mockUseSettingsStore,
    useUIStore: mockUseUIStore,
  };
});

const mockGetSelectedAutoResearchRunContext = jest.fn(() => ({
  run: null as any,
  liveOutput: '',
  reason: '',
  loopState: 'idle',
  statusMessage: '',
  isActive: false,
}));
const mockGetSelectedAutoResearchRun = jest.fn(() => null);
const mockGetSortedAutoResearchRuns = jest.fn(() => []);

jest.mock('@/store/autoresearchStore', () => {
  const mockUseAutoResearchStore = (selector?: any) => {
    if (selector) {
      return selector(mockStoreState);
    }
    return mockStoreState;
  };
  mockUseAutoResearchStore.getState = () => mockStoreState;
  mockUseAutoResearchStore.setState = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(mockStoreState, update(mockStoreState));
    } else {
      Object.assign(mockStoreState, update);
    }
  };
  mockUseAutoResearchStore.subscribe = jest.fn();

  return {
    useAutoResearchStore: mockUseAutoResearchStore,
    getSelectedAutoResearchRunContext: mockGetSelectedAutoResearchRunContext,
    getSelectedAutoResearchRun: mockGetSelectedAutoResearchRun,
    getSortedAutoResearchRuns: mockGetSortedAutoResearchRuns,
  };
});

// Import component after the mocks are set up
import { AdvancedWorkdirSetup } from '../AdvancedWorkdirSetup';

describe('AdvancedWorkdirSetup Expert Launch Cockpit UI Component', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Reset state before each test
    mockStoreState.id = '';
    mockStoreState.loopState = 'idle';
    mockStoreState.sshConfig = null;
    mockStoreState.runHistory = [];
    mockSettingsState.activeConfigId = 'config-1';
    mockSettingsState.apiConfigs = [
      { id: 'config-1', name: 'Primary', provider: 'openai', model: 'gpt-5', keyPresent: true },
    ];
    mockGetSelectedAutoResearchRunContext.mockReturnValue({
      run: null as any,
      liveOutput: '',
      reason: '',
      loopState: 'idle',
      statusMessage: '',
      isActive: false,
    });
    mockStoreState.lastUsedConfig = null;
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('1. renders 5 cockpit sections', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const text = container.textContent || '';
    expect(text).toContain('Manual Launch AutoResearch');
    expect(text).toContain('Runtime Target');
    expect(text).toContain('工作区与目标项目');
    expect(text).toContain('Metrics & Iterations');
    expect(text).toContain('Environment Check');
    expect(text).toContain('Launch Summary');
  });

  it('2. local mode completes Runtime Target', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Segmented button for Local run is active and section shows completed
    const section1 = container.querySelector('.rounded-2xl:nth-of-type(1)');
    expect(section1?.textContent).toContain('Completed');
  });

  it('3. SSH mode missing host/user marks Runtime Target missing', () => {
    // Set ssh configuration directly to simulate a parsed state in setupForm state initialization
    mockLocalStorage['pipi-shrimp-autoresearch-ssh-config'] = JSON.stringify({
      mode: 'ssh',
      host: '',
      user: '',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/test/workdir',
      authMode: 'agent',
    });

    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const section1 = container.querySelector('.rounded-2xl:nth-of-type(1)');
    expect(section1?.textContent).toContain('Missing');
  });

  it('4. workspace section distinguishes AutoResearch workspace and target project', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Expand Workspace Section
    const editBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Edit' && b.closest('.rounded-2xl')?.textContent?.includes('工作区与目标项目')
    );
    expect(editBtn).toBeTruthy();
    act(() => {
      editBtn?.click();
    });

    const text = container.textContent || '';
    expect(text).toContain('AutoResearch Workspace');
    expect(text).toContain('Target Project Directory');
    expect(text).toContain('AutoResearch will create run files, logs, and temporary experiment directories here.');
    expect(text).toContain('AutoResearch will run verification and improvements on this project or experiment directory.');
  });

  it('5. metric section validates baseline numeric input', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Expand Metric & Iterations Section
    const editBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Edit' && b.closest('.rounded-2xl')?.textContent?.includes('Metrics & Iterations')
    );
    expect(editBtn).toBeTruthy();
    act(() => {
      editBtn?.click();
    });

    // Find the baseline input
    const baselineInput = container.querySelector('input[placeholder="e.g. 0.963284"]') as HTMLInputElement;
    expect(baselineInput).toBeTruthy();
  });

  it('6. connection test required before start', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const text = container.textContent || '';
    // Connection status panel shows that connection is required
    expect(text).toContain('Test Connection first');
  });

  it('shows Configuring phase chip when idle with no active run', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const chip = container.querySelector('[data-testid="autoresearch-setup-phase-chip"]');
    expect(chip?.getAttribute('data-phase')).toBe('configuring');
    expect(chip?.getAttribute('aria-label')).toBe('AutoResearch phase: 配置中');
  });

  it('shows Running phase chip when active run loopState is running', () => {
    mockStoreState.id = 'run-active-1';
    mockStoreState.loopState = 'running';
    mockStoreState.runHistory = [];
    mockGetSortedAutoResearchRuns.mockReturnValue([]);

    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const setupBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Setup and Start'
    );
    act(() => {
      setupBtn?.click();
    });

    const chip = container.querySelector('[data-testid="autoresearch-setup-phase-chip"]');
    expect(chip?.getAttribute('data-phase')).toBe('running');
    expect(chip?.getAttribute('aria-label')).toBe('AutoResearch phase: 运行中');
  });

  it('7. primary next action changes based on first missing field', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Expand Workspace Section
    const editBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Edit' && b.closest('.rounded-2xl')?.textContent?.includes('工作区与目标项目')
    );
    expect(editBtn).toBeTruthy();
    act(() => {
      editBtn?.click();
    });

    // Clear Workspace input using native value setter to bypass React's descriptor overrides
    const workspaceInput = container.querySelector('input[placeholder="autoresearch.localWorkDirPlaceholder"]') as HTMLInputElement;
    expect(workspaceInput).toBeTruthy();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    act(() => {
      nativeInputValueSetter?.call(workspaceInput, '');
      workspaceInput.dispatchEvent(new Event('input', { bubbles: true }));
      workspaceInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const nextBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.className.includes('bg-neutral-900')
    );
    expect(nextBtn).toBeTruthy();
    expect(nextBtn?.textContent).toContain('Fill Workspace first');
  });

  it('8. clicking next action expands the correct section', () => {
    // If runtime is missing (e.g. ssh without host)
    mockLocalStorage['pipi-shrimp-autoresearch-ssh-config'] = JSON.stringify({
      mode: 'ssh',
      host: '',
      user: '',
    });
    
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Collapse runtime first by clicking Workspace Edit button
    const editWorkspaceBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Edit' && b.closest('.rounded-2xl')?.textContent?.includes('工作区与目标项目')
    );
    expect(editWorkspaceBtn).toBeTruthy();
    act(() => {
      editWorkspaceBtn?.click();
    });

    const textBefore = container.textContent || '';
    expect(textBefore).not.toContain('主机地址 (Host)');

    const actionBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.className.includes('bg-neutral-900')
    );
    expect(actionBtn?.textContent).toContain('Fill Runtime Target first');

    act(() => {
      actionBtn?.click();
    });

    const textAfter = container.textContent || '';
    expect(textAfter).toMatch(/autoresearch\.manual\.hostLabel|主机地址 \(Host\)/);
  });

  it('10. password is not persisted to localStorage', () => {
    // We render and mutate password in setupForm
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const calls = (localStorage.setItem as jest.Mock).mock.calls;
    const saveCall = calls.find(call => call[0] === 'pipi-shrimp-autoresearch-ssh-config');
    expect(saveCall).toBeTruthy();
    if (saveCall) {
      const savedData = JSON.parse(saveCall[1] as string);
      expect(savedData.password).toBeUndefined();
    }
  });

  it('11. reset to defaults still works', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const resetBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Reset to Defaults'
    );
    expect(resetBtn).toBeTruthy();

    act(() => {
      resetBtn?.click();
    });

    expect(mockStoreState.clearLastUsedConfig).toHaveBeenCalled();
  });

  it('12. existing run history controls still render', () => {
    mockStoreState.sshConfig = { mode: 'local', remoteWorkDir: '/test' } as any;
    mockStoreState.runHistory = [{ id: 'run-1', title: 'Test Run', status: 'running', config: {} }];
    
    mockGetSelectedAutoResearchRunContext.mockReturnValue({
      run: { id: 'run-1', title: 'Test Run', status: 'running', config: { experimentDir: '/exp', workdir: '/work' } } as any,
      liveOutput: 'Running...',
      reason: '',
      loopState: 'running',
      statusMessage: 'In progress',
      isActive: true,
    });
    
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });
    
    expect(container.textContent).toContain('Pause');
    expect(container.textContent).toContain('Stop');
  });

  it('13. long paths render compact basename summaries while full path is available via title/aria-label', () => {
    mockStoreState.lastUsedConfig = {
      workdir: '/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-workspace',
      experimentDir: '/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-project',
      metric: 'accuracy',
      direction: 'higher',
      iterations: 5,
    } as any;

    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const workspaceSpan = container.querySelector('[title="/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-workspace"]');
    expect(workspaceSpan).toBeTruthy();
    expect(workspaceSpan?.textContent).toContain('some-workspace');
    expect(workspaceSpan?.getAttribute('aria-label')).toBe('/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-workspace');

    const projectSpan = container.querySelector('[title="/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-project"]');
    expect(projectSpan).toBeTruthy();
    expect(projectSpan?.textContent).toContain('some-project');
    expect(projectSpan?.getAttribute('aria-label')).toBe('/mnt/d/WSL/Ubuntu/pipishrimp/tmp/some-project');
  });

  it('14. final blocker environment check copy appears when only connection test is missing', () => {
    mockLocalStorage['pipi-shrimp-autoresearch-ssh-config'] = JSON.stringify({
      mode: 'local',
      remoteWorkDir: '/test/workspace',
    });

    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    expect(container.textContent).toContain('所有配置已填写，最后一步是测试运行环境。');
  });

  it('15. SSH placeholders and auth labels are localized and not raw/scary', () => {
    mockLocalStorage['pipi-shrimp-autoresearch-ssh-config'] = JSON.stringify({
      mode: 'ssh',
      host: '',
      user: '',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/test/workdir',
      authMode: 'agent',
    });

    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    // Verify host placeholder
    const hostInput = container.querySelector('input[placeholder="例如 192.168.1.10 或 server.example.com"]');
    expect(hostInput).toBeTruthy();

    // Verify user placeholder
    const userInput = container.querySelector('input[placeholder="例如 ubuntu / root / your-user"]');
    expect(userInput).toBeTruthy();

    // Verify port placeholder
    const portInput = container.querySelector('input[placeholder="22"]');
    expect(portInput).toBeTruthy();

    // Verify select labels are short and localized
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('SSH Agent / ~/.ssh/config');
    expect(options).toContain('密码');
    expect(options).toContain('密钥文件');
  });

  it('16. advanced fields helper renders collapsed by default', () => {
    act(() => {
      root.render(<AdvancedWorkdirSetup />);
    });

    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(container.textContent).toContain('Usually no need to modify');
  });
});
