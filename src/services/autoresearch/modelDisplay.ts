/**
 * AutoResearch Model Display Helpers
 *
 * Centralized formatting of provider/model labels for AutoResearch UI.
 * Ensures consistent display across run history, dashboard, chips, and detail views.
 */

import { t } from '@/i18n';
import type { AutoResearchAgentConfigSnapshot } from './errors';
import type { ResolvedAgentConfig } from '@/services/agentConfig';

export interface AutoResearchModelDisplay {
  /** Human-readable provider label, e.g. "OpenAI" */
  providerLabel: string;
  /** Provider ID used internally, e.g. "openai" */
  providerId: string;
  /** Human-readable model label, e.g. "GPT-4.1" */
  modelLabel: string;
  /** Config name if available, e.g. "My Config" */
  configName?: string;
  /** Compact single-line label, e.g. "My Config · OpenAI · GPT-4.1" */
  compactLabel: string;
  /** Whether this is a demo/fallback run */
  isDemo: boolean;
}

/**
 * Build a model display object from a resolved agent config (used at startup).
 */
export function buildAutoResearchModelDisplayFromResolvedConfig(
  config: ResolvedAgentConfig | null,
): AutoResearchModelDisplay {
  if (!config) {
    return createUnknownModelDisplay();
  }

  const providerLabel = resolveProviderLabel(config.providerLabel, config.provider);
  const modelLabel = resolveModelLabel(config.model);
  const configName = normalizeText(config.name);

  return {
    providerLabel,
    providerId: config.provider,
    modelLabel,
    configName,
    compactLabel: formatCompactLabel({
      configName,
      providerLabel,
      providerId: config.provider,
      modelLabel,
    }),
    isDemo: false,
  };
}

/**
 * Build a model display object from a run's config snapshot (used in history/UI).
 */
export function buildAutoResearchModelDisplayFromSnapshot(
  snapshot: AutoResearchAgentConfigSnapshot | null | undefined,
): AutoResearchModelDisplay {
  if (!snapshot) {
    return createUnknownModelDisplay();
  }

  const isDemo = snapshot.source === 'fallback';
  const providerLabel = resolveProviderLabel(snapshot.providerLabel, snapshot.provider);
  const modelLabel = resolveModelLabel(snapshot.model);
  const configName = normalizeText(snapshot.configName);

  return {
    providerLabel,
    providerId: snapshot.provider,
    modelLabel,
    configName,
    compactLabel: formatCompactLabel({
      configName,
      providerLabel,
      providerId: snapshot.provider,
      modelLabel,
    }),
    isDemo,
  };
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveProviderLabel(providerLabel: string | null | undefined, providerId: string | null | undefined): string {
  const normalizedLabel = normalizeText(providerLabel);
  if (normalizedLabel) {
    return normalizedLabel;
  }

  const normalizedProviderId = normalizeText(providerId);
  if (normalizedProviderId) {
    return normalizedProviderId;
  }

  return t('autoresearch.model.unknownProvider');
}

function resolveModelLabel(modelLabel: string | null | undefined): string {
  const normalizedModel = normalizeText(modelLabel);
  if (normalizedModel) {
    return normalizedModel;
  }

  return t('autoresearch.model.unknownModel');
}

function areSameLabel(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function formatCompactLabel(input: {
  configName?: string;
  providerLabel: string;
  providerId: string;
  modelLabel: string;
}): string {
  const parts: string[] = [];
  if (input.configName && !areSameLabel(input.configName, input.providerLabel)) {
    parts.push(input.configName);
  }

  if (!areSameLabel(input.providerLabel, input.providerId)) {
    parts.push(input.providerLabel);
  } else if (input.providerLabel) {
    parts.push(input.providerLabel);
  }

  if (!areSameLabel(input.modelLabel, input.providerLabel) && !areSameLabel(input.modelLabel, input.configName)) {
    parts.push(input.modelLabel);
  }

  const compactLabel = parts.filter(Boolean).join(' · ');
  if (compactLabel) {
    return compactLabel;
  }

  if (!provider || provider.trim().length === 0) {
    return t('autoresearch.model.unknownProvider');
  }

  return t('autoresearch.model.unknownCompact');
}

/**
 * Create the unknown/unconfigured model display.
 */
function createUnknownModelDisplay(): AutoResearchModelDisplay {
  return {
    providerLabel: t('autoresearch.model.unknownProvider'),
    providerId: 'unknown',
    modelLabel: t('autoresearch.model.unknownModel'),
    configName: undefined,
    compactLabel: t('autoresearch.model.unknownCompact'),
    isDemo: false,
  };
}

/**
 * Format model display with options.
 */
export function formatAutoResearchModelDisplay(
  display: AutoResearchModelDisplay,
  options: { compact?: boolean } = {},
): string {
  if (options.compact) {
    return display.compactLabel;
  }

  if (display.configName && !areSameLabel(display.configName, display.providerLabel)) {
    return `${display.configName} · ${display.providerLabel} · ${display.modelLabel}`;
  }

  return `${display.providerLabel} · ${display.modelLabel}`;
}