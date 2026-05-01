import { describe, expect, it } from '@jest/globals';
import {
  API_PROVIDERS,
  DEFAULT_API_CONFIG,
  PROVIDER_MODELS,
} from '../../../types/settings';
import {
  getProvider,
  getProviderDefaultModelId,
  getProviderDefaultModelIds,
  getProviderNames,
  resolvePricing,
} from '../index';

describe('provider registry single source of truth', () => {
  it('drives the legacy provider constants from the registry', () => {
    expect(API_PROVIDERS).toEqual(getProviderNames());

    for (const provider of getProviderNames()) {
      expect(PROVIDER_MODELS[provider]).toEqual(getProviderDefaultModelIds(provider));
    }
  });

  it('uses the registry default model for the default API config', () => {
    expect(DEFAULT_API_CONFIG.model).toBe(getProviderDefaultModelId(DEFAULT_API_CONFIG.provider));
  });

  it('keeps first-party default models and pricing aligned', () => {
    for (const providerName of getProviderNames()) {
      const provider = getProvider(providerName);
      expect(provider).not.toBeNull();

      for (const modelId of getProviderDefaultModelIds(providerName)) {
        expect(resolvePricing(modelId, providerName)).toEqual(provider?.defaultPricing[modelId]);
      }
    }
  });
});
