import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const mockInvoke = jest.fn();
const mockGetActiveConfig = jest.fn();
const mockPersistence = {
  save: jest.fn(async () => undefined),
  load: jest.fn(async () => null),
  clear: jest.fn(async () => undefined),
};

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: mockGetActiveConfig,
    }),
  },
}));

jest.mock('../persistence', () => ({
  getPersistence: () => mockPersistence,
}));

jest.mock('../memory/index', () => {
  const actual = jest.requireActual('../memory/init');
  return {
    initTeamMemory: actual.initTeamMemory,
    initAgentMemory: actual.initAgentMemory,
    getSwarmBaseDir: actual.getSwarmBaseDir,
  };
});

import { createTeam, spawnAgent } from '../lifecycle';
import { clearAll } from '../repository';
import { extractAgentMemory, extractTeamMemory } from '../memory/extraction';

type InvokePayload = {
  path?: string;
  content?: string;
  sessionId?: string;
};

async function handleInvoke(command: string, payload: InvokePayload = {}) {
  switch (command) {
    case 'create_directory': {
      if (!payload.path) {
        throw new Error('create_directory requires a path');
      }

      await fs.mkdir(payload.path, { recursive: true });
      return;
    }
    case 'write_file': {
      if (!payload.path) {
        throw new Error('write_file requires a path');
      }

      await fs.mkdir(dirname(payload.path), { recursive: true });
      await fs.writeFile(payload.path, payload.content ?? '', 'utf8');
      return payload.path;
    }
    case 'read_file': {
      if (!payload.path) {
        throw new Error('read_file requires a path');
      }

      return {
        path: payload.path,
        content: await fs.readFile(payload.path, 'utf8'),
      };
    }
    case 'list_files': {
      if (!payload.path) {
        throw new Error('list_files requires a path');
      }

      const entries = await fs.readdir(payload.path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: join(payload.path!, entry.name),
        is_directory: entry.isDirectory(),
      }));
    }
    case 'send_claude_sdk_chat_streaming': {
      if (payload.sessionId?.startsWith('swarm-agent-memory-')) {
        return {
          content: JSON.stringify({
            memories: [
              {
                filename: 'ignored-by-extractor.md',
                type: 'project',
                title: 'Swarm Path Contract',
                content: 'Keep swarm memory inside the bound session workDir.',
                summary: 'Swarm memory must stay inside the session workDir.',
              },
            ],
          }),
        };
      }

      if (payload.sessionId?.startsWith('swarm-team-memory-')) {
        return {
          content: JSON.stringify({
            memories: [
              {
                filename: 'ignored-by-team-extractor.md',
                type: 'decision',
                title: 'Keep Memory Local',
                content: 'Team memory writes should stay in the active session workDir.',
                summary: 'Team decided to keep memory local to the active session.',
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected extraction session in swarm memory test: ${payload.sessionId}`);
    }
    default:
      throw new Error(`Unexpected invoke command in swarm memory test: ${command}`);
  }
}

describe('Swarm memory path integration', () => {
  let tempRoot = '';

  beforeEach(async () => {
    jest.useFakeTimers();
    tempRoot = await fs.mkdtemp(join(tmpdir(), 'pipi-swarm-memory-'));

    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string, payload?: InvokePayload) =>
      handleInvoke(command, payload)
    );

    mockPersistence.save.mockClear();
    mockPersistence.load.mockClear();
    mockPersistence.clear.mockClear();
    mockGetActiveConfig.mockReset();
    mockGetActiveConfig.mockReturnValue({
      apiKey: 'test-key',
      model: 'gpt-test',
      baseUrl: '',
      apiFormat: 'openai',
    });
  });

  afterEach(async () => {
    await clearAll();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates team and agent memory inside the session workDir', async () => {
    const workDir = join(tempRoot, 'chat-session');
    const expectedBaseDir = join(workDir, '.pipi-shrimp', 'memory', 'swarm');

    const { team, leader, teamMemory, leaderMemory } = await createTeam({
      name: 'memory-team',
      sessionId: 'session-1',
      description: 'verify session-local swarm memory',
      leaderName: 'leader',
      projectRoot: workDir,
    });

    const { agent, memory } = await spawnAgent({
      teamId: team.id,
      name: 'worker',
      sessionId: 'session-1',
      projectRoot: workDir,
    });

    expect(teamMemory?.memoryDir).toBe(join(expectedBaseDir, team.id, 'team-memory'));
    expect(leaderMemory?.memoryDir).toBe(join(expectedBaseDir, team.id, leader.id, 'memory'));
    expect(memory?.memoryDir).toBe(join(expectedBaseDir, team.id, agent.id, 'memory'));

    const teamMemoryFile = join(teamMemory!.memoryDir, 'MEMORY.md');
    const leaderMemoryFile = join(leaderMemory!.memoryDir, 'MEMORY.md');
    const agentMemoryFile = join(memory!.memoryDir, 'MEMORY.md');

    await expect(fs.readFile(teamMemoryFile, 'utf8')).resolves.toContain('# Team Memory');
    await expect(fs.readFile(leaderMemoryFile, 'utf8')).resolves.toContain('# Agent Memory');
    await expect(fs.readFile(agentMemoryFile, 'utf8')).resolves.toContain('# Agent Memory');

    const writtenPaths = mockInvoke.mock.calls
      .map(([, payload]) => (payload as InvokePayload | undefined)?.path)
      .filter((value): value is string => Boolean(value));

    expect(writtenPaths.every((value) => value.startsWith(workDir))).toBe(true);
    expect(writtenPaths.some((value) => value.includes(join('.pipi-shrimp', 'memory', 'swarm')))).toBe(true);
    expect(writtenPaths.some((value) => value.startsWith(join(homedir(), '.pipi-shrimp')))).toBe(false);
    expect(writtenPaths.some((value) => value.includes(`${sep}pipi-shrimp-memory${sep}default`))).toBe(false);
  });

  it('extracts agent and team memories back into the session workDir', async () => {
    const workDir = join(tempRoot, 'chat-session');

    const { team, leader, teamMemory, leaderMemory } = await createTeam({
      name: 'memory-team',
      sessionId: 'session-2',
      description: 'verify memory writeback stays session-local',
      leaderName: 'leader',
      projectRoot: workDir,
    });

    const { memory: workerMemory } = await spawnAgent({
      teamId: team.id,
      name: 'worker',
      sessionId: 'session-2',
      projectRoot: workDir,
    });

    const savedAgentPaths = await extractAgentMemory(
      workerMemory!.memoryDir,
      'We should keep all swarm memory writes inside the active session workDir.',
      'Persist the swarm memory path contract',
    );
    const savedTeamPaths = await extractTeamMemory(
      teamMemory!.memoryDir,
      'Decision: all shared swarm memory stays local to the bound session workDir.',
      'Document the team-level memory decision',
    );

    const agentTopicFile = join(workerMemory!.memoryDir, 'topic-memories', 'project-swarm-path-contract.md');
    const teamTopicFile = join(teamMemory!.memoryDir, 'topic-memories', 'decision-keep-memory-local.md');

    expect(savedAgentPaths).toEqual([agentTopicFile]);
    expect(savedTeamPaths).toEqual([teamTopicFile]);

    await expect(fs.readFile(agentTopicFile, 'utf8')).resolves.toContain('Keep swarm memory inside the bound session workDir.');
    await expect(fs.readFile(teamTopicFile, 'utf8')).resolves.toContain('Team memory writes should stay in the active session workDir.');
    await expect(fs.readFile(join(workerMemory!.memoryDir, 'MEMORY.md'), 'utf8')).resolves.toContain('[project-swarm-path-contract.md](topic-memories/project-swarm-path-contract.md): Swarm memory must stay inside the session workDir.');
    await expect(fs.readFile(join(teamMemory!.memoryDir, 'MEMORY.md'), 'utf8')).resolves.toContain('[decision-keep-memory-local.md](topic-memories/decision-keep-memory-local.md): Team decided to keep memory local to the active session.');

    const writtenPaths = mockInvoke.mock.calls
      .filter(([command]) => command === 'write_file')
      .map(([, invokePayload]) => (invokePayload as InvokePayload).path)
      .filter((value): value is string => Boolean(value));

    expect(writtenPaths).toContain(agentTopicFile);
    expect(writtenPaths).toContain(teamTopicFile);
    expect(writtenPaths).toContain(join(teamMemory!.memoryDir, 'MEMORY.md'));
    expect(writtenPaths).toContain(join(workerMemory!.memoryDir, 'MEMORY.md'));
    expect(writtenPaths.every((value) => value.startsWith(workDir))).toBe(true);
    expect(writtenPaths.some((value) => value.startsWith(join(homedir(), '.pipi-shrimp')))).toBe(false);
    expect(writtenPaths.some((value) => value.includes(`${sep}pipi-shrimp-memory${sep}default`))).toBe(false);

    expect(leader.id).toBeDefined();
    expect(leaderMemory?.memoryDir.startsWith(workDir)).toBe(true);
  });
});