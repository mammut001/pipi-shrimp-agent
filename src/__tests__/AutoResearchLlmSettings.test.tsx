/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, expect, it, jest } from '@jest/globals';

import { AutoResearchLlmSettingsSection } from '../components/settings/AutoResearchLlmSettings';

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
  jest.clearAllMocks();
});

it('renders capability badges for all configured AutoResearch providers', () => {
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
            model: 'MiniMax-M2.7',
          },
          {
            id: 'cfg-openai',
            name: 'OpenAI Agent',
            provider: 'openai',
            apiKey: 'key',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1',
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
            model: 'gemini-2.5-pro',
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
    '"AutoResearch LLM Provider Pick the default provider snapshot for AutoResearch runs, then override agent and reflection only when needed. Default provider Use active Settings config MiniMax Agent · MiniMax · MiniMax-M2.7 OpenAI Agent · OpenAI · gpt-4.1 Anthropic Reflection · Anthropic · claude-sonnet-4-5 Gemini Vision · Gemini · gemini-2.5-pro Agent model override Use AutoResearch default MiniMax Agent · MiniMax · MiniMax-M2.7 OpenAI Agent · OpenAI · gpt-4.1 Anthropic Reflection · Anthropic · claude-sonnet-4-5 Gemini Vision · Gemini · gemini-2.5-pro Reflection model override Use AutoResearch default MiniMax Agent · MiniMax · MiniMax-M2.7 OpenAI Agent · OpenAI · gpt-4.1 Anthropic Reflection · Anthropic · claude-sonnet-4-5 Gemini Vision · Gemini · gemini-2.5-pro Selected default snapshot OpenAI Agent · OpenAI · gpt-4.1 streaming tool:openai json_mode vision Config Provider Capabilities MiniMax Agent MiniMax-M2.7 MiniMax streaming tool:openai json_mode vision OpenAI Agent gpt-4.1 OpenAI Active streaming tool:openai json_mode vision Anthropic Reflection claude-sonnet-4-5 Anthropic streaming tool:anthropic json_mode vision Gemini Vision gemini-2.5-pro Gemini streaming tool:openai json_mode vision"',
  );
});