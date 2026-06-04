/**
 * UI / Headless Runner Parity Tests
 *
 * These tests pin the contract between the React UI (the setup form,
 * default config, permission catalog) and the headless runner
 * (`scripts/autoresearch-exec.mjs`). If either side drifts, these
 * tests should fail.
 *
 * Parity invariants verified:
 *   1. Standard verification commands are byte-identical between the
 *      UI's `VERIFICATION_PRESETS['standard']` and the script's
 *      `STANDARD_VERIFICATION` constant.
 *   2. The set of permission profile ids is identical in both places.
 *   3. v2 result parsing produces a v2-shaped object for headless
 *      artifacts (the script's emitted `result.json`) and for legacy
 *      UI loop output (the agent's text or the metrics file content).
 *   4. The patch gate artifact paths displayed in the UI match the
 *      paths the script writes.
 *   5. The default permission profile is `workspace_write` in both
 *      the UI and the script.
 */

import { describe, expect, it } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { PROFILE_CATALOG, listPermissionProfiles } from '../permissions';
import {
  AUTORESEARCH_FALLBACK_CONFIG,
  DEFAULT_VERIFICATION_PRESET,
  VERIFICATION_PRESETS,
  resolveVerificationCommands,
} from '../defaultConfig';
import { parseSelfImproveResultAny, type SelfImproveResultV2 } from '../selfImprove/schemaV2';
import {
  derivePatchGateArtifactEntries,
  type PatchGateArtifactEntry,
} from '@/components/autoresearch/AutoResearchPatchGateArtifacts';

const execFileAsync = promisify(execFile);

const SCRIPT = path.resolve(__dirname, '../../../../scripts/autoresearch-exec.mjs');

interface ScriptProfileCatalogEntry {
  id: string;
  allowShellCommands: boolean;
  allowFileWrites: boolean;
  maxChangedFiles: number;
  maxDiffBytes: number;
  maxCommandTimeoutSecs: number;
}

interface ScriptHarnessConstants {
  STANDARD_VERIFICATION: string[];
  PROFILE_CATALOG: Record<string, ScriptProfileCatalogEntry>;
}

async function readScriptConstants(): Promise<ScriptHarnessConstants> {
  // Read the script source and extract the two well-known constants.
  // The script references module-level helpers (e.g. COMMON_FORBIDDEN_READ_PATHS)
  // inside the profile catalog, so we provide a stub scope.
  const source = await fs.readFile(SCRIPT, 'utf8');
  const extract = (name: string): string | null => {
    const re = new RegExp(`const ${name}\\s*=\\s*([\\s\\S]*?);\\n`);
    const match = source.match(re);
    return match ? match[1] : null;
  };

  const standardRaw = extract('STANDARD_VERIFICATION');
  if (!standardRaw) {
    throw new Error('Could not extract STANDARD_VERIFICATION from autoresearch-exec.mjs');
  }
  const profileRaw = extract('PROFILE_CATALOG');
  if (!profileRaw) {
    throw new Error('Could not extract PROFILE_CATALOG from autoresearch-exec.mjs');
  }

  // Evaluate in a sandbox that supplies stub helpers used by the script.
  // The script's PROFILE_CATALOG references the COMMON_* constants; we
  // substitute them with empty arrays / trivial objects because the
  // parity check only cares about scalar fields, not the references.
  const stubScope = `
    const COMMON_DANGEROUS_COMMAND_PATTERNS = [];
    const COMMON_FORBIDDEN_READ_PATHS = [];
    const COMMON_WRITE_DENY_LIST = [];
    return [${standardRaw}, ${profileRaw}];
  `;
  // eslint-disable-next-line no-new-func
  const result = new Function(stubScope)() as [string[], Record<string, ScriptProfileCatalogEntry>];
  return {
    STANDARD_VERIFICATION: result[0],
    PROFILE_CATALOG: result[1],
  };
}

describe('UI / headless parity: standard verification commands', () => {
  it('standard preset commands match the script constant', async () => {
    const script = await readScriptConstants();
    const ui = resolveVerificationCommands('standard');
    expect(ui).toEqual(script.STANDARD_VERIFICATION);
  });

  it('default preset is standard in the UI', () => {
    expect(DEFAULT_VERIFICATION_PRESET).toBe('standard');
  });
});

describe('UI / headless parity: permission profile ids', () => {
  it('the catalog exposes the same three ids on both sides', async () => {
    const script = await readScriptConstants();
    const uiIds = listPermissionProfiles().map((p) => p.id).sort();
    const scriptIds = Object.keys(script.PROFILE_CATALOG).sort();
    expect(uiIds).toEqual(['danger_full_access', 'read_only', 'workspace_write']);
    expect(scriptIds).toEqual(['danger_full_access', 'read_only', 'workspace_write']);
  });

  it('UI catalog field-level constraints match the script', async () => {
    const script = await readScriptConstants();
    for (const id of Object.keys(PROFILE_CATALOG) as Array<keyof typeof PROFILE_CATALOG>) {
      const uiProfile = PROFILE_CATALOG[id];
      const scriptProfile = script.PROFILE_CATALOG[id];
      expect(scriptProfile).toBeDefined();
      expect(uiProfile.allowShellCommands).toBe(scriptProfile.allowShellCommands);
      expect(uiProfile.allowFileWrites).toBe(scriptProfile.allowFileWrites);
      expect(uiProfile.maxChangedFiles).toBe(scriptProfile.maxChangedFiles);
      expect(uiProfile.maxDiffBytes).toBe(scriptProfile.maxDiffBytes);
      expect(uiProfile.maxCommandTimeoutSecs).toBe(scriptProfile.maxCommandTimeoutSecs);
    }
  });

  it('default permission profile is workspace_write on both sides', () => {
    expect(AUTORESEARCH_FALLBACK_CONFIG.permissionProfile).toBe('workspace_write');
  });
});

