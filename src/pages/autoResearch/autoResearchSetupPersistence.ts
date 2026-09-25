/**
 * AutoResearch setup persistence helpers.
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import type { SshConfig } from '@/store/autoresearchStore';
import { getAutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';

export const AUTORESEARCH_CONFIG_STORAGE_KEY = 'pipi-shrimp-autoresearch-ssh-config';

export interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

export type ConnectionTestState =
  | { status: 'idle'; output: string }
  | { status: 'testing'; output: string }
  | { status: 'success'; output: string }
  | { status: 'error'; output: string };

export function loadPersistedSetup(): SshConfig {
  const defaults = getAutoResearchDefaultConfig();
  const fallback: SshConfig = {
    mode: 'local',
    host: '',
    user: 'root',
    keyPath: '',
    port: 22,
    remoteWorkDir: defaults.workdir,
    authMode: 'agent',
    password: '',
  };

  const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
  const asNumber = (value: unknown, fallbackNumber: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallbackNumber;
  const asMode = (value: unknown): SshConfig['mode'] => (value === 'ssh' || value === 'local' ? value : 'local');
  const asAuthMode = (value: unknown): SshConfig['authMode'] =>
    value === 'agent' || value === 'password' || value === 'key' ? value : 'agent';

  try {
    const raw = localStorage.getItem(AUTORESEARCH_CONFIG_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const obj = parsed as Record<string, unknown>;
    return {
      mode: asMode(obj.mode),
      host: asString(obj.host),
      user: asString(obj.user) || 'root',
      keyPath: asString(obj.keyPath),
      port: asNumber(obj.port, 22),
      remoteWorkDir: asString(obj.remoteWorkDir) || defaults.workdir,
      authMode: asAuthMode(obj.authMode),
      password: '',
    };
  } catch {
    return fallback;
  }
}
