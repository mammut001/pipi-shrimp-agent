/**
 * @jest-environment jsdom
 */

import React, { act } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { Settings } from '../pages/Settings';
import { useSettingsStore } from '../store';
import { supportsCustomModel } from '../shared/providers';
import type { ApiConfig } from '../types/settings';

// Mock child components that are not under test
jest.mock('../components/settings/TelegramSettings', () => ({ TelegramSettings: () => <div data-testid="mock-telegram" /> }));
jest.mock('../components/settings/MCPSettingsSection', () => ({ MCPSettingsSection: () => <div data-testid="mock-mcp" /> }));
jest.mock('../components/settings/AgentBehaviorSettings', () => ({ AgentBehaviorSettings: () => <div data-testid="mock-agent-behavior" /> }));
jest.mock('../components/settings/AutoResearchLlmSettings', () => ({ AutoResearchLlmSettingsSection: () => <div data-testid="mock-autoresearch" /> }));
jest.mock('../components/settings/AppearanceSettings', () => ({ AppearanceSettings: () => <div data-testid="mock-appearance" /> }));
jest.mock('../components/settings/DatabaseHealthSection', () => ({ DatabaseHealthSection: () => <div data-testid="mock-db-health" /> }));
jest.mock('../components/settings/TerminalSettings', () => ({ TerminalSettings: () => <div data-testid="mock-terminal" /> }));
jest.mock('../components/TokenStats', () => ({ TokenStats: () => <div data-testid="mock-token-stats" /> }));
jest.mock('@/components/TokenStats', () => ({ TokenStats: () => <div data-testid="mock-token-stats" /> }));

const mockInvoke = jest.fn();
jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe('supportsCustomModel provider capability', () => {
  it('returns true for openai-compatible and anthropic-compatible', () => {
    expect(supportsCustomModel('openai-compatible')).toBe(true);
    expect(supportsCustomModel('anthropic-compatible')).toBe(true);
  });

  it('returns false for first-party providers without custom model flag', () => {
    expect(supportsCustomModel('anthropic')).toBe(false);
    expect(supportsCustomModel('openai')).toBe(false);
  });
});

