import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { createRunDir, listIterations } from '../runDir';

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
      fs.access(second.logsDir),
      fs.access(third.logsDir),
    ]);
  });
});
