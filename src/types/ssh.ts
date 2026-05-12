/**
 * Shared SSH Types
 *
 * Centralized SSH configuration types used across the codebase.
 * Previously duplicated in SshTool.ts and autoresearchStore.ts.
 */

export type ExecMode = 'local' | 'ssh';
export type SshAuthMode = 'agent' | 'password' | 'key';

export interface SshConfig {
  mode: ExecMode;
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
  authMode: SshAuthMode;
  password: string;
}

export function withSshConfigDefaults(partial: Partial<SshConfig> | null | undefined): SshConfig {
  return {
    mode: partial?.mode ?? 'ssh',
    host: partial?.host ?? '',
    user: partial?.user ?? '',
    keyPath: partial?.keyPath ?? '',
    port: partial?.port ?? 22,
    remoteWorkDir: partial?.remoteWorkDir ?? '',
    authMode: partial?.authMode ?? 'agent',
    password: partial?.password ?? '',
  };
}
