import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const skillPairs = [
  {
    label: 'resume SKILL.md',
    source: 'src/skills/resume/SKILL.md',
    mirror: 'src-tauri/skills/resume/SKILL.md',
  },
];

async function readNormalized(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return content.replace(/\r\n/g, '\n');
}

export async function checkSkillSync() {
  const failures = [];

  for (const pair of skillPairs) {
    const [sourceContent, mirrorContent] = await Promise.all([
      readNormalized(pair.source),
      readNormalized(pair.mirror),
    ]);

    if (sourceContent !== mirrorContent) {
      failures.push(
        `${pair.label} drift detected: ${pair.source} does not match ${pair.mirror}`,
      );
    }
  }

  return failures;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isDirectRun) {
  const failures = await checkSkillSync();

  if (failures.length > 0) {
    console.error('[skill-sync] Skill sync check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('[skill-sync] Skill sync check passed.');
}