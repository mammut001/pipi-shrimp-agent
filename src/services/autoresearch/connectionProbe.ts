import { shellEscapePath } from '@/utils/remoteExec';

export function buildAutoResearchConnectionProbeCommand(experimentDir: string): string {
  const escapedExperimentDir = shellEscapePath(experimentDir);
  return [
    'uname -s',
    'pwd',
    `test -d ${escapedExperimentDir}`,
    "printf '__AUTORESEARCH_TARGET_OK__\\n'",
    `if git -C ${escapedExperimentDir} rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf 'git:ok\\n'; else printf 'git:missing\\n'; fi`,
  ].join(' && ');
}
