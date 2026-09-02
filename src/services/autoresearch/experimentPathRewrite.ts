/**
 * AutoResearch keeps artifacts under the workspace (e.g. ~/autoresearch)
 * and a per-iteration code snapshot under iterDir/code. Agents still often
 * pass the original experimentDir (e.g. /tmp/harness-smoke). Rewrite those
 * paths onto the iteration checkout so file tools stay inside the bound cwd.
 */

const PATH_ARGUMENT_KEYS = [
  'path',
  'cwd',
  'file_path',
  'filePath',
  'workDir',
  'work_dir',
  'directory',
  'dir',
  'remotePath',
  'remoteWorkDir',
] as const;

const RELATIVE_EXPERIMENT_FILE = /^(?:\.\.?\/)?(?:configs\/)?(?:train\.py|eval\.py|run_experiment\.py|AUTORESEARCH\.md|metrics\.json|README\.md|requirements\.txt|index\.ts)$/i;

function trimSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function normalizeForCompare(value: string): string {
  return trimSlash(value).replace(/\\/g, '/');
}

function isPathWithin(child: string, parent: string): boolean {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return Boolean(c) && Boolean(p) && (c === p || c.startsWith(`${p}/`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { isAbsoluteOrHomePath } from './pathInput';

function isWorkspaceDot(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  return !trimmed || trimmed === '.' || trimmed === './';
}

export function rewriteExperimentPath(
  value: string,
  experimentDir: string,
  codeDir: string,
  iterDir?: string,
): string {
  if (!value.trim()) {
    return value;
  }
  if (iterDir && isPathWithin(value, iterDir)) {
    return value;
  }
  if (isPathWithin(value, codeDir)) {
    return value;
  }

  const source = normalizeForCompare(experimentDir);
  const target = trimSlash(codeDir).replace(/\\/g, '/');
  const candidate = normalizeForCompare(value);
  if (!source || !target || source === target) {
    return value;
  }

  const runsPrefix = `${source}/runs`;
  if (candidate === runsPrefix || candidate.startsWith(`${runsPrefix}/`)) {
    return value;
  }

  if (candidate === source) {
    return target;
  }
  if (candidate.startsWith(`${source}/`)) {
    return `${target}${candidate.slice(source.length)}`;
  }
  return value;
}

/** Replace experimentDir prefixes inside a command or other free-form string. */
export function rewriteEmbeddedExperimentPaths(
  value: string,
  experimentDir: string,
  codeDir: string,
  iterDir?: string,
): string {
  if (!value) {
    return value;
  }

  const source = normalizeForCompare(experimentDir);
  const target = trimSlash(codeDir).replace(/\\/g, '/');
  if (!source || !target || source === target) {
    return value;
  }

  const raw = trimSlash(experimentDir);
  const patterns = source === normalizeForCompare(raw) ? [raw, source] : [raw];
  let next = value;
  for (const token of [...new Set(patterns)]) {
    if (!token) {
      continue;
    }
    next = next.replace(
      new RegExp(`${escapeRegExp(token)}(?=/|\\\\|$|[\\s"'\`])`, 'g'),
      (match: string, offset: number, haystack: string) => {
        const rest = haystack.slice(offset + match.length);
        if (rest.startsWith('/runs') || rest.startsWith('\\runs')) {
          return match;
        }
        const reconstructed = `${match}${rest.split(/[\s"']/, 1)[0] ?? ''}`;
        if (iterDir && isPathWithin(reconstructed, iterDir)) {
          return match;
        }
        return target;
      },
    );
  }
  return next;
}

/**
 * Map a required experiment file onto the iteration checkout.
 * Falls back to `<codeDir>/<basename>` when prefix rewrite cannot apply.
 */
export function mapExperimentFileToCheckout(
  filePath: string,
  experimentDir: string,
  codeDir: string,
  iterDir?: string,
): string {
  if (!filePath.trim()) {
    return trimSlash(codeDir);
  }
  if (isPathWithin(filePath, codeDir) || (iterDir && isPathWithin(filePath, iterDir))) {
    return trimSlash(filePath).replace(/\\/g, '/');
  }
  const rewritten = rewriteExperimentPath(filePath, experimentDir, codeDir, iterDir);
  if (rewritten !== filePath) {
    return rewritten;
  }
  const base = filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return base ? `${trimSlash(codeDir).replace(/\\/g, '/')}/${base}` : trimSlash(codeDir);
}

function bindRelativeExperimentPath(value: string, codeDir: string): string {
  const trimmed = value.trim();
  if (isWorkspaceDot(trimmed)) {
    return trimSlash(codeDir);
  }
  if (isAbsoluteOrHomePath(trimmed)) {
    return trimmed;
  }
  if (RELATIVE_EXPERIMENT_FILE.test(trimmed.replace(/\\/g, '/'))) {
    return `${trimSlash(codeDir).replace(/\\/g, '/')}/${trimmed.replace(/^\.\//, '')}`;
  }
  return trimmed;
}

export function rewriteAutoResearchToolArguments(
  args: Record<string, unknown>,
  input: { experimentDir?: string; codeDir?: string; iterDir?: string },
): Record<string, unknown> {
  const experimentDir = input.experimentDir?.trim();
  const codeDir = input.codeDir?.trim();
  const iterDir = input.iterDir?.trim();
  if (!experimentDir || !codeDir) {
    return args;
  }

  const next = { ...args };
  for (const key of PATH_ARGUMENT_KEYS) {
    const value = next[key];
    if (typeof value !== 'string') {
      continue;
    }
    if (isWorkspaceDot(value)) {
      next[key] = trimSlash(codeDir);
      continue;
    }
    const boundRelative = bindRelativeExperimentPath(value, codeDir);
    next[key] = rewriteExperimentPath(boundRelative, experimentDir, codeDir, iterDir);
  }
  const command = next.command;
  if (typeof command === 'string' && command.trim()) {
    next.command = rewriteEmbeddedExperimentPaths(command, experimentDir, codeDir, iterDir);
    const rawCwd = next.cwd;
    const cwdMissing = typeof rawCwd !== 'string' || isWorkspaceDot(rawCwd);
    const workDirMissing = typeof next.work_dir !== 'string' && typeof next.workDir !== 'string';
    if (
      cwdMissing
      && workDirMissing
      && /\brun_experiment\.py\b/.test(command)
    ) {
      next.cwd = trimSlash(codeDir);
    }
  }
  return next;
}
