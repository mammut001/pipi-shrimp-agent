import {
  formatRuntimeTargetSummary,
  formatManualWorkspaceSummary,
  formatMetricIterationsSummary,
  parseConnectionCheckOutput,
} from './manual/manualFormatting';
import {
  type SshConfig,
} from '@/store/autoresearchStore';
import {
  getAutoResearchDefaultConfig,
} from '@/services/autoresearch/defaultConfig';

export function formatRuntimeSummary(cfg: SshConfig, locale: string): string {
  return formatRuntimeTargetSummary(cfg, locale);
}

export function formatWorkspaceSummary(workDir: string, expDir: string, locale: string): string {
  return formatManualWorkspaceSummary({ remoteWorkDir: workDir, experimentDir: expDir }, locale);
}

export function formatMetricSummary(metric: string, direction: 'lower' | 'higher', baseline: string, iterations: number, locale: string): string {
  return formatMetricIterationsSummary({ metric, direction, baselineInput: baseline, maxIter: iterations }, locale);
}

export function getPathBasename(path: string): string {
  if (!path) return '';
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function parseConnectionSuccessOutput(output: string): { platform: string; pwd: string; isGitRepo: boolean } {
  return parseConnectionCheckOutput(output);
}

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

/**
 * Extract a human-readable SSH error from the raw stderr/stdout of a
 * connection test. The raw output often contains WSL path warnings,
 * generic "Command timed out" suffixes, and sshpass boilerplate that
 * obscure the real failure reason.
 *
 * Priority order:
 *   1. Known SSH error patterns (Connection refused, Permission denied, etc.)
 *   2. Non-noise stderr lines
 *   3. stdout fallback
 *   4. Generic exit-code message
 */
export function extractSshError(stderr: string, stdout: string, exitCode: number): string {
  // Lines to ignore - they are informational, not errors.
  const NOISE_PATTERNS = [
    /^WSL will use a converted/i,
    /^Avoid mixing WSL/i,
    /^Command timed out after \d+ seconds$/i,
    /^\s*$/,
  ];

  const isNoise = (line: string): boolean =>
    NOISE_PATTERNS.some((pattern) => pattern.test(line.trim()));

  // Split stderr into lines, filter noise, and look for SSH-specific errors.
  const stderrLines = stderr.split('\n').filter((line) => !isNoise(line));

  // Known SSH/sshpass error patterns - prefer these over raw output.
  const SSH_ERROR_PATTERNS = [
    /connection timed out/i,
    /connection refused/i,
    /no route to host/i,
    /permission denied/i,
    /host key verification failed/i,
    /could not resolve hostname/i,
    /network is unreachable/i,
    /banner exchange/i,
    /ssh_exchange_identification/i,
    /kex_exchange_identification/i,
    /port \d+ timed out/i,
    /sshpass.*error/i,
    /invalid password/i,
  ];

  for (const line of stderrLines) {
    const trimmed = line.trim();
    if (SSH_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return trimmed;
    }
  }

  // No recognized SSH pattern - return the first meaningful stderr line.
  if (stderrLines.length > 0) {
    return stderrLines.join('\n');
  }

  // Fall back to stdout or generic message.
  if (stdout) {
    return stdout;
  }

  return `Connection test failed (exit ${exitCode})`;
}

// AUDIT-FIX [audit-1-ar#7]: Strict schema validation + explicit password strip.
// Two security/correctness concerns addressed here:
//   1. Field-by-field type validation. The previous implementation did
//      `return { ...fallback, ...parsed }` and trusted `parsed` to have
//      the right types. A future build that renames `remoteWorkDir` to
//      `workDir`, or writes `port` as a string, would silently break
//      the SSH flow downstream with a confusing error.
//   2. `password` is intentionally NEVER loaded. The persist effect
//      below strips it on write, but a stolen localStorage dump from
//      a previous build (before the strip was added) or an external
//      injection would otherwise replay credentials. We re-assert
//      `password: ''` here as a defense-in-depth measure.
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

  // Strict field whitelist: if a field is missing or has the wrong type we
  // fall back to the default value rather than letting garbage into the
  // form. Note `password` is intentionally NOT loaded from storage - we
  // never persist it (see the persist useEffect) and any stale value from
  // a previous build is explicitly scrubbed here as a defense-in-depth
  // measure.
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
      // SECURITY: password is never persisted. If a previous build wrote it
      // to localStorage (e.g. before the strip was added), explicitly drop
      // it on load so a stolen localStorage dump can't replay credentials.
      password: '',
    };
  } catch {
    return fallback;
  }
}
