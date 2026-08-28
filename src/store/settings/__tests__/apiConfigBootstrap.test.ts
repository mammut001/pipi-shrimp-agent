import { describe, expect, it } from '@jest/globals';
import type { ApiConfig } from '@/types/settings';
import {
  MINIMAX_DEFAULT_CONFIG_ID,
  STALE_ALIYUN_ENDPOINT_MARKER,
  buildMiniMaxTemplateConfig,
  isStaleAliyunConfig,
  mergeBootstrappedApiConfigs,
  resolveAutoResearchLlmSettingsOnBoot,
  resolvePreferredActiveConfigId,
} from '../apiConfigBootstrap';

function minimaxKeyed(): ApiConfig {
  return {
    id: 'cfg-minimax',
    name: 'MiniMax Agent',
    provider: 'minimax',
    modelProviderId: 'minimax',
    apiFormat: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKey: 'minimax-secret',
    model: 'MiniMax-M3',
  };
}

function staleAliyun(): ApiConfig {
  return {
    id: 'aliyun-anthropic',
    name: 'Aliyun stale',
    provider: 'anthropic-compatible',
    modelProviderId: 'anthropic-compatible',
    apiFormat: 'anthropic',
    baseUrl: `https://${STALE_ALIYUN_ENDPOINT_MARKER}/apps/anthropic`,
    apiKey: 'stale-key',
    model: 'qwen3.7-max',
  };
}

describe('apiConfigBootstrap', () => {
  it('builds an empty MiniMax template without injecting a key', () => {
    const template = buildMiniMaxTemplateConfig();
    expect(template.id).toBe(MINIMAX_DEFAULT_CONFIG_ID);
    expect(template.provider).toBe('minimax');
    expect(template.apiKey).toBe('');
    expect(template.model).toBe('MiniMax-M3');
    expect(template.baseUrl).toContain('minimaxi.com');
  });

  it('adds a MiniMax template when no MiniMax config exists', () => {
    const openai: ApiConfig = {
      id: 'cfg-openai',
      name: 'OpenAI',
      provider: 'openai',
      apiKey: 'sk-openai',
      model: 'gpt-4.1',
    };
    const merged = mergeBootstrappedApiConfigs([openai]);
    expect(merged[0]?.id).toBe(MINIMAX_DEFAULT_CONFIG_ID);
    expect(merged[1]?.id).toBe('cfg-openai');
    expect(merged[1]?.apiKey).toBe('sk-openai');
  });

  it('does not overwrite an existing MiniMax config', () => {
    const existing = minimaxKeyed();
    const merged = mergeBootstrappedApiConfigs([existing]);
    expect(merged).toEqual([existing]);
  });

  it('does not inject or overwrite stale Aliyun rows', () => {
    const aliyun = staleAliyun();
    const merged = mergeBootstrappedApiConfigs([aliyun]);
    const leftover = merged.find((config) => config.id === 'aliyun-anthropic');
    expect(leftover?.apiKey).toBe('stale-key');
    expect(merged.some((config) => config.provider === 'minimax')).toBe(true);
  });

  it('skips stale Aliyun when choosing the active config, preferring MiniMax', () => {
    const configs = [staleAliyun(), minimaxKeyed()];
    expect(isStaleAliyunConfig(configs[0]!)).toBe(true);
    expect(resolvePreferredActiveConfigId(configs, 'aliyun-anthropic')).toBe('cfg-minimax');
  });

  it('remaps AutoResearch LLM settings off stale Aliyun onto MiniMax', () => {
    const configs = [staleAliyun(), minimaxKeyed()];
    const resolved = resolveAutoResearchLlmSettingsOnBoot({
      configs,
      stored: {
        defaultConfigId: 'aliyun-anthropic',
        agentConfigId: 'aliyun-anthropic',
        reflectionConfigId: 'aliyun-anthropic',
      },
      activeConfigId: 'aliyun-anthropic',
    });

    expect(resolved).toEqual({
      defaultConfigId: 'cfg-minimax',
      agentConfigId: 'cfg-minimax',
      reflectionConfigId: 'cfg-minimax',
    });
  });

  it('keeps a user MiniMax AutoResearch selection', () => {
    const configs = [minimaxKeyed(), staleAliyun()];
    const resolved = resolveAutoResearchLlmSettingsOnBoot({
      configs,
      stored: {
        defaultConfigId: 'cfg-minimax',
        agentConfigId: 'cfg-minimax',
        reflectionConfigId: null,
      },
      activeConfigId: 'cfg-minimax',
    });

    expect(resolved).toEqual({
      defaultConfigId: 'cfg-minimax',
      agentConfigId: 'cfg-minimax',
      reflectionConfigId: null,
    });
  });
});
