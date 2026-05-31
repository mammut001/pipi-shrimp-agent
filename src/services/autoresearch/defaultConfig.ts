import { sanitizePathInput } from './pathInput';

export interface AutoResearchDefaultConfig {
  workdir: string;
  experimentDir: string;
  metric: string;
  direction: 'higher' | 'lower';
  iterations: number;
  mode: 'ml_experiment' | 'repo_self_improve';
  verificationCommands: string[];
}

export type AutoResearchDefaultSource = 'defaults' | 'last-used';
type AutoResearchDefaultConfigInput = Partial<Record<keyof AutoResearchDefaultConfig, unknown>>;

export const AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY = 'pipi-shrimp-autoresearch-last-used-config-v1';
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 50;

export type VerificationPresetId = 'fast' | 'standard' | 'full' | 'custom';

export interface VerificationPreset {
  id: VerificationPresetId;
  label: string;
  description: string;
  commands: string[];
}

export const VERIFICATION_PRESETS: VerificationPreset[] = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'Build check only',
    commands: ['pnpm run build'],
  },
  {
    id: 'standard',
    label: 'Standard',
    description: 'Build + test + typecheck',
    commands: ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
  },
  {
    id: 'full',
    label: 'Full',
    description: 'Build + test + typecheck + lint',
    commands: ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit', 'pnpm run lint'],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Define your own commands',
    commands: [],
  },
];

export const DEFAULT_VERIFICATION_PRESET: VerificationPresetId = 'standard';

export function resolveVerificationPresetId(commands: string[]): VerificationPresetId {
  const trimmed = commands.map(c => c.trim()).filter(Boolean);
  for (const preset of VERIFICATION_PRESETS) {
    if (preset.id === 'custom') continue;
    if (
      trimmed.length === preset.commands.length &&
      trimmed.every((cmd, i) => cmd === preset.commands[i])
    ) {
      return preset.id;
    }
  }
  return 'custom';
}

export function resolveVerificationCommands(presetId: VerificationPresetId, customCommands?: string[]): string[] {
  if (presetId === 'custom') {
    return (customCommands ?? []).map(c => c.trim()).filter(Boolean);
  }
  const preset = VERIFICATION_PRESETS.find(p => p.id === presetId);
  return preset?.commands ?? VERIFICATION_PRESETS.find(p => p.id === DEFAULT_VERIFICATION_PRESET)!.commands;
}

export const AUTORESEARCH_FALLBACK_CONFIG: AutoResearchDefaultConfig = {
  workdir: '~/autoresearch',
  experimentDir: '~/Documents/tiny-autoresearch-digits',
  metric: 'cv_accuracy',
  direction: 'higher',
  iterations: 5,
  mode: 'ml_experiment',
  verificationCommands: ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
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

function normalizeMode(value: unknown): 'ml_experiment' | 'repo_self_improve' {
  if (typeof value === 'string' && value === 'repo_self_improve') {
    return 'repo_self_improve';
  }
  return 'ml_experiment';
}

function normalizeVerificationCommands(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return AUTORESEARCH_FALLBACK_CONFIG.verificationCommands;
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 10); // Max 10 commands
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
    mode: normalizeMode(input?.mode),
    verificationCommands: normalizeVerificationCommands(input?.verificationCommands),
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
