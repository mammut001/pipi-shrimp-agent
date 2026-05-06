import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';

export function sanitizePathInput(value: string, options?: { trim?: boolean }): string {
  const sanitized = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\uFFFD/g, '');

  return options?.trim ? sanitized.trim() : sanitized;
}

export function isHorizontalArrowKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight';
}

export function resolveInitialExperimentDir(storedExperimentDir?: string | null, currentWorkDir?: string | null): string {
  return sanitizePathInput(storedExperimentDir || currentWorkDir || '', { trim: true });
}

export function resolveAutoResearchLaunchPaths(input: {
  experimentDir: string;
  workDir: string;
  sessionId: string;
}): {
  experimentDir: string;
  workDir: string;
  sessionFilePath: string;
  livingDocPath: string;
} {
  const workDir = sanitizePathInput(input.workDir, { trim: true });
  return {
    experimentDir: sanitizePathInput(input.experimentDir, { trim: true }),
    workDir,
    sessionFilePath: getAutoResearchSessionFilePathFromWorkDir(workDir),
    livingDocPath: getAutoResearchLivingDocPathFromWorkDir(workDir, input.sessionId),
  };
}
