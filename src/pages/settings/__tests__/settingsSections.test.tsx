/**
 * @jest-environment jsdom
 */

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AgentSettings, ApiConfig } from '@/types/settings';
import {
  SettingsLoadingState,
  SettingsModalShell,
  SettingsSecondarySections,
  SettingsTokenStatsFrame,
} from '../settingsSections';
import {
  createEmptySettingsFormData,
  settingsFormDataFromConfig,
  buildProviderModelEntries,
  getSettingsPricingDisplay,
  buildDraftApiConfig,
} from '../settingsFormHelpers';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'zh-CN',
  setLocale: jest.fn(),
  convertToOldLanguageCode: jest.fn(),
}));

const recordedProps: {
  agentBehavior?: any;
  terminal?: any;
  databaseHealth?: any;
  appearance?: any;
} = {};

jest.mock('@/components/settings/TelegramSettings', () => ({
  TelegramSettings: () => createElement('div', { 'data-testid': 'mock-telegram' }),
}));

jest.mock('@/components/settings/MCPSettingsSection', () => ({
  MCPSettingsSection: () => createElement('div', { 'data-testid': 'mock-mcp' }),
}));

jest.mock('@/components/settings/AgentBehaviorSettings', () => ({
  AgentBehaviorSettings: (props: any) => {
    recordedProps.agentBehavior = props;
    return createElement('div', { 'data-testid': 'mock-agent-behavior' });
  },
}));

jest.mock('@/components/settings/TerminalSettings', () => ({
  TerminalSettings: (props: any) => {
    recordedProps.terminal = props;
    return createElement('div', { 'data-testid': 'mock-terminal' });
  },
}));

jest.mock('@/components/settings/DatabaseHealthSection', () => ({
  DatabaseHealthSection: (props: any) => {
    recordedProps.databaseHealth = props;
    return createElement('div', { 'data-testid': 'mock-database-health' });
  },
}));

jest.mock('@/components/settings/PromptTemplateSettings', () => ({
  PromptTemplateSettings: () => createElement('div', { 'data-testid': 'mock-prompt-template' }),
}));

