/**
 * remoteExec — shared helpers for AutoResearch / SshTool.
 *
 * Builds a single bash-one-liner string that can be handed to the Rust
 * `execute_bash` command, regardless of whether the target is:
 *   - local (no SSH),
 *   - remote via SSH agent / authorized_keys (no -i, no password),
 *   - remote via SSH key (-i <keyPath>),
 *   - remote via SSH password (sshpass -e with SSHPASS env var).
 *
 * Password is never placed into argv (ps-visible). Callers must never log
 * the returned command string.
 */

import { invoke } from '@tauri-apps/api/core';

export type ExecMode = 'local' | 'ssh';
export type SshAuthMode = 'agent' | 'password' | 'key';

export interface RemoteExecConfig {
  mode: ExecMode;
  host: string;
  user: string;
  port: number;
  authMode: SshAuthMode;
  keyPath: string;
  password: string;
  remoteWorkDir: string;
}

/** POSIX single-quote escape. Wraps s in '…' and escapes embedded '. */
export function shellEscape(s: string): string {
  return "'" + String(s ?? '').replace(/'/g, "'\\''") + "'";
}

function defaultCfg(partial: Partial<RemoteExecConfig>): RemoteExecConfig {
  return {
    mode: partial.mode ?? 'ssh',
    host: partial.host ?? '',
    user: partial.user ?? '',
    port: partial.port ?? 22,
    authMode: partial.authMode ?? 'agent',
    keyPath: partial.keyPath ?? '',
    password: partial.password ?? '',
    remoteWorkDir: partial.remoteWorkDir ?? '',
  };
}

/**
 * Build the ssh/scp command prefix (the part that precedes the remote
 * command or the source path). Returns an object with:
 *   - `prefix` string to prepend, and
 *   - `envPrefix` (e.g. `SSHPASS='…' `) to prepend for password mode.
 *
 * Not exported — only used internally.
 */
function buildSshArgs(cfg: RemoteExecConfig, binary: 'ssh' | 'scp'): {
  prefix: string;
  envPrefix: string;
} {
  const port = cfg.port || 22;
  const base: string[] = [];

  base.push(binary);
  base.push('-o', 'StrictHostKeyChecking=accept-new');
  base.push('-o', 'ConnectTimeout=10');

  // Force password-only when authMode=password so we don't silently fall
  // through to a stale agent key on mismatch.
  if (cfg.authMode === 'password') {
    base.push('-o', 'PreferredAuthentications=password');
    base.push('-o', 'PubkeyAuthentication=no');
  }

  if (cfg.authMode === 'key' && cfg.keyPath) {
    base.push('-i', shellEscape(cfg.keyPath));
  }

  // ssh uses -p, scp uses -P.
  base.push(binary === 'scp' ? '-P' : '-p', String(port));

  const prefix = base.join(' ');

  if (cfg.authMode === 'password') {
    const envPrefix = `SSHPASS=${shellEscape(cfg.password)} sshpass -e `;
    return { prefix, envPrefix };
  }

  return { prefix, envPrefix: '' };
}

/**
 * Build a full bash command that runs `remoteCmd` in the configured
 * working directory on the target (local or remote). Returned string is
 * suitable for `execute_bash { command }`.
 */
export function buildRemoteBashCommand(
  raw: Partial<RemoteExecConfig>,
  remoteCmd: string,
): string {
  const cfg = defaultCfg(raw);
  const wd = cfg.remoteWorkDir ? `cd ${shellEscape(cfg.remoteWorkDir)} && ` : '';
  const inner = `${wd}${remoteCmd}`;

  if (cfg.mode === 'local') {
    // Run directly in a local shell. execute_bash already wraps with `bash -c`.
    return inner;
  }

  // SSH path.
  const { prefix, envPrefix } = buildSshArgs(cfg, 'ssh');
  const target = `${shellEscape(cfg.user)}@${shellEscape(cfg.host)}`;
  return `${envPrefix}${prefix} ${target} ${shellEscape(inner)}`;
}

/**
 * Build an upload command: local→local is a cp, otherwise scp (optionally
 * via sshpass for password auth).
 */
export function buildUploadCommand(
  raw: Partial<RemoteExecConfig>,
  localPath: string,
  dstPath: string,
): string {
  const cfg = defaultCfg(raw);
  if (cfg.mode === 'local') {
    return `cp -f ${shellEscape(localPath)} ${shellEscape(dstPath)}`;
  }

  const { prefix, envPrefix } = buildSshArgs(cfg, 'scp');
  const target = `${shellEscape(cfg.user)}@${shellEscape(cfg.host)}:${shellEscape(dstPath)}`;
  return `${envPrefix}${prefix} ${shellEscape(localPath)} ${target}`;
}

/**
 * Short, non-sensitive description of the target — safe to show in UI /
 * prompts. Never contains the password.
 */
export function describeTarget(raw: Partial<RemoteExecConfig>): string {
  const cfg = defaultCfg(raw);
  if (cfg.mode === 'local') {
    return `local:${cfg.remoteWorkDir || '(cwd)'}`;
  }
  return `ssh(${cfg.authMode}) ${cfg.user}@${cfg.host}:${cfg.port || 22} ${cfg.remoteWorkDir || ''}`.trim();
}

// ---- sshpass availability check ----

let _sshpassCache: { ok: boolean; hint?: string } | null = null;

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

/**
 * Check once whether `sshpass` is on PATH. Required only when
 * authMode='password'. Result is cached for the session.
 */
export async function ensureSshpassAvailable(): Promise<{ ok: boolean; hint?: string }> {
  if (_sshpassCache) return _sshpassCache;
  try {
    const result = await invoke<RawBashResult>('execute_bash', {
      command: 'command -v sshpass >/dev/null 2>&1 && echo OK || echo MISSING',
    });
    const ok = (result.stdout || '').trim() === 'OK';
    _sshpassCache = ok
      ? { ok: true }
      : {
          ok: false,
          hint:
            'sshpass not found on PATH. Install via: brew install hudochenkov/sshpass/sshpass (macOS) or apt-get install sshpass (Linux).',
        };
    return _sshpassCache;
  } catch (e) {
    _sshpassCache = { ok: false, hint: `sshpass detection failed: ${(e as Error).message}` };
    return _sshpassCache;
  }
}

/** Reset the cache (for tests). */
export function _resetSshpassCacheForTests(): void {
  _sshpassCache = null;
}
