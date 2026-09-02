/**
 * Provider runtime helpers — pure functions for capability-driven UI and validation.
 *
 * All provider-specific branching in Settings / store should go through these
 * functions instead of ad-hoc if/else chains. Adding a new provider only
 * requires updating registry.ts — no changes here or in consumers.
 */

import { getProvider } from './registry';
import type { ApiFormat } from './registry';

// ===== Capability queries =====

/** Whether this provider requires an API key to operate */
export function isApiKeyRequired(provider: string): boolean {
  return getProvider(provider)?.requiresApiKey ?? true;
}

/** Whether this provider requires a Base URL to be configured */
export function isBaseUrlRequired(provider: string): boolean {
  return getProvider(provider)?.requiresBaseUrl ?? false;
}

/** Whether the Base URL field should be visible in the UI */
export function shouldShowBaseUrl(provider: string): boolean {
  return getProvider(provider)?.showBaseUrl ?? false;
}

/** Whether this provider supports fetching models from a remote endpoint */
export function canFetchModels(provider: string): boolean {
  return getProvider(provider)?.supportsModelFetch ?? false;
}

/** Whether this provider supports custom/free-text model IDs (compatible gateways) */
export function supportsCustomModel(provider: string): boolean {
  return getProvider(provider)?.supportsCustomModel ?? (
    provider === 'openai-compatible' || provider === 'anthropic-compatible'
  );
}

// ===== Resolution helpers =====

/**
 * Resolve the effective Base URL for a config.
 * If the provider has a `defaultBaseUrl` and the user hasn't supplied one,
 * falls back to the registry default.
 */
export function resolveConfigBaseUrl(provider: string, inputBaseUrl: string): string {
  if (inputBaseUrl.trim()) return inputBaseUrl.trim();
  return getProvider(provider)?.defaultBaseUrl ?? '';
}

/**
 * Resolve the API format for a config.
 *
 * For first-party providers (anthropic/openai/minimax/gemini/deepseek) the
 * wire format is fixed by the provider's endpoint, so we always return ''
 * and let the Rust backend auto-detect. This deliberately IGNORES any
 * saved `currentApiFormat` for first-party providers — a config that says
 * `provider=minimax + apiFormat=anthropic` would otherwise be sent to the
 * MiniMax OpenAI-compatible endpoint with Anthropic /v1/messages wire format
 * and fail every request.
 *
 * For `-compatible` providers the format is pinned to the declared default
 * (the user cannot change it).
 */
export function resolveConfigApiFormat(
  provider: string,
  currentApiFormat: string,
): ApiFormat | '' {
  // Compatible providers: pin to the declared format.
  if (provider === 'anthropic-compatible') return 'anthropic';
  if (provider === 'openai-compatible') return 'openai';

  const providerDef = getProvider(provider);
  // First-party providers: always auto-detect on the backend. Ignore any
  // saved apiFormat so a stale/mismatched value can't break the request.
  if (providerDef && !provider.includes('compatible')) return '';

  return providerDef?.defaultApiFormat ?? '';
}

// ===== Validation helpers =====

export interface ProviderValidationErrors {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Validate provider-specific required fields.
 * Returns an error map; empty object means valid.
 */
export function validateProviderFields(
  provider: string,
  apiKey: string,
  baseUrl: string,
): ProviderValidationErrors {
  const errors: ProviderValidationErrors = {};

  if (isApiKeyRequired(provider) && !apiKey.trim()) {
    errors.apiKey = 'API key is required';
  }

  if (isBaseUrlRequired(provider) && !baseUrl.trim()) {
    errors.baseUrl = 'Base URL is required for this provider';
  }

  return errors;
}

/**
 * Validate pre-conditions for fetching models.
 * Returns an error map; empty object means OK to proceed.
 */
export function validateFetchModelsPrereqs(
  provider: string,
  apiKey: string,
  baseUrl: string,
): ProviderValidationErrors {
  const errors: ProviderValidationErrors = {};

  if (!canFetchModels(provider)) {
    // Callers should hide the button, but guard here too
    return errors;
  }

  if (isApiKeyRequired(provider) && !apiKey.trim()) {
    errors.apiKey = 'API key required to fetch models';
  }

  if (isBaseUrlRequired(provider) && !baseUrl.trim()) {
    errors.baseUrl = 'Base URL required to fetch models';
  }

  return errors;
}
