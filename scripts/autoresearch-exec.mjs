#!/usr/bin/env node
/**
 * AutoResearch Harness — Non-Interactive Runner
 *
 * Usage:
 *   pnpm run autoresearch:exec -- \
 *     --repo <path> --workdir <path> --preset standard \
 *     --max-iterations 1 --json
 *
 * Behavior:
 *   - Validates --repo is a git repo (rejects non-git unless --allow-non-git).
 *   - Creates a run directory under <workdir>/runs/<sessionId>.
 *   - Runs preflight (best-effort, no Tauri).
 *   - Performs one self-improve harness cycle (verify-before → patch →
 *     verify-after → score → patch gate). If --dry-run is set the agent
 *     call is skipped and a synthetic v2 result is produced.
 *   - Writes result.json, events.jsonl, diff.patch, apply.md, revert.md.
 *   - Exits 0 on success, non-zero on harness/system failure.
 *   - Never requires the UI.
 *
 * This script is intentionally self-contained JavaScript — the same
 * harness logic is implemented in TypeScript for the UI / test suite
 * under src/services/autoresearch/{permissions,jsonlEventLog,patchGate,
 * selfImprove/}.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const USAGE = `Usage:
  pnpm run autoresearch:exec -- --repo <path> --workdir <path> \\
      [--preset standard] [--max-iterations 1] [--json] \\
      [--permission-profile workspace_write] [--allow-non-git] \\
      [--dry-run] [--session-id <id>] [--verification <cmd>...]
`;

const STANDARD_VERIFICATION = ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'];

// ─── Permission profile (mirror of src TS module) ────────────────────────────

const COMMON_DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*\s+|-[a-z]*r[a-z]*f[a-z]*\s+|--force\s+)/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bdd\s+if=/i,
  /\bshred\b/i,
  /\b:\(\)\s*\{[^}]*\}\s*;\s*:/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bchown\s+-R\s+root\b/i,
  /\bsudo\b/i,
  /\bsu\s+-?\s*root\b/i,
  /\b(wget|curl)\b[^\n]*\|\s*(bash|sh)\b/i,
  /\b(sh|bash|ksh|zsh)\s+-c\b[^]*\brm\s+-rf\s+\//i,
  /\b(format|mkfs\.fat|mkfs\.ext[234]|mkfs\.ntfs|parted|fdisk)\b/i,
  /\b(crontab|at)\b\s+-r\b/i,
];

const COMMON_FORBIDDEN_READ_PATHS = [
  '.git/config', '.git/credentials', '.netrc', '.npmrc', '.pypirc',
  '.ssh/id_rsa', '.ssh/id_ed25519', '.ssh/known_hosts', 'secrets/', 'credentials/',
];

const COMMON_WRITE_DENY_LIST = [
  '.git/config', '.git/hooks/', 'LICENSE', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
];

const PROFILE_CATALOG = {
  read_only: {
    id: 'read_only',
    allowedReadRoots: ['<workspace>'],
    allowedWriteRoots: [],
    forbiddenPaths: COMMON_FORBIDDEN_READ_PATHS,
    allowShellCommands: false,
    allowFileWrites: false,
    maxChangedFiles: 0,
    maxDiffBytes: 0,
    maxCommandTimeoutSecs: 0,
    dangerousCommandPatterns: COMMON_DANGEROUS_COMMAND_PATTERNS,
    writeDenyList: COMMON_WRITE_DENY_LIST,
  },
  workspace_write: {
    id: 'workspace_write',
    allowedReadRoots: ['<workspace>'],
    allowedWriteRoots: ['<iter_code_dir>', '<iter_run_dir>', '<session_run_dir>'],
    forbiddenPaths: COMMON_FORBIDDEN_READ_PATHS,
    allowShellCommands: true,
    allowFileWrites: true,
    maxChangedFiles: 25,
    maxDiffBytes: 512 * 1024,
    maxCommandTimeoutSecs: 600,
    dangerousCommandPatterns: COMMON_DANGEROUS_COMMAND_PATTERNS,
    writeDenyList: COMMON_WRITE_DENY_LIST,
  },
  danger_full_access: {
    id: 'danger_full_access',
    allowedReadRoots: ['<any>'],
    allowedWriteRoots: ['<any>'],
    forbiddenPaths: [],
    allowShellCommands: true,
    allowFileWrites: true,
    maxChangedFiles: 1000,
    maxDiffBytes: 0,
    maxCommandTimeoutSecs: 1800,
    dangerousCommandPatterns: [],
    writeDenyList: [],
  },
};

function getPermissionProfile(id) {
  return PROFILE_CATALOG[id] ?? PROFILE_CATALOG.workspace_write;
}

function checkCommand({ profile, command, requestedTimeoutSecs }) {
  if (!profile.allowShellCommands) {
    throw new Error(`[SHELL_DISABLED] Profile ${profile.id} does not allow shell commands.`);
  }
  for (const pattern of profile.dangerousCommandPatterns) {
    if (pattern.test(command)) {
      throw new Error(`[DANGEROUS_COMMAND] Command matches ${pattern.toString()}.`);
    }
  }
  const requested = requestedTimeoutSecs ?? profile.maxCommandTimeoutSecs;
  return { allowed: true, timeoutSecs: Math.min(requested, profile.maxCommandTimeoutSecs) };
}

function checkDiffSize({ profile, diffBytes }) {
  if (profile.maxDiffBytes > 0 && diffBytes > profile.maxDiffBytes) {
    throw new Error(`[DIFF_TOO_LARGE] Diff size ${diffBytes} exceeds profile limit ${profile.maxDiffBytes}.`);
  }
}

function checkChangedFiles({ profile, changedFiles }) {
  if (changedFiles.length > profile.maxChangedFiles) {
    throw new Error(`[TOO_MANY_CHANGED_FILES] ${changedFiles.length} > ${profile.maxChangedFiles}.`);
  }
}

function classifyCommandRisk(command) {
  const lower = command.toLowerCase();
  if (/\brm\s+-rf\s+\//i.test(lower) || /\bmkfs\b/i.test(lower) || /\bdd\s+if=/i.test(lower)) return 'high';
  if (/\brm\s+-rf\b/i.test(lower) || /\bchmod\s+777\b/i.test(lower) || /\bcurl\b[^\n]*\|\s*(bash|sh)\b/i.test(lower)) return 'high';
  if (/\bsudo\b/i.test(lower) || /\bsu\s+-?\s*root\b/i.test(lower)) return 'medium';
  if (/\brm\s+/.test(lower) || /\bchmod\s+/.test(lower) || /\bcurl\b/i.test(lower) || /\bwget\b/i.test(lower)) return 'medium';
  return 'low';
}

// ─── Secret redaction ────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9]{16,}\b/g, 'sk-[REDACTED]'],
  [/\bsk-ant-[A-Za-z0-9-]{8,}\b/g, 'sk-ant-[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]'],
  [/\bghp_[A-Za-z0-9]{16,}\b/g, 'ghp_[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]'],
];

const MAX_STRING_LEN = 4_000;

function redactString(value) {
  let result = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > MAX_STRING_LEN) {
    return `${result.slice(0, MAX_STRING_LEN)}…[truncated ${result.length - MAX_STRING_LEN} chars]`;
  }
  return result;
}

function redactSecrets(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactSecrets(v);
  return out;
}

// ─── JSONL event logger (file-backed) ────────────────────────────────────────

class JsonlEventLogger {
  constructor({ filePath, runId, mirrorPath = null }) {
    this.filePath = filePath;
    this.mirrorPath = mirrorPath;
    this.runId = runId;
    this.lineCount = 0;
    this.queue = Promise.resolve();
  }
  async append(event) {
    const line = `${JSON.stringify({ ts: event.ts ?? new Date().toISOString(), runId: this.runId, ...redactSecrets(event) })}\n`;
    this.lineCount += 1;
    this.queue = this.queue.then(async () => {
      await fs.appendFile(this.filePath, line, 'utf8');
      if (this.mirrorPath) {
        await fs.appendFile(this.mirrorPath, line, 'utf8');
      }
    });
    await this.queue;
  }
  async close() {
    await this.queue;
  }
}

async function createJsonlEventLogger({ runDir, runId }) {
  await fs.mkdir(runDir, { recursive: true });
  // Use the canonical `events.jsonl` name so the headless runner produces
  // the same artifact the UI writes. Also create `run.jsonl` as a copy
  // for any tooling that expects that name.
  const eventsPath = path.join(runDir, 'events.jsonl');
  const runPath = path.join(runDir, 'run.jsonl');
  await fs.writeFile(eventsPath, '', 'utf8');
  await fs.writeFile(runPath, '', 'utf8');
  return new JsonlEventLogger({ filePath: eventsPath, runId, mirrorPath: runPath });
}

// ─── Argv parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    repo: null,
    workdir: null,
    preset: 'standard',
    maxIterations: 1,
    json: false,
    permissionProfile: 'workspace_write',
    allowNonGit: false,
    dryRun: false,
    sessionId: null,
    verification: STANDARD_VERIFICATION,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--repo': out.repo = argv[++i]; break;
      case '--workdir': out.workdir = argv[++i]; break;
      case '--preset': out.preset = argv[++i]; break;
      case '--max-iterations': out.maxIterations = Number.parseInt(argv[++i], 10); break;
      case '--json': out.json = true; break;
      case '--permission-profile': out.permissionProfile = argv[++i]; break;
      case '--allow-non-git': out.allowNonGit = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--session-id': out.sessionId = argv[++i]; break;
      case '--verification':
        out.verification = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          out.verification.push(argv[++i]);
        }
        break;
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n${USAGE}\n`);
        process.exit(2);
    }
  }
  return out;
}

function assertSafeSessionId(id) {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`Invalid sessionId: ${JSON.stringify(id)}`);
  }
  return id;
}

// ─── Git helpers ─────────────────────────────────────────────────────────────

async function isGitRepo(repoPath) {
  try {
    await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

async function isDirty(repoPath) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'status', '--porcelain']);
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function captureDiff(repoPath, baselineRef) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'diff', baselineRef]);
    return stdout || '';
  } catch {
    return '';
  }
}

async function captureChangedFiles(repoPath, baselineRef) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'diff', '--name-only', baselineRef]);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function runVerification(repoPath, command) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return { command, exitCode: 0, durationMs: Date.now() - start, status: 'pass', stdout, stderr };
  } catch (error) {
    return {
      command,
      exitCode: error.code ?? 1,
      durationMs: Date.now() - start,
      status: 'fail',
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
    };
  }
}

// ─── Scoring (v2) ────────────────────────────────────────────────────────────

const SCORE_BUILD = 30, SCORE_TESTS = 30, SCORE_TYPECHECK = 20;
const SCORE_REGRESSION_TEST = 10;
const PENALTY_UNRELATED_DIR = 10;
const PENALTY_VERIFICATION_FAILED = 50;
const PENALTY_VERIFICATION_EXIT = 25;
const PENALTY_DIRTY_AFTER = 15;
const PENALTY_HIGH_RISK = 20;
const PENALTY_HIGH_RISK_COMMAND = 35;
const UNRELATED_DIR_THRESHOLD = 3;

function countDistinctDirectories(files) {
  const dirs = new Set();
  for (const file of files) {
    const lastSlash = file.lastIndexOf('/');
    if (lastSlash > 0) dirs.add(file.slice(0, lastSlash));
  }
  return dirs.size;
}

function hasRegressionTestFiles(files) {
  return files.some((file) =>
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || file.includes('__tests__/'),
  );
}

function computeSelfImproveScoreV2(result, options = {}) {
  const notes = [];
  let score = 0;

  if (options.resultJsonPresent === false) {
    return { score: -1000, status: 'FAILED', notes: ['no_result_json: result.json missing on disk; iteration is a hard failure.'] };
  }

  if (result.buildPassed === true) score += SCORE_BUILD;
  if (result.testsPassed === true) score += SCORE_TESTS;
  if (result.typecheckPassed === true) score += SCORE_TYPECHECK;

  if (result.verification) {
    for (const entry of result.verification) {
      if (entry.status === 'fail' || (entry.exitCode !== null && entry.exitCode !== 0)) {
        score -= PENALTY_VERIFICATION_EXIT;
        notes.push(`verification_failed: ${entry.command} exit=${entry.exitCode}`);
      }
    }
  }

  if (hasRegressionTestFiles(result.changedFiles ?? [])) score += SCORE_REGRESSION_TEST;

  const distinctDirs = countDistinctDirectories(result.changedFiles ?? []);
  if (distinctDirs > UNRELATED_DIR_THRESHOLD) {
    score -= (distinctDirs - UNRELATED_DIR_THRESHOLD) * PENALTY_UNRELATED_DIR;
  }

  if (result.buildPassed === false || result.testsPassed === false || result.typecheckPassed === false) {
    score -= PENALTY_VERIFICATION_FAILED;
  }

  if (result.workspace?.dirtyAfter) {
    score -= PENALTY_DIRTY_AFTER;
    notes.push('dirty_after: workspace remained dirty after iteration.');
  }

  const highRisk = (result.commandsRun ?? []).filter((c) => classifyCommandRisk(c) === 'high');
  if (highRisk.length > 0) {
    score -= PENALTY_HIGH_RISK_COMMAND;
    notes.push(`high_risk_command: ${highRisk[0]}`);
  }

  if (result.riskLevel === 'high') score -= PENALTY_HIGH_RISK;

  let diffMismatch = false;
  if (options.actualChangedFiles) {
    const claimed = [...(result.changedFiles ?? [])].sort();
    const actual = [...options.actualChangedFiles].sort();
    if (claimed.length !== actual.length || claimed.some((f, i) => f !== actual[i])) {
      diffMismatch = true;
      notes.push('changed_files_mismatch: result.changedFiles disagrees with diff.');
    }
  }

  const status = determineStatusV2(result, {
    score,
    hasHighRiskCommand: highRisk.length > 0,
    hasDiff: (result.patch?.addedLines ?? 0) + (result.patch?.deletedLines ?? 0) > 0,
    diffMismatch,
  });

  return { score, status, notes };
}

function determineStatusV2(result, ctx) {
  if (result.buildPassed === false || result.typecheckPassed === false) return 'FAILED';
  if (result.testsPassed === false) return 'NEEDS_REVIEW';
  if (ctx.hasHighRiskCommand) {
    return (result.changedFiles?.length ?? 0) > 0 ? 'NEEDS_REVIEW' : 'FAILED';
  }
  if (result.status === 'IMPROVED' && !ctx.hasDiff) return 'NEEDS_REVIEW';
  if (ctx.diffMismatch) return 'NEEDS_REVIEW';
  if (result.status === 'NEEDS_REVIEW') return 'NEEDS_REVIEW';
  if ((result.changedFiles?.length ?? 0) === 0 && ctx.score <= 0) return 'NO_CHANGE';
  if (ctx.score > 0) return 'IMPROVED';
  return 'NO_CHANGE';
}

function classifySelfImproveRiskLevel(changedFiles, commandsRun) {
  if (changedFiles.length > 10) return 'high';
  if (commandsRun.some((c) => classifyCommandRisk(c) === 'high')) return 'high';
  if (commandsRun.some((c) => classifyCommandRisk(c) === 'medium')) return 'medium';
  const dirs = countDistinctDirectories(changedFiles);
  if (changedFiles.length > 5 || dirs > 3) return 'medium';
  return 'low';
}

// ─── Diff utilities ──────────────────────────────────────────────────────────

function countDiffLines(diff) {
  let added = 0, deleted = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}

function diffHasChanges(diff) {
  return /^\+\+\+\s|^---\s/m.test(diff) && /^[+-]/m.test(diff);
}

function slugify(command) {
  return String(command).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cmd';
}

// ─── Patch gate writers ──────────────────────────────────────────────────────

async function writePatchGateArtifacts({ iterDir, diff, result, eventsPath, verificationLogs, originalRepoPath }) {
  const diffPath = path.join(iterDir, 'diff.patch');
  const resultPath = path.join(iterDir, 'result.json');
  const applyPath = path.join(iterDir, 'apply.md');
  const revertPath = path.join(iterDir, 'revert.md');
  const logsDir = path.join(iterDir, 'logs');
  const eventsDest = path.join(iterDir, 'events.jsonl');

  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(diffPath, diff, 'utf8');
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  if (eventsPath) {
    try {
      await fs.access(eventsPath);
      if (path.resolve(eventsPath) !== path.resolve(eventsDest)) {
        await fs.copyFile(eventsPath, eventsDest);
      }
    } catch {
      // events.jsonl is optional
    }
  }

  for (const entry of verificationLogs ?? []) {
    const safe = slugify(entry.command);
    await fs.writeFile(path.join(logsDir, `verify-${safe}.stdout.log`), entry.stdout, 'utf8');
    await fs.writeFile(path.join(logsDir, `verify-${safe}.stderr.log`), entry.stderr, 'utf8');
  }

  await fs.writeFile(applyPath, buildApplyMarkdown({ iterDir, diff, result, originalRepoPath }), 'utf8');
  await fs.writeFile(revertPath, buildRevertMarkdown({ iterDir }), 'utf8');
}

function buildApplyMarkdown({ iterDir, diff, result, originalRepoPath }) {
  const lines = [];
  lines.push('# Patch Gate — Apply Instructions');
  lines.push('');
  lines.push(`- Iteration dir: \`${iterDir}\``);
  lines.push(`- Diff: \`${path.join(iterDir, 'diff.patch')}\``);
  lines.push(`- Result: \`${path.join(iterDir, 'result.json')}\``);
  lines.push(`- Events: \`${path.join(iterDir, 'events.jsonl')}\``);
  if (originalRepoPath) lines.push(`- Original repo: \`${originalRepoPath}\``);
  lines.push('');
  lines.push('## Status');
  lines.push(`- status: \`${result.status}\``);
  lines.push(`- riskLevel: \`${result.riskLevel}\``);
  lines.push(`- changedFiles (${result.changedFiles?.length ?? 0}): ${(result.changedFiles ?? []).map((f) => `\`${f}\``).join(', ') || '_(none)_'}`);
  if (result.issue) {
    lines.push(`- issue.summary: ${result.issue.summary}`);
    lines.push(`- issue.category: \`${result.issue.category}\``);
    lines.push(`- issue.severity: \`${result.issue.severity}\``);
  }
  lines.push('');
  lines.push('## Default behavior');
  lines.push('The harness does **NOT** auto-apply the patch to the original repository.');
  lines.push('Review the diff and the verification logs below. Apply manually if you choose:');
  lines.push('');
  lines.push('```bash');
  if (originalRepoPath) {
    lines.push(`cd ${originalRepoPath}`);
    lines.push('git apply --check <diff.patch> && git apply <diff.patch>');
  } else {
    lines.push('# cd to your target repository first');
    lines.push('git apply --check <diff.patch> && git apply <diff.patch>');
  }
  lines.push('```');
  lines.push('');
  lines.push('## Diff preview');
  lines.push('```diff');
  lines.push(diff.slice(0, 4_000));
  if (diff.length > 4_000) lines.push('…[truncated]');
  lines.push('```');
  lines.push('');
  lines.push('## Sanitized summary');
  lines.push('```');
  lines.push(redactSecrets(result.summary));
  lines.push('```');
  return lines.join('\n');
}

function buildRevertMarkdown({ iterDir }) {
  return [
    '# Patch Gate — Revert Instructions',
    '',
    `- Iteration dir: \`${iterDir}\``,
    '',
    'To revert a patch that was already applied, run from the target repository:',
    '',
    '```bash',
    'git apply -R <diff.patch>',
    '```',
    '',
    'If the patch is staged or committed, use `git restore` / `git revert` accordingly.',
    '',
  ].join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo || !args.workdir) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
  if (!Number.isInteger(args.maxIterations) || args.maxIterations < 1) {
    process.stderr.write('--max-iterations must be a positive integer\n');
    process.exit(2);
  }

  const repoPath = path.resolve(args.repo);
  const workdir = path.resolve(args.workdir);
  const sessionId = assertSafeSessionId(args.sessionId ?? `cli-${Date.now()}`);

  const profile = getPermissionProfile(args.permissionProfile);
  if (!(args.permissionProfile in PROFILE_CATALOG)) {
    process.stderr.write(`Unknown permission profile "${args.permissionProfile}"; falling back to ${profile.id}.\n`);
  }

  const isRepo = await isGitRepo(repoPath);
  if (!isRepo && !args.allowNonGit) {
    process.stderr.write(`Refusing: ${repoPath} is not a git repository. Pass --allow-non-git to override.\n`);
    process.exit(3);
  }

  const sessionDir = path.join(workdir, 'runs', sessionId);
  const iterDirName = `iter-001-${new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')}`;
  const iterDir = path.join(sessionDir, iterDirName);
  await fs.mkdir(iterDir, { recursive: true });

  const logger = await createJsonlEventLogger({ runDir: iterDir, runId: sessionId });
  let exitCode = 0;

  try {
    await logger.append({ iteration: 1, phase: 'INIT', type: 'run.started', status: 'ok', data: {
      repo: repoPath, workdir, profile: profile.id, dryRun: args.dryRun, allowNonGit: args.allowNonGit,
    } });

    const dirtyBefore = await isDirty(repoPath);
    const baselineRef = isRepo ? 'HEAD' : undefined;
    await logger.append({ iteration: 1, phase: 'INIT', type: 'preflight.completed', status: 'ok', data: {
      isGitRepo: isRepo, dirtyBefore, baselineRef,
    } });

    // Run verification commands
    const verificationEntries = [];
    for (const cmd of args.verification) {
      const check = checkCommand({ profile, command: cmd, requestedTimeoutSecs: profile.maxCommandTimeoutSecs });
      await logger.append({ iteration: 1, phase: 'VERIFY', type: 'verification.started', status: 'ok', data: { command: cmd, timeoutSecs: check.timeoutSecs } });
      const result = args.dryRun
        ? { command: cmd, exitCode: 0, durationMs: 0, status: 'pass', stdout: '', stderr: '' }
        : await runVerification(repoPath, cmd);
      verificationEntries.push(result);
      await logger.append({ iteration: 1, phase: 'VERIFY', type: 'verification.completed', status: result.status === 'pass' ? 'ok' : 'error', data: { command: cmd, exitCode: result.exitCode, durationMs: result.durationMs } });
    }

    const ok = verificationEntries.every((v) => v.status === 'pass');
    const findPass = (pattern) => {
      const entry = verificationEntries.find((v) => pattern.test(v.command));
      if (!entry) return null;
      return entry.status === 'pass';
    };
    const result = {
      schemaVersion: 2,
      mode: 'repo_self_improve',
      iteration: 1,
      phaseResults: {
        AUDIT: { phase: 'AUDIT', success: true },
        PLAN: { phase: 'PLAN', success: true },
        PATCH: { phase: 'PATCH', success: false, output: args.dryRun ? 'dry-run: no patch applied' : 'no agent attached in this run' },
        VERIFY: { phase: 'VERIFY', success: ok, output: ok ? 'all checks passed' : 'one or more checks failed' },
        REFLECT: { phase: 'REFLECT', success: true },
        DECIDE_NEXT: { phase: 'DECIDE_NEXT', success: true },
      },
      changedFiles: [],
      commandsRun: verificationEntries.map((v) => v.command),
      buildPassed: findPass(/build/i),
      testsPassed: findPass(/test/i),
      typecheckPassed: findPass(/tsc/i),
      riskLevel: classifySelfImproveRiskLevel([], verificationEntries.map((v) => v.command)),
      status: ok ? 'NO_CHANGE' : 'NEEDS_REVIEW',
      summary: args.dryRun
        ? 'Dry-run: harness validated permissions and produced patch gate; no patch was applied.'
        : 'No agent was attached; this run only exercised the harness layer.',
      nextRecommendation: args.dryRun
        ? 'Run without --dry-run to perform a real iteration.'
        : 'Wire the agent call into this script to perform a real iteration.',
      issue: { summary: args.dryRun ? 'dry-run' : 'harness-only run', evidence: [], category: 'other', severity: 'info' },
      patch: { diffPath: 'diff.patch', addedLines: 0, deletedLines: 0, reverted: false },
      verification: verificationEntries.map((v) => ({
        command: v.command,
        exitCode: v.exitCode,
        durationMs: v.durationMs,
        status: v.status,
        stdoutPath: `logs/verify-${slugify(v.command)}.stdout.log`,
        stderrPath: `logs/verify-${slugify(v.command)}.stderr.log`,
      })),
      workspace: { dirtyBefore, dirtyAfter: false },
    };

    // Capture diff after running verification
    const diff = isRepo && !args.dryRun ? await captureDiff(repoPath, baselineRef) : '';
    const actualChangedFiles = isRepo && !args.dryRun ? await captureChangedFiles(repoPath, baselineRef) : [];
    const { added, deleted } = countDiffLines(diff);
    result.patch.addedLines = added;
    result.patch.deletedLines = deleted;
    result.changedFiles = actualChangedFiles;
    result.workspace.dirtyAfter = isRepo ? await isDirty(repoPath) : false;

    try {
      checkDiffSize({ profile, diffBytes: Buffer.byteLength(diff, 'utf8') });
    } catch (error) {
      await logger.append({ iteration: 1, phase: 'PATCH', type: 'permission.denied', status: 'error', data: { reason: String(error) } });
      result.status = 'FAILED';
      result.summary = `Diff size exceeds profile limit (${profile.id}).`;
    }
    try {
      checkChangedFiles({ profile, changedFiles: result.changedFiles });
    } catch (error) {
      await logger.append({ iteration: 1, phase: 'PATCH', type: 'permission.denied', status: 'error', data: { reason: String(error) } });
      result.status = 'FAILED';
      result.summary = `changedFiles count exceeds profile limit (${profile.id}).`;
    }

    const scoreOut = computeSelfImproveScoreV2(result, { resultJsonPresent: true, actualChangedFiles });
    result.status = scoreOut.status;
    result.decision = {
      status: scoreOut.status,
      score: scoreOut.score,
      nextRecommendation: result.nextRecommendation,
    };
    if (scoreOut.notes.length > 0) {
      await logger.append({ iteration: 1, phase: 'DECIDE_NEXT', type: 'guardrail.triggered', status: 'warn', data: { notes: scoreOut.notes } });
    }

    await writePatchGateArtifacts({
      iterDir,
      diff,
      result,
      eventsPath: logger.path,
      verificationLogs: verificationEntries.map((v) => ({ command: v.command, stdout: v.stdout, stderr: v.stderr })),
      originalRepoPath: repoPath,
    });

    await logger.append({ iteration: 1, phase: 'PATCH', type: 'patch.generated', status: 'ok', data: { addedLines: added, deletedLines: deleted, hasChanges: diffHasChanges(diff) } });
    await logger.append({ iteration: 1, phase: 'DONE', type: 'iteration.completed', status: result.status === 'IMPROVED' ? 'ok' : (result.status === 'FAILED' ? 'error' : 'warn'), data: { status: result.status, score: scoreOut.score } });
    await logger.append({ iteration: 1, phase: 'DONE', type: 'run.completed', status: 'ok', data: { status: result.status } });
  } catch (error) {
    exitCode = 4;
    await logger.append({ iteration: 1, phase: 'FAILED', type: 'run.failed', status: 'error', data: { reason: error instanceof Error ? error.message : String(error) } });
    process.stderr.write(`Harness failure: ${error instanceof Error ? error.message : error}\n`);
  } finally {
    await logger.close();
  }

  if (args.json) {
    const resultJson = await fs.readFile(path.join(iterDir, 'result.json'), 'utf8').catch(() => null);
    const payload = {
      runDir: iterDir,
      result: resultJson ? JSON.parse(resultJson) : null,
      exitCode,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`AUTO_RESEARCH_RUN_DIR=${iterDir}\n`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  process.stderr.write(`Unexpected error: ${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(5);
});