describe('Settings custom model support', () => {
  const initialStoreState = useSettingsStore.getState();

  beforeEach(() => {
    mockInvoke.mockReset();
    useSettingsStore.setState({
      ...initialStoreState,
      apiConfigs: [],
      activeConfigId: null,
      availableModels: {},
      availableModelEntries: {},
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useSettingsStore.setState(initialStoreState);
    });
    jest.clearAllMocks();
  });

  async function renderSettings() {
    await act(async () => {
      render(<Settings />);
    });
  }

  it('saved custom model id remains available and selected for openai-compatible', async () => {
    const customConfig: ApiConfig = {
      id: 'cfg-custom-1',
      name: 'Custom Gateway',
      provider: 'openai-compatible',
      apiKey: 'sk-test-secret',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'vercel/meta/muse-spark-1.2-contributor',
      apiFormat: 'openai',
    };

    useSettingsStore.setState({
      apiConfigs: [customConfig],
      activeConfigId: customConfig.id,
      availableModelEntries: {},
    });

    await renderSettings();

    // For openai-compatible, model should be a text input with datalist
    const modelInput = screen.getByTestId('model-input') as HTMLInputElement;
    expect(modelInput).toBeDefined();
    expect(modelInput.value).toBe('vercel/meta/muse-spark-1.2-contributor');

    // The datalist should include the custom model
    const datalist = screen.getByTestId('model-datalist');
    const options = Array.from(datalist.querySelectorAll('option'));
    expect(options.some((opt) => opt.getAttribute('value') === 'vercel/meta/muse-spark-1.2-contributor')).toBe(true);
  });

  it('saved custom model id remains available in select for first-party providers', async () => {
    const customConfig: ApiConfig = {
      id: 'cfg-anthropic-custom',
      name: 'Custom Anthropic',
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: '',
      model: 'claude-custom-special-model',
      apiFormat: 'anthropic',
    };

    useSettingsStore.setState({
      apiConfigs: [customConfig],
      activeConfigId: customConfig.id,
      availableModelEntries: {},
    });

    await renderSettings();

    // For anthropic, model is a select element
    const modelSelect = screen.getByTestId('model-select') as HTMLSelectElement;
    expect(modelSelect).toBeDefined();
    expect(modelSelect.value).toBe('claude-custom-special-model');

    const options = Array.from(modelSelect.querySelectorAll('option'));
    expect(options.some((opt) => opt.value === 'claude-custom-special-model')).toBe(true);
  });

  it('typing a custom model id is possible for openai-compatible', async () => {
    const customConfig: ApiConfig = {
      id: 'cfg-compat-empty',
      name: 'My Gateway',
      provider: 'openai-compatible',
      apiKey: 'sk-test-secret',
      baseUrl: 'https://gateway.example.com/v1',
      model: '',
      apiFormat: 'openai',
    };

    useSettingsStore.setState({
      apiConfigs: [customConfig],
      activeConfigId: customConfig.id,
      availableModelEntries: {},
    });

    await renderSettings();

    const modelInput = screen.getByTestId('model-input') as HTMLInputElement;
    expect(modelInput.tagName.toLowerCase()).toBe('input');

    // Type a custom model ID
    await act(async () => {
      fireEvent.change(modelInput, {
        target: { value: 'vercel/meta/muse-spark-1.2-contributor' },
      });
    });

    expect(modelInput.value).toBe('vercel/meta/muse-spark-1.2-contributor');
  });

  it('fetch models does not clobber an existing custom id', async () => {
    const customConfig: ApiConfig = {
      id: 'cfg-compat-existing',
      name: 'Gateway with Custom Model',
      provider: 'openai-compatible',
      apiKey: 'sk-test-secret',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'vercel/meta/muse-spark-1.2-contributor',
      apiFormat: 'openai',
    };

    useSettingsStore.setState({
      apiConfigs: [customConfig],
      activeConfigId: customConfig.id,
      availableModelEntries: {},
    });

    // Mock remote fetch returning different remote models (not containing the custom one)
    mockInvoke.mockResolvedValueOnce(['alibaba/qwen', 'voyage/rerank']);

    await renderSettings();

    const modelInput = screen.getByTestId('model-input') as HTMLInputElement;
    expect(modelInput.value).toBe('vercel/meta/muse-spark-1.2-contributor');

    // Click "Fetch models"
    const fetchButton = screen.getByTestId('fetch-models-button');
    await act(async () => {
      fireEvent.click(fetchButton);
    });

    // Ensure model input was NOT clobbered to alibaba/qwen
    expect(modelInput.value).toBe('vercel/meta/muse-spark-1.2-contributor');

    // Ensure datalist now contains both the remote suggestions and the custom model
    const datalist = screen.getByTestId('model-datalist');
    const optionValues = Array.from(datalist.querySelectorAll('option')).map((o) => o.getAttribute('value'));

    expect(optionValues).toContain('alibaba/qwen');
    expect(optionValues).toContain('voyage/rerank');
    expect(optionValues).toContain('vercel/meta/muse-spark-1.2-contributor');
  });

  it('fetch models picks first remote model if model field was empty', async () => {
    const emptyConfig: ApiConfig = {
      id: 'cfg-compat-empty-fetch',
      name: 'Gateway without Model',
      provider: 'openai-compatible',
      apiKey: 'sk-test-secret',
      baseUrl: 'https://gateway.example.com/v1',
      model: '',
      apiFormat: 'openai',
    };

    useSettingsStore.setState({
      apiConfigs: [emptyConfig],
      activeConfigId: emptyConfig.id,
      availableModelEntries: {},
    });

    mockInvoke.mockResolvedValueOnce(['alibaba/qwen', 'voyage/rerank']);

    await renderSettings();

    const modelInput = screen.getByTestId('model-input') as HTMLInputElement;
    expect(modelInput.value).toBe('');

    const fetchButton = screen.getByTestId('fetch-models-button');
    await act(async () => {
      fireEvent.click(fetchButton);
    });

    // When model was empty, it should auto-pick the first remote model
    expect(modelInput.value).toBe('alibaba/qwen');
  });
});
