/**
 * PageAgent Configuration
 * Maps settingsStore provider config to PageAgent-compatible format
 */

import type { ApiConfig } from '../store/settingsStore';

/**
 * Get default base URL for each provider
 */
export function getDefaultBaseUrl(provider: ApiConfig['provider']): string {
  switch (provider) {
    case 'minimax':
      return 'https://api.minimaxi.com/v1';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      // Anthropic uses a different API structure, but PageAgent uses OpenAI-compatible format
      // We'll use the Anthropic API with the OpenAI compatibility layer
      return 'https://api.anthropic.com/v1';
    case 'custom':
      // Custom requires explicit baseUrl in the config
      return '';
    default:
      return '';
  }
}

/**
 * Convert settings config to PageAgent config
 */
export function getPageAgentConfig(config: ApiConfig | null): {
  baseURL: string;
  apiKey: string;
  model: string;
  language: string;
} | null {
  if (!config) return null;

  const baseURL = config.baseUrl || getDefaultBaseUrl(config.provider);
  const apiKey = config.apiKey;
  const model = config.model;

  if (!baseURL || !apiKey || !model) {
    console.warn('PageAgent config incomplete:', { baseURL, apiKey, model });
    return null;
  }

  return {
    baseURL,
    apiKey,
    model,
    language: 'zh-CN',
  };
}
