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
] as const;

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

function shouldRewriteExperimentOntoCheckout(experimentDir: string, codeDir: string): boolean {
  const source = normalizeForCompare(experimentDir);
  const target = normalizeForCompare(codeDir);
  if (!source || !target || source === target) {
    return false;
  }
  // Snapshot lives inside experimentDir (workspace === experiment). Rewriting
  // would double-prefix iteration paths such as iterDir/hypothesis.md.
  if (isPathWithin(codeDir, experimentDir)) {
    return false;
  }
  return true;
}

export function rewriteExperimentPath(
  value: string,
  experimentDir: string,
  codeDir: string,
): string {
  if (!value.trim() || !shouldRewriteExperimentOntoCheckout(experimentDir, codeDir)) {
    return value;
  }
  if (isPathWithin(value, codeDir)) {
    return value;
  }

  const source = normalizeForCompare(experimentDir);
  const target = trimSlash(codeDir).replace(/\\/g, '/');
  const candidate = normalizeForCompare(value);
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
): string {
  if (!value || !shouldRewriteExperimentOntoCheckout(experimentDir, codeDir)) {
    return value;
  }

  const source = normalizeForCompare(experimentDir);
  const target = trimSlash(codeDir).replace(/\\/g, '/');
  const raw = trimSlash(experimentDir);
  const patterns = source === normalizeForCompare(raw) ? [raw, source] : [raw];
  let next = value;
  for (const token of [...new Set(patterns)]) {
    if (!token) {
      continue;
    }
    next = next.replace(
      new RegExp(`${escapeRegExp(token)}(?=/|\\\\|$|[\\s"'\`])`, 'g'),
      target,
    );
  }
  return next;
}

/**
 * Map a required experiment file onto the iteration checkout.
 * Falls back to `<codeDir>/<basename>` when prefix rewrite is skipped.
 */
export function mapExperimentFileToCheckout(
  filePath: string,
  experimentDir: string,
  codeDir: string,
): string {
  if (!filePath.trim()) {
    return trimSlash(codeDir);
  }
  if (isPathWithin(filePath, codeDir)) {
    return trimSlash(filePath).replace(/\\/g, '/');
  }
  const rewritten = rewriteExperimentPath(filePath, experimentDir, codeDir);
  if (rewritten !== filePath) {
    return rewritten;
  }
  const base = filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return base ? `${trimSlash(codeDir).replace(/\\/g, '/')}/${base}` : trimSlash(codeDir);
}

export function rewriteAutoResearchToolArguments(
  args: Record<string, unknown>,
  input: { experimentDir?: string; codeDir?: string },
): Record<string, unknown> {
  const experimentDir = input.experimentDir?.trim();
  const codeDir = input.codeDir?.trim();
  if (!experimentDir || !codeDir || !shouldRewriteExperimentOntoCheckout(experimentDir, codeDir)) {
    return args;
  }

  const next = { ...args };
  for (const key of PATH_ARGUMENT_KEYS) {
    const value = next[key];
    if (typeof value === 'string' && value.trim()) {
      next[key] = rewriteExperimentPath(value, experimentDir, codeDir);
    }
  }
  if (typeof next.command === 'string' && next.command.trim()) {
    next.command = rewriteEmbeddedExperimentPaths(next.command, experimentDir, codeDir);
  }
  return next;
}
