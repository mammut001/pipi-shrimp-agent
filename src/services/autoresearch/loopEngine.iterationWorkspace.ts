/**
 * AutoResearch Loop Engine — iteration workspace helpers.
 *
 * Extracted from `loopEngine.iterationPhase.ts` as part of AG-02 PR2b
 * follow-up. Owns configuration rewriting for the iteration checkout,
 * workspace rollback on failure/non-improvement, run status writing,
 * and artifact path discovery.
 */

import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { rollback } from './rollback';
import { writeTargetText, type RunDir } from './runDir';

export function buildIterationWorkspaceCfg(cfg: SshConfig, runDir: RunDir): SshConfig {
  return {
    ...cfg,
    remoteWorkDir: runDir.codeDir,
  };
}

export async function rollbackIterationWorkspace(
  cfg: SshConfig,
  iteration: number,
  runDir: RunDir,
  options: { terminal?: boolean; reason: string },
): Promise<{ success: boolean; message: string }> {
  useAutoResearchStore.getState().addRunEvent({
    level: 'info',
    phase: 'system',
    message: `rollback_started: iteration ${iteration} rollback requested.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
    },
  });

  const result = await rollback(cfg, { terminal: options.terminal ?? false });
  useAutoResearchStore.getState().addRunEvent({
    level: result.success ? 'info' : 'error',
    phase: 'system',
    message: result.success
      ? `rollback_completed: iteration ${iteration} workspace reverted.`
      : `rollback_failed: iteration ${iteration} workspace could not be reverted.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
      rollbackMessage: result.message,
    },
  });

  return result;
}

export async function writeRunStatus(
  cfg: SshConfig,
  runDir: RunDir,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeTargetText(cfg, runDir.statusPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function getRunArtifactPaths(runDir: RunDir): string[] {
  return [
    runDir.iterDir,
    runDir.systemPromptPath,
    runDir.hypothesisPath,
    runDir.diffPath,
    runDir.metricsPath,
    runDir.statusPath,
    runDir.reflectionInputPath,
    runDir.reflectionRawPath,
    runDir.reflectionParsedPath,
    runDir.transcriptPath,
    `${runDir.logsDir}/stdout.log`,
    `${runDir.logsDir}/stderr.log`,
    `${runDir.logsDir}/combined.log`,
  ];
}
