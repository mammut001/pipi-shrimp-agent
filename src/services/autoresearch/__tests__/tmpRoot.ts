import * as path from 'node:path';

export function getAutoResearchTestTmpDir(): string {
  const workerId = process.env.JEST_WORKER_ID || '1';
  return path.resolve(process.cwd(), '.tmp', 'jest-autoresearch', `w-${workerId}`);
}
