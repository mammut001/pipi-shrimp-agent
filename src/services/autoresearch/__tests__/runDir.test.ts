import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { useSettingsStore } from '@/store/settingsStore';
import type { SshConfig } from '@/store/autoresearchStore';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { getAutoResearchTestTmpDir } from './tmpRoot';
import { createRunDir, executeTargetCommand, getSessionRunPaths, listIterations, pruneOldRuns } from '../runDir';

const execFileAsync = promisify(execFile);

jest.setTimeout(120000);

const PROJECT_TMP_DIR = getAutoResearchTestTmpDir();

function normalizeComparablePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/mnt\/([a-zA-Z])\//g, (_, drive: string) => `${drive.toUpperCase()}:\/`)
    .replace(/\/+/g, '/');
}

function projectTmpDir(): string {
  return PROJECT_TMP_DIR;
}

describe('runDir', () => {
  let workDir: string;
  let experimentDir: string;

  beforeEach(async () => {
    await fs.mkdir(projectTmpDir(), { recursive: true });
    workDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-rundir-'));
    experimentDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-rundir-exp-'));
    installLocalInvokeMock(mockInvoke);
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    await initGitRepo(workDir);
    await initGitRepo(experimentDir, {
      'run_experiment.py': 'print("experiment")\n',
      'AUTORESEARCH.md': '# Notes\n',
    });
  });

  afterEach(async () => {
    mockInvoke.mockReset();
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort: never let cleanup mask the actual test failure.
    }
    try {
      await fs.rm(experimentDir, { recursive: true, force: true });
    } catch {
      // Best-effort: never let cleanup mask the actual test failure.
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(PROJECT_TMP_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort sweep; failures here are non-fatal.
    }
  });

  it('creates ordered per-iteration directories with logs and snapshots', async () => {
    const cfg = createLocalSshConfig(workDir);
    const first = await createRunDir(cfg, 'session-1', 1);
    const second = await createRunDir(cfg, 'session-1', 2);
    const third = await createRunDir(cfg, 'session-1', 3);

    expect(path.basename(first.iterDir)).toMatch(/^iter-001-/);
    expect(path.basename(second.iterDir)).toMatch(/^iter-002-/);
    expect(path.basename(third.iterDir)).toMatch(/^iter-003-/);

    const listed = await listIterations(cfg, 'session-1');
    expect(listed.map((entry) => entry.iter)).toEqual([1, 2, 3]);

    await Promise.all([
      fs.access(first.logsDir),
      fs.access(path.join(first.iterDir, 'code')),
      fs.access(first.systemPromptPath),
      fs.access(first.reflectionRawPath),
      fs.access(second.logsDir),
      fs.access(third.logsDir),
    ]);

    expect(path.basename(first.systemPromptPath)).toBe('system_prompt.txt');
    expect(path.basename(first.reflectionInputPath)).toBe('reflection.input.json');
    expect(path.basename(first.reflectionRawPath)).toBe('reflection.raw.txt');
    expect(path.basename(first.reflectionParsedPath)).toBe('reflection.parsed.json');
    expect(normalizeComparablePath(path.dirname(first.metricsPath))).toBe(normalizeComparablePath(first.iterDir));
    expect(normalizeComparablePath(path.dirname(first.hypothesisPath))).toBe(normalizeComparablePath(first.iterDir));
    expect(normalizeComparablePath(path.dirname(first.transcriptPath))).toBe(normalizeComparablePath(first.iterDir));
    expect(normalizeComparablePath(path.dirname(first.statusPath))).toBe(normalizeComparablePath(first.iterDir));
  });

  it('keeps run directories under the AutoResearch workDir instead of the source experiment dir', async () => {
    const cfg = createLocalSshConfig(workDir);
    const run = await createRunDir(cfg, 'session-1', 1, {
      snapshotSourceDir: experimentDir,
    });

    expect(run.iterDir.startsWith(path.join(workDir, 'runs', 'session-1'))).toBe(true);
    expect(run.iterDir.startsWith(experimentDir)).toBe(false);
    expect(run.codeDir.startsWith(run.iterDir)).toBe(true);
    expect(run.codeDir.startsWith(experimentDir)).toBe(false);
    await expect(fs.readFile(path.join(run.codeDir, 'run_experiment.py'), 'utf8')).resolves.toBe('print("experiment")\n');
  });

  it('rejects unsafe session identifiers instead of allowing path escape', () => {
    const cfg = createLocalSshConfig(workDir);

    expect(() => getSessionRunPaths(cfg, '../escape')).toThrow('Invalid AutoResearch sessionId');
    expect(() => getSessionRunPaths(cfg, 'nested/session')).toThrow('Invalid AutoResearch sessionId');
  });

  it('rejects invalid iteration values before creating paths', async () => {
    const cfg = createLocalSshConfig(workDir);

    await expect(createRunDir(cfg, 'session-1', 0)).rejects.toThrow('expected a positive integer');
    await expect(createRunDir(cfg, 'session-1', -1)).rejects.toThrow('expected a positive integer');
  });

  it('keeps SSH session paths anchored to the configured remote workDir', () => {
    const sessionPaths = getSessionRunPaths({
      ...createLocalSshConfig(workDir),
      mode: 'ssh',
      host: 'example.com',
      user: 'research',
      remoteWorkDir: '/srv/autoresearch',
    }, 'session-ssh');

    expect(sessionPaths.sessionDir).toBe('/srv/autoresearch/runs/session-ssh');
    expect(sessionPaths.metricsJsonlPath).toBe('/srv/autoresearch/runs/session-ssh/metrics.jsonl');
    expect(sessionPaths.livingDocPath).toBe('/srv/autoresearch/runs/session-ssh/autoresearch.md');
  });

  it('passes the active Windows shell profile through local target execution', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });
    const cfg = createLocalSshConfig(workDir);

    await expect(executeTargetCommand(cfg, 'printf test', 30)).resolves.toEqual(expect.objectContaining({
      stdout: 'test',
      exit_code: 0,
    }));

    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', {
      args: expect.objectContaining({
        command: 'printf test',
        workDir: workDir,
        timeoutSecs: 30,
        windowsShellProfile: 'wsl',
      }),
    });
  });

  it('escapes shell variables before local WSL execution so bash sees them', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });
    const cfg = createLocalSshConfig(workDir);

    await expect(executeTargetCommand(cfg, 'printf "$HOME"', 30)).resolves.toEqual(
      expect.objectContaining({
        exit_code: 0,
      }),
    );

    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', {
      args: expect.objectContaining({
        command: expect.stringMatching(/^printf "\\?\$HOME"$/),
        workDir: workDir,
        timeoutSecs: 30,
        windowsShellProfile: 'wsl',
      }),
    });
  });

  it('uses /tmp as the host cwd for remote SSH helper invokes', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    const cfg: SshConfig = {
      mode: 'ssh',
      host: 'example.test',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/srv/project',
      authMode: 'agent',
      password: '',
    };

    await executeTargetCommand(cfg, 'printf test', 30);

    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', {
      args: expect.objectContaining({
        workDir: '/tmp',
      }),
    });
  });

  it('falls back to /tmp when a local AutoResearch helper uses a relative cwd of .', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    const cfg = createLocalSshConfig('.');

    await expect(executeTargetCommand(cfg, 'printf test', 30)).resolves.toEqual(expect.objectContaining({
      stdout: 'test',
      exit_code: 0,
    }));

    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', {
      args: expect.objectContaining({
        command: 'printf test',
        workDir: '/tmp',
      }),
    });
  });

  it('falls back to /tmp when a local AutoResearch helper clears the workdir', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });
    const cfg = createLocalSshConfig('');

    await expect(executeTargetCommand(cfg, 'printf test', 30)).resolves.toEqual(expect.objectContaining({
      stdout: 'test',
      exit_code: 0,
    }));

    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', {
      args: expect.objectContaining({
        command: 'printf test',
        workDir: '/tmp',
        timeoutSecs: 30,
        windowsShellProfile: 'wsl',
      }),
    });
  });

  it('prunes only stale iteration directories inside the session run dir', async () => {
    const cfg = createLocalSshConfig(workDir);
    const first = await createRunDir(cfg, 'session-1', 1);
    const second = await createRunDir(cfg, 'session-1', 2);
    const third = await createRunDir(cfg, 'session-1', 3);

    await pruneOldRuns(cfg, 'session-1', 1);

    await expect(fs.access(first.iterDir)).rejects.toThrow();
    await expect(fs.access(second.iterDir)).rejects.toThrow();
    await expect(fs.access(third.iterDir)).resolves.toBeUndefined();
  });

  it('removes git worktree metadata when pruning stale runs', async () => {
    const cfg = createLocalSshConfig(workDir);
    const first = await createRunDir(cfg, 'session-prune-worktree', 1);

    const before = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: workDir });
    expect(normalizeComparablePath(before.stdout)).toContain(normalizeComparablePath(first.codeDir));

    await pruneOldRuns(cfg, 'session-prune-worktree', 0);

    const after = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: workDir });
    expect(normalizeComparablePath(after.stdout)).not.toContain(normalizeComparablePath(first.codeDir));
  });

  it('refuses to prune directories that do not match the iter-NNN naming contract', async () => {
    const cfg = createLocalSshConfig(workDir);
    const invalidDir = path.join(workDir, 'runs', 'session-unsafe', 'iter-oops');

    await fs.mkdir(invalidDir, { recursive: true });

    await expect(pruneOldRuns(cfg, 'session-unsafe', 0)).rejects.toThrow(
      /Refusing to prune non-session run directory: .*iter-oops/,
    );
    await expect(fs.access(invalidDir)).resolves.toBeUndefined();
  });
});
