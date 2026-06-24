/**
 * Filesystem-backed canonical path resolution for artifact containment.
 * Node/Jest uses fs.realpathSync; Tauri production uses the
 * `canonicalize_artifact_path` command via async validation.
 */

import { normalizeLexicalPath } from '@/services/artifactPathPolicy';

export type RealPathResolver = (path: string) => string | null;

function getPathModule(): typeof import('node:path') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:path') as typeof import('node:path');
  } catch {
    return null;
  }
}

function getFsModule(): typeof import('node:fs') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs') as typeof import('node:fs');
  } catch {
    return null;
  }
}

/** Resolve an artifact path to its canonical real path when it exists on disk. */
export function resolveCanonicalArtifactPath(
  targetPath: string,
  resolveRealPath: RealPathResolver,
): string | null {
  const direct = resolveRealPath(targetPath);
  if (direct) {
    return normalizeLexicalPath(direct);
  }

  const pathMod = getPathModule();
  if (!pathMod) {
    return null;
  }

  let ancestor = targetPath;
  const suffix: string[] = [];
  while (ancestor && ancestor !== pathMod.dirname(ancestor)) {
    const canonicalAncestor = resolveRealPath(ancestor);
    if (canonicalAncestor) {
      const joined = suffix.length > 0
        ? pathMod.join(canonicalAncestor, ...suffix)
        : canonicalAncestor;
      return normalizeLexicalPath(joined);
    }

    const name = pathMod.basename(ancestor);
    if (!name || name === '.') {
      break;
    }
    suffix.unshift(name);
    ancestor = pathMod.dirname(ancestor);
  }

  return null;
}

/**
 * Node-only resolver for tests and other non-browser runtimes.
 * Returns null when Node fs is unavailable (browser bundle).
 */
export function createNodeRealPathResolver(): RealPathResolver | null {
  const fs = getFsModule();
  if (!fs || typeof process === 'undefined' || !process.versions?.node) {
    return null;
  }

  return (targetPath: string): string | null => {
    try {
      if (fs.existsSync(targetPath)) {
        return fs.realpathSync.native(targetPath);
      }
      return null;
    } catch {
      return null;
    }
  };
}

let cachedDefaultResolver: RealPathResolver | null | undefined;

export function getDefaultRealPathResolver(): RealPathResolver | null {
  if (cachedDefaultResolver === undefined) {
    cachedDefaultResolver = createNodeRealPathResolver();
  }
  return cachedDefaultResolver;
}

export function resetDefaultRealPathResolverForTests(): void {
  cachedDefaultResolver = undefined;
}

export function pathExistsOnDisk(targetPath: string): boolean {
  const fs = getFsModule();
  if (!fs) {
    return false;
  }
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}