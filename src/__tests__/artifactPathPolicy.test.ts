import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { addFileArtifact } from '../services/artifactDetector';
import {
  ARTIFACT_PATH_OUTSIDE_ROOTS,
  validateArtifactPathWithinAllowedRoots,
} from '../services/artifactPathPolicy';
import { createNodeRealPathResolver } from '../services/artifactPathCanonical';
import { useArtifactsStore } from '../store/artifactsStore';

jest.mock('../store/artifactsStore', () => {
  const mockAddArtifact = jest.fn(() => 'artifact-id-1');
  return {
    useArtifactsStore: {
      getState: () => ({
        addArtifact: mockAddArtifact,
      }),
    },
  };
});

jest.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}), { virtual: true });

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function canCreateSymlinks(): boolean {
  const base = makeTempDir('pipi-symlink-probe-');
  try {
    const target = path.join(base, 'target.txt');
    fs.writeFileSync(target, 'probe');
    const link = path.join(base, 'link.txt');
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

describe('artifactPathPolicy canonical containment (R7-02)', () => {
  const resolver = createNodeRealPathResolver();
  const rootsOption = { resolveRealPath: resolver };

  afterEach(() => {
    const store = useArtifactsStore.getState() as { addArtifact: jest.Mock };
    store.addArtifact.mockClear?.();
  });

  it('accepts_real_file_inside_outputDir', () => {
    const outputDir = makeTempDir('pipi-out-');
    const filePath = path.join(outputDir, 'report.pdf');
    fs.writeFileSync(filePath, '%PDF');

    const result = validateArtifactPathWithinAllowedRoots(filePath, { outputDir }, undefined, {
      ...rootsOption,
      mode: 'existing-file',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rootKind).toBe('outputDir');
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('accepts_real_file_inside_workDir', () => {
    const workDir = makeTempDir('pipi-work-');
    const filePath = path.join(workDir, 'report.pdf');
    fs.writeFileSync(filePath, '%PDF');

    const result = validateArtifactPathWithinAllowedRoots(filePath, { workDir }, undefined, {
      ...rootsOption,
      mode: 'existing-file',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rootKind).toBe('workDir');
    }

    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('rejects_prefix_trick_still', () => {
    const result = validateArtifactPathWithinAllowedRoots('/tmp/outside/file.txt', {
      outputDir: '/tmp/out',
    }, undefined, rootsOption);
    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
  });

  it('rejects_traversal_escape_still', () => {
    const result = validateArtifactPathWithinAllowedRoots('/tmp/output/../secret.txt', {
      outputDir: '/tmp/output',
    }, undefined, rootsOption);
    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
  });

  it('future_output_inside_outputDir_allowed_if_parent_inside_root', () => {
    const outputDir = makeTempDir('pipi-future-out-');
    const futurePath = path.join(outputDir, 'nested', 'future.pdf');

    const result = validateArtifactPathWithinAllowedRoots(futurePath, { outputDir }, undefined, {
      ...rootsOption,
      mode: 'future-output',
    });

    expect(result.ok).toBe(true);
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('future_output_outside_root_rejected', () => {
    const outputDir = makeTempDir('pipi-future-out2-');
    const outside = makeTempDir('pipi-future-secret-');
    const futurePath = path.join(outside, 'future.pdf');

    const result = validateArtifactPathWithinAllowedRoots(futurePath, { outputDir }, undefined, {
      ...rootsOption,
      mode: 'future-output',
    });

    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('canonicalization_failure_fails_closed_for_existing_file', () => {
    const outputDir = makeTempDir('pipi-fail-closed-');
    const filePath = path.join(outputDir, 'report.pdf');
    fs.writeFileSync(filePath, '%PDF');

    const failingResolver = () => null;
    const result = validateArtifactPathWithinAllowedRoots(filePath, { outputDir }, undefined, {
      resolveRealPath: failingResolver,
      mode: 'existing-file',
    });

    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const symlinkTestsEnabled = canCreateSymlinks();
  const symlinkIt = symlinkTestsEnabled ? it : it.skip;

  symlinkIt('rejects_symlink_escape_from_outputDir', () => {
    const outputDir = makeTempDir('pipi-sym-out-');
    const secretDir = makeTempDir('pipi-sym-secret-');
    const secretFile = path.join(secretDir, 'secret.pdf');
    fs.writeFileSync(secretFile, '%PDF');
    const linkPath = path.join(outputDir, 'escape-link.pdf');
    fs.symlinkSync(secretFile, linkPath);

    const result = validateArtifactPathWithinAllowedRoots(linkPath, { outputDir }, undefined, {
      ...rootsOption,
      mode: 'existing-file',
    });

    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(secretDir, { recursive: true, force: true });
  });

  symlinkIt('rejects_symlink_escape_from_workDir', () => {
    const workDir = makeTempDir('pipi-sym-work-');
    const secretDir = makeTempDir('pipi-sym-work-secret-');
    const secretFile = path.join(secretDir, 'secret.pdf');
    fs.writeFileSync(secretFile, '%PDF');
    const linkPath = path.join(workDir, 'escape-link.pdf');
    fs.symlinkSync(secretFile, linkPath);

    const result = validateArtifactPathWithinAllowedRoots(linkPath, { workDir }, undefined, {
      ...rootsOption,
      mode: 'existing-file',
    });

    expect(result).toEqual({ ok: false, reason: ARTIFACT_PATH_OUTSIDE_ROOTS });
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(secretDir, { recursive: true, force: true });
  });

  symlinkIt('addFileArtifact_uses_canonical_policy', async () => {
    const outputDir = makeTempDir('pipi-addfile-sym-');
    const secretDir = makeTempDir('pipi-addfile-secret-');
    const secretFile = path.join(secretDir, 'secret.pdf');
    fs.writeFileSync(secretFile, '%PDF');
    const linkPath = path.join(outputDir, 'escape-link.pdf');
    fs.symlinkSync(secretFile, linkPath);

    await expect(addFileArtifact('msg-1', linkPath, 'escape-link.pdf', { outputDir }, {
      resolveRealPath: resolver,
      mode: 'existing-file',
    })).rejects.toThrow(ARTIFACT_PATH_OUTSIDE_ROOTS);

    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(secretDir, { recursive: true, force: true });
  });
});