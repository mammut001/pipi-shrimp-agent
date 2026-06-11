/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, expect, it, jest } from '@jest/globals';

import { AutoResearchLlmSettingsSection } from '../components/settings/AutoResearchLlmSettings';
import { useAutoResearchStore } from '../store/autoresearchStore';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  useAutoResearchStore.setState({
    id: '',
    loopState: 'idle',
    runHistory: [],
    statusMessage: undefined,
  });
  jest.clearAllMocks();
});

it('renders capability badges for all configured AutoResearch providers', () => {
  useAutoResearchStore.setState({
    id: '',
    loopState: 'idle',
    runHistory: [],
    statusMessage: undefined,
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(
      React.createElement(AutoResearchLlmSettingsSection, {
        apiConfigs: [
          {
            id: 'cfg-minimax',
            name: 'MiniMax Agent',
            provider: 'minimax',
            apiKey: 'key',
            baseUrl: 'https://api.minimaxi.com/v1',
            model: 'MiniMax-M3',
          },
          {
            id: 'cfg-openai',
            name: 'OpenAI Agent',
            provider: 'openai',
            apiKey: 'key',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.4',
          },
          {
            id: 'cfg-anthropic',
            name: 'Anthropic Reflection',
            provider: 'anthropic',
            apiKey: 'key',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-sonnet-4-5',
          },
          {
            id: 'cfg-gemini',
            name: 'Gemini Vision',
            provider: 'gemini',
            apiKey: 'key',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-3.5-flash',
          },
        ],
        activeConfigId: 'cfg-openai',
        settings: {
          defaultConfigId: 'cfg-openai',
          agentConfigId: 'cfg-minimax',
          reflectionConfigId: 'cfg-anthropic',
        },
        onUpdate: jest.fn(),
      }),
    );
  });

  const normalized = container.textContent?.replace(/\s+/g, ' ').trim();
  expect(normalized).toMatchInlineSnapshot(
    `"AutoResearch LLM ProviderPick the default provider snapshot for AutoResearch runs, then override agent and reflection only when needed.Default providerUse active Settings configMiniMax AgentMiniMax · MiniMax-M3OpenAI AgentActiveOpenAI · gpt-5.4Anthropic ReflectionAnthropic · claude-sonnet-4-5Gemini VisionGemini · gemini-3.5-flashAgent model overrideUse AutoResearch defaultMiniMax AgentMiniMax · MiniMax-M3OpenAI AgentActiveOpenAI · gpt-5.4Anthropic ReflectionAnthropic · claude-sonnet-4-5Gemini VisionGemini · gemini-3.5-flashReflection model overrideUse AutoResearch defaultMiniMax AgentMiniMax · MiniMax-M3OpenAI AgentActiveOpenAI · gpt-5.4Anthropic ReflectionAnthropic · claude-sonnet-4-5Gemini VisionGemini · gemini-3.5-flashSelected default snapshotOpenAI AgentOpenAI · gpt-5.4streamingtool:openaijson_modevision"`,
  );
});

it('disables provider selection while AutoResearch is active', () => {
  useAutoResearchStore.setState({
    id: 'run-1',
    loopState: 'running',
    runHistory: [
      {
        id: 'run-1',
        title: 'active',
        status: 'running',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:01.000Z',
        config: {
          experimentDir: '/tmp/exp',
          workdir: '/tmp/work',
          metric: 'accuracy',
          direction: 'higher',
          iterations: 5,
          configSnapshot: {
            configName: 'Primary',
            provider: 'openai',
            model: 'gpt-5.4',
            keyPresent: true,
            source: 'settings.activeConfig',
          },
        },
        currentIteration: 1,
        bestMetricValue: null,
        bestIteration: null,
        failureCount: 0,
        iterations: [],
        events: [],
      },
    ],
    statusMessage: undefined,
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  const onUpdate = jest.fn();

  act(() => {
    root.render(
      React.createElement(AutoResearchLlmSettingsSection, {
        apiConfigs: [
          {
            id: 'cfg-openai',
            name: 'OpenAI Agent',
            provider: 'openai',
            apiKey: 'key',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.4',
          },
        ],
        activeConfigId: 'cfg-openai',
        settings: {
          defaultConfigId: 'cfg-openai',
          agentConfigId: null,
          reflectionConfigId: null,
        },
        onUpdate,
      }),
    );
  });

  const buttons = Array.from(container.querySelectorAll('button'));
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.every((b) => b.disabled)).toBe(true);
  expect(container.textContent).toContain(
    'AutoResearch is still running. Stop the active run before you change the AutoResearch provider selection.',
  );
  expect(onUpdate).not.toHaveBeenCalled();
});