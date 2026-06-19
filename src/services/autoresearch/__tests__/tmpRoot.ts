import * as path from 'node:path';

const AUTORESEARCH_TEST_TMP_ROOT = path.resolve(process.cwd(), '.tmp', 'jest-autoresearch');

export function getAutoResearchTestTmpDir(): string {
  return AUTORESEARCH_TEST_TMP_ROOT;
}
