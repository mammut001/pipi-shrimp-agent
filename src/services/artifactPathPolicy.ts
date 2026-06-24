/**
 * Shared artifact path root policy for detected and direct registration.
 *
 * Project Folder (`workDir`) and PiPi Output Folder (`outputDir`) are the
 * only allowed roots; paths outside both are rejected.
 *
 * Lexical normalization is always applied first. When a real-path resolver is
 * available, existing files are checked via canonical paths so symlink escapes
 * are rejected (R7-02). Future generated paths that do not exist yet remain
 * allowed only when lexical containment holds and the nearest existing parent
 * is canonically inside an allowed root.
 */

import { isWithinDir } from '@/utils/pathSecurity';
import {
  pathExistsOnDisk,
  resolveCanonicalArtifactPath,
  type RealPathResolver,
} from '@/services/artifactPathCanonical';

export type ArtifactRootKind = 'workDir' | 'outputDir';

export interface ArtifactRoot {
  kind: ArtifactRootKind;
  path: string;
}

export type ArtifactRootOptions = {
  workDir?: string | null;
  outputDir?: string | null;
};

export type ArtifactPathValidationMode = 'existing-file' | 'future-output';

export interface ArtifactPathValidationOptions {
  mode?: ArtifactPathValidationMode;
  resolveRealPath?: RealPathResolver | null;
}

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

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

function joinRootAndRelative(rootPath: string, relativePath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const trimmedRoot = rootPath.replace(/[\\/]+$/, '');
  return normalizeLexicalPath(`${trimmedRoot}${sep}${relativePath}`);
}

function getParentPath(p: string): string | null {
  const normalized = normalizeLexicalPath(p);
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx <= 0) {
    return null;
  }
  return normalized.slice(0, idx);
}

function validateArtifactPathLexically(
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

function resolveCanonicalRootPath(
  rootPath: string,
  resolveRealPath: RealPathResolver,
): string {
  return resolveCanonicalArtifactPath(rootPath, resolveRealPath)
    ?? normalizeLexicalPath(rootPath);
}

function matchCanonicalPathToRoot(
  canonicalPath: string,
  allowedRoots: ArtifactRoot[],
  resolveRealPath: RealPathResolver,
): ArtifactPathValidationResult {
  for (const root of allowedRoots) {
    const canonicalRoot = resolveCanonicalRootPath(root.path, resolveRealPath);
    if (isWithinDir(canonicalPath, canonicalRoot)) {
      return { ok: true, rootKind: root.kind, resolvedPath: canonicalPath };
    }
  }
  return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
}

function validateFutureOutputWithCanonicalParent(
  lexical: Extract<ArtifactPathValidationResult, { ok: true }>,
  allowedRoots: ArtifactRoot[],
  resolveRealPath: RealPathResolver,
): ArtifactPathValidationResult {
  let parent = getParentPath(lexical.resolvedPath);
  while (parent) {
    const canonicalParent = resolveCanonicalArtifactPath(parent, resolveRealPath);
    if (canonicalParent) {
      const parentMatch = matchCanonicalPathToRoot(canonicalParent, allowedRoots, resolveRealPath);
      if (!parentMatch.ok) {
        return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
      }
      return lexical;
    }
    parent = getParentPath(parent);
  }

  // No on-disk ancestor (unit tests, paths not yet materialized): lexical only.
  return lexical;
}

function validateArtifactPathWithCanonicalResolver(
  lexical: Extract<ArtifactPathValidationResult, { ok: true }>,
  allowedRoots: ArtifactRoot[],
  resolveRealPath: RealPathResolver,
  mode: ArtifactPathValidationMode,
): ArtifactPathValidationResult {
  const canonicalArtifact = resolveCanonicalArtifactPath(lexical.resolvedPath, resolveRealPath);
  if (canonicalArtifact) {
    return matchCanonicalPathToRoot(canonicalArtifact, allowedRoots, resolveRealPath);
  }

  if (mode === 'existing-file' && pathExistsOnDisk(lexical.resolvedPath)) {
    return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
  }

  return validateFutureOutputWithCanonicalParent(lexical, allowedRoots, resolveRealPath);
}

export function isPathInsideAnyArtifactRoot(path: string, roots: ArtifactRoot[]): boolean {
  return validateArtifactPathWithinAllowedRoots(path, {}, roots).ok;
}

export function validateArtifactPathWithinAllowedRoots(
  artifactPath: string,
  roots: ArtifactRootOptions,
  precomputedAllowedRoots?: ArtifactRoot[],
  options?: ArtifactPathValidationOptions,
): ArtifactPathValidationResult {
  const lexical = validateArtifactPathLexically(artifactPath, roots, precomputedAllowedRoots);
  if (!lexical.ok) {
    return lexical;
  }

  const resolveRealPath = options?.resolveRealPath;
  if (!resolveRealPath) {
    return lexical;
  }

  const allowedRoots = precomputedAllowedRoots ?? getAllowedArtifactRoots({
    workDir: roots.workDir ?? undefined,
    outputDir: roots.outputDir ?? undefined,
  });
  const mode = options?.mode ?? 'existing-file';

  return validateArtifactPathWithCanonicalResolver(lexical, allowedRoots, resolveRealPath, mode);
}

async function tauriCanonicalizeArtifactPath(
  artifactPath: string,
  roots: ArtifactRootOptions,
): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('canonicalize_artifact_path', {
      path: artifactPath,
      workDir: roots.workDir ?? null,
      outputDir: roots.outputDir ?? null,
    });
  } catch {
    return null;
  }
}

export async function validateArtifactPathWithinAllowedRootsAsync(
  artifactPath: string,
  roots: ArtifactRootOptions,
  options?: ArtifactPathValidationOptions,
): Promise<ArtifactPathValidationResult> {
  const lexical = validateArtifactPathLexically(artifactPath, roots);
  if (!lexical.ok) {
    return lexical;
  }

  if (options?.resolveRealPath) {
    return validateArtifactPathWithinAllowedRoots(
      artifactPath,
      roots,
      undefined,
      options,
    );
  }

  const canonical = await tauriCanonicalizeArtifactPath(lexical.resolvedPath, roots);
  if (canonical) {
    const allowedRoots = getAllowedArtifactRoots({
      workDir: roots.workDir ?? undefined,
      outputDir: roots.outputDir ?? undefined,
    });
    for (const root of allowedRoots) {
      if (isWithinDir(normalizeLexicalPath(canonical), root.path)) {
        return { ok: true, rootKind: root.kind, resolvedPath: normalizeLexicalPath(canonical) };
      }
    }
    return { ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS };
  }

  // No filesystem canonicalization (unit tests, pre-materialized paths): lexical policy.
  return validateArtifactPathWithinAllowedRoots(artifactPath, roots, undefined, {
    ...options,
    resolveRealPath: null,
  });
}