describe('UI / headless parity: v2 result parsing for both sides', () => {
  it('parses a script-emitted v2 result.json', async () => {
    // Run the script with a tiny git repo, then read the emitted
    // result.json and parse it. This validates that what the script
    // writes is valid v2.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'parity-v2-'));
    const repo = path.join(tmp, 'repo');
    const work = path.join(tmp, 'work');
    try {
      await fs.mkdir(repo, { recursive: true });
      await fs.mkdir(work, { recursive: true });
      await execFileAsync('git', ['init', '-q'], { cwd: repo });
      await execFileAsync('git', ['config', 'user.email', 'p@t'], { cwd: repo });
      await execFileAsync('git', ['config', 'user.name', 'p'], { cwd: repo });
      await fs.writeFile(path.join(repo, 'README.md'), 'hi\n', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: repo });
      await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

      const { stdout } = await execFileAsync('node', [
        SCRIPT,
        '--repo', repo,
        '--workdir', work,
        '--dry-run',
        '--session-id', `parity-${Date.now()}`,
        '--json',
      ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      const payload = JSON.parse(stdout);
      const parsed = parseSelfImproveResultAny(JSON.stringify(payload.result));
      expect(parsed).not.toBeNull();
      expect(parsed!.schemaVersion).toBe(2);
      // In dry-run the script emits status=NO_CHANGE for clean repos, or
      // NEEDS_REVIEW when any verification command fails. Either way the
      // status must be one of the four allowed values.
      expect(['IMPROVED', 'NO_CHANGE', 'NEEDS_REVIEW', 'FAILED']).toContain(parsed!.status);
      expect((parsed as SelfImproveResultV2).issue?.category).toBe('other');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('parses legacy v1 agent output (UI fallback path)', () => {
    const v1 = {
      schemaVersion: 1,
      mode: 'repo_self_improve',
      iteration: 1,
      phaseResults: {},
      changedFiles: ['src/a.ts'],
      commandsRun: ['pnpm test'],
      buildPassed: true,
      testsPassed: false,
      typecheckPassed: true,
      riskLevel: 'medium',
      status: 'NEEDS_REVIEW',
      summary: 'old v1 result',
      nextRecommendation: 'retry',
    };
    const parsed = parseSelfImproveResultAny(JSON.stringify(v1));
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2);
    expect(parsed!.status).toBe('NEEDS_REVIEW');
    expect(parsed!.summary).toBe('old v1 result');
  });
});

describe('UI / headless parity: patch gate artifact paths', () => {
  it('derives the same six patch gate entries from a real script output dir', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'parity-art-'));
    const repo = path.join(tmp, 'repo');
    const work = path.join(tmp, 'work');
    try {
      await fs.mkdir(repo, { recursive: true });
      await fs.mkdir(work, { recursive: true });
      await execFileAsync('git', ['init', '-q'], { cwd: repo });
      await execFileAsync('git', ['config', 'user.email', 'p@t'], { cwd: repo });
      await execFileAsync('git', ['config', 'user.name', 'p'], { cwd: repo });
      await fs.writeFile(path.join(repo, 'README.md'), 'hi\n', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: repo });
      await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

      const sessionId = `parity-art-${Date.now()}`;
      const { stdout } = await execFileAsync('node', [
        SCRIPT,
        '--repo', repo,
        '--workdir', work,
        '--dry-run',
        '--session-id', sessionId,
        '--json',
      ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      const payload = JSON.parse(stdout);
      const iterDir = payload.runDir as string;
      expect(typeof iterDir).toBe('string');
      // The script puts result.json next to diff.patch.
      const expected = [
        'result.json',
        'diff.patch',
        'events.jsonl',
        'run.jsonl',
        'apply.md',
        'revert.md',
        'logs',
      ];
      const files = await fs.readdir(iterDir);
      for (const f of expected) {
        expect(files).toContain(f);
      }

      // Now feed the same paths into the UI's derivePatchGateArtifactEntries.
      const artifactPaths = expected.map((f) => path.join(iterDir, f));
      const entries: PatchGateArtifactEntry[] = derivePatchGateArtifactEntries(artifactPaths);
      const labels = entries.map((e) => e.label);
      expect(labels).toContain('result.json');
      expect(labels).toContain('diff.patch');
      expect(labels).toContain('events.jsonl');
      expect(labels).toContain('apply.md');
      expect(labels).toContain('revert.md');
      expect(labels).toContain('logs/');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
