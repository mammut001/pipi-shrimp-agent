/**
 * @jest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createDomHarness, clickElement, flushEffects } from './domHarness';
import type { WorkflowAgent } from '@/types/workflow';

const mockUseSettingsStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  setLocale: jest.fn(),
  addLocaleChangeListener: jest.fn(() => jest.fn()),
  getSupportedLocales: () => [{ value: 'en-US', label: 'English', flag: 'US' }],
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: any) => any) => mockUseSettingsStore(selector),
}));

jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  NodeResizer: () => null,
}));

import AgentNode from '../AgentNode';

describe('AgentNode component', () => {
  let harness: ReturnType<typeof createDomHarness>;

  beforeEach(() => {
    jest.clearAllMocks();
    harness = createDomHarness();

    mockUseSettingsStore.mockImplementation((selector: (state: any) => any) => {
      const state = {
        apiConfigs: [
          {
            id: 'cfg-aliyun',
            name: 'Aliyun Qwen Gateway',
            provider: 'openai-compatible',
            apiKey: 'sk-aliyun-12345',
            model: 'qwen3.7-max',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          },
          {
            id: 'cfg-deepseek',
            name: 'DeepSeek Direct',
            provider: 'deepseek',
            apiKey: 'sk-ds-123',
            model: 'deepseek-chat',
            baseUrl: 'https://api.deepseek.com',
          },
        ],
        availableModels: {},
      };
      return selector(state);
    });
  });

  it('renders AgentNode with useMemo without runtime error and includes custom provider models', async () => {
    const agent: WorkflowAgent = {
      id: 'agent-node-1',
      name: 'Researcher Agent',
      position: { x: 100, y: 100 },
      status: 'idle',
      outputRoutes: [],
      execution: { mode: 'single' },
      taskPrompt: 'Research quantum computing developments',
    };

    const onUpdateModel = jest.fn();

    const nodeProps: any = {
      id: 'agent-node-1',
      selected: false,
      data: {
        agent,
        allAgents: [agent],
        onRemove: jest.fn(),
        onRemoveSkill: jest.fn(),
        onAddSkill: jest.fn(),
        onUpdateName: jest.fn(),
        onUpdateModel,
        onSelect: jest.fn(),
      },
    };

    await harness.render(<AgentNode {...nodeProps} />);

    expect(harness.container.textContent).toContain('Researcher Agent');
    expect(harness.container.textContent).toContain('usingGlobalConfig');

    // Click model selector button to open dropdown popover
    const modelButton = Array.from(harness.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Model:'),
    );
    expect(modelButton).toBeDefined();
    await clickElement(modelButton!, harness.window);
    await flushEffects();

    // Verify Aliyun Qwen Gateway and DeepSeek Direct headers are present
    const popoverContent = document.body.textContent ?? '';
    expect(popoverContent).toContain('Aliyun Qwen Gateway');
    expect(popoverContent).toContain('DeepSeek Direct');

    // Popover auto-expands the first provider (openai-compatible / Aliyun Qwen Gateway)
    const qwenModelBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('qwen3.7-max'),
    );
    expect(qwenModelBtn).toBeDefined();

    await clickElement(qwenModelBtn!, harness.window);
    await flushEffects();

    expect(onUpdateModel).toHaveBeenCalledWith(
      'agent-node-1',
      'openai-compatible',
      'qwen3.7-max',
    );

    await harness.cleanup();
  });
});
