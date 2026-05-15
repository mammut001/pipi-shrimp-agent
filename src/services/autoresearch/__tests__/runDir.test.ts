import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { createRunDir, listIterations, pruneOldRuns } from '../runDir';

describe('runDir', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-rundir-'));
    installLocalInvokeMock(mockInvoke);
    await initGitRepo(workDir);
  });

  afterEach(async () => {
    mockInvoke.mockReset();
    await fs.rm(workDir, { recursive: true, force: true });
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

  it('refuses to prune directories that do not match the iter-NNN naming contract', async () => {
    const cfg = createLocalSshConfig(workDir);
    const invalidDir = path.join(workDir, 'runs', 'session-unsafe', 'iter-oops');

    await fs.mkdir(invalidDir, { recursive: true });

    await expect(pruneOldRuns(cfg, 'session-unsafe', 0)).rejects.toThrow(
      `Refusing to prune non-session run directory: ${invalidDir}`,
    );
    await expect(fs.access(invalidDir)).resolves.toBeUndefined();
  });
});
