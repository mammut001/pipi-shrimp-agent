/**
 * Soft PR size check per docs/architecture/complexity-governance.md §7.
 * Emits a GitHub Actions ::warning:: when files > 20 OR net LOC > 800.
 * Always exits 0 (never a hard gate). Dry-run locally:
 *   node scripts/check-pr-size.mjs --base origin/main
 */

import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
let dryRun = false;
let cliBaseRef = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg === '--base' && i + 1 < args.length) {
    cliBaseRef = args[++i];
  } else if (arg.startsWith('--base=')) {
    cliBaseRef = arg.slice('--base='.length);
  } else if (!arg.startsWith('-') && !cliBaseRef) {
    cliBaseRef = arg;
  }
}

function gitOk(argv) {
  const r = spawnSync('git', argv, { encoding: 'utf-8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

if (gitOk(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  console.log('[check-pr-size] Not in a git repository. Skipping PR size check.');
  process.exit(0);
}

function resolveGitRef(ref) {
  if (!ref) return null;
  return gitOk(['rev-parse', '--verify', `${ref}^{commit}`]) ? ref : null;
}

let resolvedBase = null;

if (cliBaseRef) {
  resolvedBase = resolveGitRef(cliBaseRef) || resolveGitRef(`origin/${cliBaseRef}`);
  if (!resolvedBase) {
    console.log(`[check-pr-size] Explicit base ref '${cliBaseRef}' could not be resolved. Skipping check.`);
    process.exit(0);
  }
} else if (process.env.GITHUB_BASE_REF || process.env.PR_BASE_REF) {
  const envBaseRef = process.env.GITHUB_BASE_REF || process.env.PR_BASE_REF;
  resolvedBase = resolveGitRef(`origin/${envBaseRef}`) || resolveGitRef(envBaseRef);
  if (!resolvedBase) {
    console.log(`[check-pr-size] Base ref from environment '${envBaseRef}' could not be resolved. Skipping check.`);
    process.exit(0);
  }
} else {
  const defaultCandidates = ['origin/main', 'main', 'origin/master', 'master'];
  for (const cand of defaultCandidates) {
    if (resolveGitRef(cand)) {
      resolvedBase = cand;
      break;
    }
  }
}

if (!resolvedBase) {
  console.log('[check-pr-size] No valid base ref found and not in a PR context. Skipping check.');
  process.exit(0);
}

// Three-dot diff = changes on this branch since merge-base with base (PR shape).
const numstatOutput = gitOk(['diff', '--numstat', `${resolvedBase}...HEAD`]);
if (numstatOutput === null) {
  console.error('[check-pr-size] warning: git diff failed. Skipping check.');
  process.exit(0);
}

const compareLabel = gitOk(['merge-base', resolvedBase, 'HEAD']) || resolvedBase;

const lines = numstatOutput.split('\n').map((l) => l.trim()).filter(Boolean);

let totalAdditions = 0;
let totalDeletions = 0;
let filesChanged = 0;

for (const line of lines) {
  const parts = line.split('\t');
  if (parts.length >= 3) {
    filesChanged++;
    const addStr = parts[0].trim();
    const delStr = parts[1].trim();
    const added = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
    const deleted = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
    totalAdditions += added;
    totalDeletions += deleted;
  }
}

const netLOC = totalAdditions - totalDeletions;
const churn = totalAdditions + totalDeletions;

const MAX_RECOMMENDED_FILES = 20;
const MAX_RECOMMENDED_NET_LOC = 800;

const exceedsFiles = filesChanged > MAX_RECOMMENDED_FILES;
const exceedsNetLoc = netLOC > MAX_RECOMMENDED_NET_LOC;
const isOverSize = exceedsFiles || exceedsNetLoc;

console.log('==================================================');
console.log('PR Size Check (complexity-governance §7)');
console.log('==================================================');
if (dryRun) {
  console.log('Mode:            Dry-run');
}
console.log(`Base ref:        ${resolvedBase} (merge-base ${String(compareLabel).slice(0, 12)})`);
console.log(`Files changed:   ${filesChanged} (recommended limit: ≤ ${MAX_RECOMMENDED_FILES})`);
console.log(`Lines added:     +${totalAdditions}`);
console.log(`Lines deleted:   -${totalDeletions}`);
console.log(`Net LOC:         ${netLOC >= 0 ? '+' : ''}${netLOC} (recommended limit: ≤ ${MAX_RECOMMENDED_NET_LOC})`);
console.log(`Total churn:     ${churn}`);
console.log('--------------------------------------------------');

if (isOverSize) {
  const violations = [];
  if (exceedsFiles) {
    violations.push(`${filesChanged} files changed (exceeds ${MAX_RECOMMENDED_FILES})`);
  }
  if (exceedsNetLoc) {
    violations.push(`${netLOC} net LOC (exceeds ${MAX_RECOMMENDED_NET_LOC})`);
  }

  console.log(`Status:          WARNING (${violations.join(', ')})`);
  console.log('Recommendation:  Consider splitting this PR into smaller stacks per docs/architecture/complexity-governance.md §7.');
  console.log('==================================================');

  const warningMsg = `PR size exceeds recommended thresholds: ${violations.join(', ')}. Consider splitting into smaller PRs per docs/architecture/complexity-governance.md §7.`;
  console.log(`::warning::${warningMsg}`);
} else {
  console.log('Status:          PASSED (within recommended thresholds)');
  console.log('==================================================');
}

process.exit(0);
