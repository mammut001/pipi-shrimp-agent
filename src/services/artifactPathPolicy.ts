/**
 * Shared artifact path root policy for detected and direct registration.
 *
 * Project Folder (`workDir`) and PiPi Output Folder (`outputDir`) are the
 * only allowed roots; paths outside both are rejected.
 */

import { isWithinDir } from '@/utils/pathSecurity';

export type ArtifactRootKind = 'workDir' | 'outputDir';

export interface ArtifactRoot {
  kind: ArtifactRootKind;
  path: string;
}

export type ArtifactRootOptions = {
  workDir?: string | null;
  outputDir?: string | null;
};

export const ARTIFACT_PATH_OUTSIDE_ROOTS = 'Artifact path is outside allowed roots.';

export type ArtifactPathValidationResult =
  | { ok: true; rootKind: ArtifactRootKind; resolvedPath: string }
  | { ok: false; reason: string };

/** Normalize `.` / `..` segments lexically before root-boundary checks. */
export function normalizeLexicalPath(p: string): string {
  const usesBackslash = p.includes('\\');
  const parts = p.split(/[/\\]/).filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  const winDrive = /^[A-Za-z]:/.exec(p)?.[0];
  if (winDrive) {
    const tail = resolved.slice(1).join(usesBackslash ? '\\' : '/');
    return tail ? `${winDrive}${usesBackslash ? '\\' : '/'}${tail}` : winDrive;
  }

  const prefix = p.startsWith('/') ? '/' : '';
  return prefix + resolved.join('/');
}

export function getAllowedArtifactRoots(options: {
  workDir?: string;
  outputDir?: string;
}): ArtifactRoot[] {
  const roots: ArtifactRoot[] = [];
  const workDir = options.workDir?.trim();
  const outputDir = options.outputDir?.trim();
  if (workDir) {
    roots.push({ kind: 'workDir', path: normalizeLexicalPath(workDir) });
  }
  if (outputDir) {
    roots.push({ kind: 'outputDir', path: normalizeLexicalPath(outputDir) });
  }
  return roots;
}

export function isPathInsideAnyArtifactRoot(path: string, roots: ArtifactRoot[]): boolean {
  return validateArtifactPathWithinAllowedRoots(path, {}, roots).ok;
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

function joinRootAndRelative(rootPath: string, relativePath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const trimmedRoot = rootPath.replace(/[\\/]+$/, '');
  return normalizeLexicalPath(`${trimmedRoot}${sep}${relativePath}`);
}

export function validateArtifactPathWithinAllowedRoots(
  artifactPath: string,
  roots: ArtifactRootOptions,
  precomputedAllowedRoots?: ArtifactRoot[],
): ArtifactPathValidationResult {
  const trimmed = artifactPath?.trim();
  if (!trimmed) {
    return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
  }

  const allowedRoots = precomputedAllowedRoots ?? getAllowedArtifactRoots({
    workDir: roots.workDir ?? undefined,
    outputDir: roots.outputDir ?? undefined,
  });

  if (allowedRoots.length === 0) {
    return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
  }

  const candidates: string[] = isAbsolutePath(trimmed)
    ? [trimmed]
    : allowedRoots.map((root) => joinRootAndRelative(root.path, trimmed));

  for (const candidate of candidates) {
    const normalized = normalizeLexicalPath(candidate);
    for (const root of allowedRoots) {
      if (isWithinDir(normalized, root.path)) {
        return { ok: true, rootKind: root.kind, resolvedPath: normalized };
      }
    }
  }

  return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
}