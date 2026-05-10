import { sanitizePathInput } from './pathInput';

export interface AutoResearchDefaultConfig {
  workdir: string;
  experimentDir: string;
  metric: string;
  direction: 'higher' | 'lower';
  iterations: number;
}

export type AutoResearchDefaultSource = 'defaults' | 'last-used';
type AutoResearchDefaultConfigInput = Partial<Record<keyof AutoResearchDefaultConfig, unknown>>;

export const AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY = 'pipi-shrimp-autoresearch-last-used-config-v1';
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 50;

export const AUTORESEARCH_FALLBACK_CONFIG: AutoResearchDefaultConfig = {
  workdir: '~/autoresearch',
  experimentDir: '~/Documents/tiny-autoresearch-digits',
  metric: 'cv_accuracy',
  direction: 'higher',
  iterations: 5,
};

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const sanitized = sanitizePathInput(value, { trim: true });
  return sanitized.length > 0 ? sanitized : fallback;
}

function normalizeMetric(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeIterations(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, rounded));
}

function readInjectedString(globalKey: string, compiledValue: string | null | undefined): string | null {
  if (typeof compiledValue === 'string' && compiledValue.trim().length > 0) {
    return compiledValue;
  }

  if (typeof globalThis === 'undefined') {
    return null;
  }

  const runtimeValue = (globalThis as Record<string, unknown>)[globalKey];
  return typeof runtimeValue === 'string' && runtimeValue.trim().length > 0
    ? runtimeValue
    : null;
}

function getInjectedConfig(): AutoResearchDefaultConfigInput {
  return {
    workdir: readInjectedString(
      '__AUTORESEARCH_DEFAULT_WORKDIR__',
      typeof __AUTORESEARCH_DEFAULT_WORKDIR__ === 'string' ? __AUTORESEARCH_DEFAULT_WORKDIR__ : null,
    ) ?? undefined,
    experimentDir: readInjectedString(
      '__AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__',
      typeof __AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__ === 'string' ? __AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__ : null,
    ) ?? undefined,
    metric: readInjectedString(
      '__AUTORESEARCH_DEFAULT_METRIC__',
      typeof __AUTORESEARCH_DEFAULT_METRIC__ === 'string' ? __AUTORESEARCH_DEFAULT_METRIC__ : null,
    ) ?? undefined,
    direction: readInjectedString(
      '__AUTORESEARCH_DEFAULT_DIRECTION__',
      typeof __AUTORESEARCH_DEFAULT_DIRECTION__ === 'string' ? __AUTORESEARCH_DEFAULT_DIRECTION__ : null,
    ) ?? undefined,
    iterations: readInjectedString(
      '__AUTORESEARCH_DEFAULT_ITERATIONS__',
      typeof __AUTORESEARCH_DEFAULT_ITERATIONS__ === 'string' ? __AUTORESEARCH_DEFAULT_ITERATIONS__ : null,
    ) ?? undefined,
  };
}

export function normalizeDirection(value: unknown): 'higher' | 'lower' {
  if (typeof value !== 'string') {
    return 'higher';
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'lower' ? 'lower' : 'higher';
}

export function normalizeAutoResearchDefaultConfig(
  input?: AutoResearchDefaultConfigInput | null,
): AutoResearchDefaultConfig {
  return {
    workdir: sanitizeString(input?.workdir, AUTORESEARCH_FALLBACK_CONFIG.workdir),
    experimentDir: sanitizeString(input?.experimentDir, AUTORESEARCH_FALLBACK_CONFIG.experimentDir),
    metric: normalizeMetric(input?.metric, AUTORESEARCH_FALLBACK_CONFIG.metric),
    direction: normalizeDirection(input?.direction ?? AUTORESEARCH_FALLBACK_CONFIG.direction),
    iterations: normalizeIterations(input?.iterations, AUTORESEARCH_FALLBACK_CONFIG.iterations),
  };
}

export function buildAutoResearchDefaultConfig(input: AutoResearchDefaultConfigInput): AutoResearchDefaultConfig {
  return normalizeAutoResearchDefaultConfig(input);
}

export function getAutoResearchDefaultConfig(): AutoResearchDefaultConfig {
  return normalizeAutoResearchDefaultConfig({
    ...AUTORESEARCH_FALLBACK_CONFIG,
    ...getInjectedConfig(),
  });
}

export function resolveAutoResearchDefaultConfig(
  lastUsedConfig: AutoResearchDefaultConfig | null | undefined,
): {
  config: AutoResearchDefaultConfig;
  source: AutoResearchDefaultSource;
} {
  if (lastUsedConfig) {
    return {
      config: normalizeAutoResearchDefaultConfig(lastUsedConfig),
      source: 'last-used',
    };
  }

  return {
    config: getAutoResearchDefaultConfig(),
    source: 'defaults',
  };
}

export function loadPersistedAutoResearchLastUsedConfig(): AutoResearchDefaultConfig | null {
  const storage = safeLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeAutoResearchDefaultConfig(JSON.parse(raw) as AutoResearchDefaultConfigInput);
  } catch {
    return null;
  }
}

export function persistAutoResearchLastUsedConfig(config: AutoResearchDefaultConfig | null): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    if (!config) {
      storage.removeItem(AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY);
      return;
    }

    storage.setItem(
      AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY,
      JSON.stringify(normalizeAutoResearchDefaultConfig(config)),
    );
  } catch (error) {
    console.error('Failed to persist AutoResearch default config:', error);
  }
}
