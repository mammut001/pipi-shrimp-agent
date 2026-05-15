import { withSshConfigDefaults, type SshConfig } from '@/types/ssh';
import type { AutoResearchResumeToken } from './history';

function sanitizeResumeSshConfig(cfg: SshConfig): SshConfig {
  const normalized = withSshConfigDefaults(cfg);
  return {
    ...normalized,
    password: '',
  };
}

export function isAutoResearchResumeSupported(cfg: SshConfig): boolean {
  return cfg.mode === 'local' || cfg.authMode !== 'password';
}

export function createAutoResearchResumeToken(input: {
  sessionId: string;
  sshConfig: SshConfig;
  experimentDir: string;
  sessionFilePath?: string;
  livingDocPath?: string;
  metricName: string;
  metricDirection: 'higher' | 'lower';
  maxIterations: number;
  baseline?: number | null;
  createdAt: string;
}): AutoResearchResumeToken {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    status: 'running',
    sshConfig: sanitizeResumeSshConfig(input.sshConfig),
    experimentDir: input.experimentDir,
    sessionFilePath: input.sessionFilePath,
    livingDocPath: input.livingDocPath,
    metricName: input.metricName,
    metricDirection: input.metricDirection,
    maxIterations: input.maxIterations,
    baseline: input.baseline ?? null,
    currentIteration: 0,
    pendingIteration: 1,
    replayIteration: false,
    resumable: isAutoResearchResumeSupported(input.sshConfig),
    createdAt: input.createdAt,
    lastUpdatedAt: input.createdAt,
  };
}

export function patchAutoResearchResumeToken(
  token: AutoResearchResumeToken | undefined,
  patch: Partial<Omit<AutoResearchResumeToken, 'schemaVersion' | 'sessionId' | 'createdAt'>>,
  updatedAt = new Date().toISOString(),
): AutoResearchResumeToken | undefined {
  if (!token) {
    return undefined;
  }

  return {
    ...token,
    ...patch,
    sshConfig: patch.sshConfig ? sanitizeResumeSshConfig(patch.sshConfig) : token.sshConfig,
    currentIteration: patch.currentIteration === undefined
      ? token.currentIteration
      : Math.max(0, patch.currentIteration),
    pendingIteration: patch.pendingIteration === undefined
      ? token.pendingIteration
      : Math.max(1, patch.pendingIteration),
    lastUpdatedAt: updatedAt,
  };
}

export function sanitizeAutoResearchResumeSshConfig(cfg: SshConfig): SshConfig {
  return sanitizeResumeSshConfig(cfg);
}

export default createAutoResearchResumeToken;