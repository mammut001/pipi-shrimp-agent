import { workflowService } from '@/services/workflow';

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

export function normalizeWorkflowRunRelativePath(relativePath: string): string {
  const normalized = relativePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    throw new Error('Workflow run file path cannot be empty.');
  }
  if (isAbsolutePath(normalized)) {
    throw new Error('Workflow run files must use relative paths.');
  }

  const segments = normalized.split('/');
  const safeSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error('Workflow run files cannot escape the run directory.');
    }
    safeSegments.push(segment);
  }

  if (safeSegments.length === 0) {
    throw new Error('Workflow run file path cannot resolve to the run directory root.');
  }

  return safeSegments.join('/');
}

export function resolveWorkflowRunFilePath(runDirectory: string, relativePath: string): string {
  const normalizedRunDirectory = runDirectory.trim().replace(/[\\/]+$/, '');
  if (!normalizedRunDirectory || !isAbsolutePath(normalizedRunDirectory)) {
    throw new Error('Workflow run directory must be an absolute path.');
  }

  return `${normalizedRunDirectory}/${normalizeWorkflowRunRelativePath(relativePath)}`;
}

export const workflowRunFileService = {
  resolvePath(runDirectory: string, relativePath: string): string {
    return resolveWorkflowRunFilePath(runDirectory, relativePath);
  },

  async writeRunFile(runDirectory: string, relativePath: string, content: string): Promise<string> {
    const absolutePath = resolveWorkflowRunFilePath(runDirectory, relativePath);
    await workflowService.writeFile(absolutePath, content);
    return absolutePath;
  },
};