jest.mock('@/components/settings/AppearanceSettings', () => ({
  AppearanceSettings: (props: any) => {
    recordedProps.appearance = props;
    return createElement('div', { 'data-testid': 'mock-appearance' });
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  act(() => {
    root.render(element);
  });
  return container;
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByText(container: ParentNode, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label));
}

describe('settingsSections', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    recordedProps.agentBehavior = undefined;
    recordedProps.terminal = undefined;
    recordedProps.databaseHealth = undefined;
    recordedProps.appearance = undefined;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  it('renders SettingsLoadingState spinner', () => {
    const container = render(createElement(SettingsLoadingState));
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('SettingsModalShell renders children, title/subtitle keys, and handles backdrop and close clicks', () => {
    const onClose = jest.fn();
    const container = render(
      createElement(
        SettingsModalShell,
        { onClose },
        createElement('div', { 'data-testid': 'shell-content' }, 'Child Body'),
      ),
    );

    expect(container.querySelector('[data-testid="shell-content"]')?.textContent).toBe('Child Body');
    expect(container.textContent).toContain('settings.title');
    expect(container.textContent).toContain('settings.subtitle');

    // Click backdrop
    const backdrop = container.querySelector('.bg-slate-950\\/40');
    click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click close button
    const closeBtn = container.querySelector('button[title="common.close"]');
    click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('SettingsSecondarySections forwards props, renders children in order, and handles save', () => {
    const dummyAgentSettings: AgentSettings = {
      maxToolRounds: 42,
      maxContinuousWorkTime: 30,
      autoCompactionThreshold: 80,
      subAgentMaxRounds: 15,
      subAgentMaxDepth: 2,
    };
    const onUpdateAgentSettings = jest.fn();
    const onWindowsShellProfileChange = jest.fn();
    const addNotification = jest.fn();
    const onThemeChange = jest.fn();
    const onLanguageChange = jest.fn();
    const onSaveOtherSettings = jest.fn();

    const container = render(
      createElement(SettingsSecondarySections, {
        agentSettings: dummyAgentSettings,
        onUpdateAgentSettings,
        windowsShellProfile: 'powershell',
        onWindowsShellProfileChange,
        addNotification,
        theme: 'light',
        language: 'zh-CN',
        onThemeChange,
        onLanguageChange,
        onSaveOtherSettings,
      }),
    );

    // Check prop forwarding for AgentBehaviorSettings
    expect(recordedProps.agentBehavior?.agentSettings).toBe(dummyAgentSettings);
    recordedProps.agentBehavior?.onUpdate({ maxToolRounds: 50 });
    expect(onUpdateAgentSettings).toHaveBeenCalledWith({ maxToolRounds: 50 });

    // Check prop forwarding for TerminalSettings
    expect(recordedProps.terminal?.windowsShellProfile).toBe('powershell');
    recordedProps.terminal?.onChange('auto');
    expect(onWindowsShellProfileChange).toHaveBeenCalledWith('auto');

    // Check prop forwarding for DatabaseHealthSection
    expect(recordedProps.databaseHealth?.addNotification).toBe(addNotification);

    // Check prop forwarding for AppearanceSettings
    expect(recordedProps.appearance?.theme).toBe('light');
    expect(recordedProps.appearance?.language).toBe('zh-CN');
    recordedProps.appearance?.onThemeChange('dark');
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    recordedProps.appearance?.onLanguageChange('en-US');
    expect(onLanguageChange).toHaveBeenCalledWith('en-US');

    // Children render in original order: (telegram, mcp, agent, terminal, db, prompt, appearance)
    const renderedOrder = Array.from(container.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(renderedOrder).toEqual([
      'mock-telegram',
      'mock-mcp',
      'mock-agent-behavior',
      'mock-terminal',
      'mock-database-health',
      'mock-prompt-template',
      'mock-appearance',
    ]);

    // Clicking save button calls onSaveOtherSettings
    const saveButton = buttonByText(container, 'settings.saveSettings');
    expect(saveButton).toBeDefined();
    click(saveButton);
    expect(onSaveOtherSettings).toHaveBeenCalledTimes(1);
  });

  it('SettingsTokenStatsFrame renders children', () => {
    const container = render(
      createElement(
        SettingsTokenStatsFrame,
        null,
        createElement('div', { 'data-testid': 'token-stats-inner' }, 'Token Stats Content'),
      ),
    );
    expect(container.querySelector('[data-testid="token-stats-inner"]')?.textContent).toBe('Token Stats Content');
  });

  describe('settingsFormHelpers', () => {
    it('createEmptySettingsFormData initializes standard defaults', () => {
      const empty = createEmptySettingsFormData();
      expect(empty.name).toBe('');
      expect(empty.provider).toBe('anthropic');
      expect(empty.apiKey).toBe('');
      expect(empty.baseUrl).toBe('');
      expect(typeof empty.model).toBe('string');
      expect(empty.model.length).toBeGreaterThan(0);
      expect(empty.apiFormat).toBe('');
      expect(empty.pricing).toEqual({});
    });

    it('settingsFormDataFromConfig maps an existing ApiConfig correctly', () => {
      const config: ApiConfig = {
        id: 'cfg-1',
        name: 'Test Anthropic',
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet',
        apiFormat: 'anthropic',
        pricing: { inputPrice: 3, outputPrice: 15 },
      };
      const mapped = settingsFormDataFromConfig(config);
      expect(mapped).toEqual({
        name: 'Test Anthropic',
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet',
        apiFormat: 'anthropic',
        pricing: { inputPrice: 3, outputPrice: 15 },
      });
    });

    it('buildProviderModelEntries appends custom model when not in remote/default lists', () => {
      const entries = buildProviderModelEntries(
        'openai-compatible',
        { 'openai-compatible': [{ id: 'remote-model-1', source: 'remote' }] },
        'custom-company-model',
      );
      expect(entries.some((e) => e.id === 'custom-company-model' && e.source === 'user')).toBe(true);
      expect(entries[0].id).toBe('remote-model-1');
    });

    it('getSettingsPricingDisplay returns custom when pricing defined, default otherwise', () => {
      const withCustom = getSettingsPricingDisplay({
        ...createEmptySettingsFormData(),
        model: 'gpt-4o',
        pricing: { inputPrice: 5, outputPrice: 20 },
      });
      expect(withCustom.isCustom).toBe(true);
      expect(withCustom.inputPrice).toBe(5);
      expect(withCustom.outputPrice).toBe(20);

      const withDefault = getSettingsPricingDisplay({
        ...createEmptySettingsFormData(),
        model: 'gpt-4o',
        pricing: {},
      });
      expect(withDefault.isCustom).toBe(false);
    });

    it('buildDraftApiConfig sets pricing to undefined when empty and preserves existing values', () => {
      const emptyPricingDraft = buildDraftApiConfig(
        createEmptySettingsFormData(),
        'cfg-draft',
        null,
      );
      expect(emptyPricingDraft.pricing).toBeUndefined();
      expect(emptyPricingDraft.id).toBe('cfg-draft');

      const filledDraft = buildDraftApiConfig(
        {
          ...createEmptySettingsFormData(),
          name: 'My Custom Provider',
          pricing: { inputPrice: 10 },
        },
        null,
        null,
      );
      expect(filledDraft.id).toBe('draft-config');
      expect(filledDraft.name).toBe('My Custom Provider');
      expect(filledDraft.pricing).toEqual({ inputPrice: 10 });
    });
  });

  describe('source guard', () => {
    it('keeps Settings.tsx under 500 LOC and verifies imports and file constraints', () => {
      const settingsPath = join(process.cwd(), 'src/pages/Settings.tsx');
      const settingsSource = readFileSync(settingsPath, 'utf8');
      expect(settingsSource.split('\n').length).toBeLessThan(500);
      expect(settingsSource).toMatch(/from '\.\/settings\/settingsSections'/);
      expect(settingsSource).toMatch(/from '\.\/settings\/settingsFormHelpers'/);

      const sectionsPath = join(process.cwd(), 'src/pages/settings/settingsSections.tsx');
      const sectionsSource = readFileSync(sectionsPath, 'utf8');
      expect(sectionsSource.split('\n').length).toBeLessThan(500);
      expect(sectionsSource).not.toMatch(/\bimport\s*\(/);
      expect(sectionsSource).not.toMatch(/\blazy\s*\(/);

      const helpersPath = join(process.cwd(), 'src/pages/settings/settingsFormHelpers.ts');
      const helpersSource = readFileSync(helpersPath, 'utf8');
      expect(helpersSource.split('\n').length).toBeLessThan(500);
      expect(helpersSource).not.toMatch(/\bimport\s*\(/);
      expect(helpersSource).not.toMatch(/\blazy\s*\(/);
    });
  });
});
