import { describe, expect, it, jest } from '@jest/globals';
import type { ToolRequest } from '../../../services/StreamingToolExecutor';
import type { ToolBatchExecutionDeps } from '../chatToolExecution';
import { resolveSerialToolPermission } from '../chatToolPermission';
import { executeAgentTool } from '../chatToolAgentExec';

interface FakeAgent { id: string; teamId: string; name: string; status: string; _bgAgentId?: string }

function createFakeSwarm() {
  const teams: Array<{ id: string; name: string; leaderId: string }> = [];
  const agents: FakeAgent[] = [];
  let seq = 0;
  const swarm = {
    getActiveRunForChatSession: jest.fn(() => ({ id: 'run-1' })),
    startRun: jest.fn(() => ({ id: 'run-1' })),
    getTeamByName: jest.fn((name: string) => teams.find((team) => team.name === name)),
    createTeam: jest.fn(async ({ name }: { name: string }) => {
      const team = { id: `team-${++seq}`, name, leaderId: `leader-${seq}` };
      teams.push(team);
      return { team, leader: { id: team.leaderId } };
    }),
    getAgentsForTeam: jest.fn((teamId: string) => agents.filter((agent) => agent.teamId === teamId)),
    spawnAgent: jest.fn(async ({ teamId, name }: { teamId: string; name: string }) => {
      const agent: FakeAgent = { id: `agent-${++seq}`, teamId, name, status: 'idle' };
      agents.push(agent);
      return { agent };
    }),
    enqueuePermissionInUI: jest.fn(async () => true),
    failAgent: jest.fn(),
    reconcileRunForChatSession: jest.fn(),
    createTask: jest.fn(() => ({ id: 'task-1' })),
    startAgent: jest.fn((agentId: string) => {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (agent) agent.status = 'working';
    }),
    startTask: jest.fn(),
    recordUserPrompt: jest.fn(),
  };
  return { swarm, agents };
}

function createDeps(swarm: ReturnType<typeof createFakeSwarm>['swarm']) {
  const inbox = { onAgentStarted: jest.fn(), onTeamCreated: jest.fn() };
  const deps = {
    uiStore: { getState: () => ({ addNotification: jest.fn(), waitForPermission: jest.fn(async () => true) }) },
    loadSwarmModule: jest.fn(async () => swarm),
    loadInboxCoordinator: jest.fn(async () => inbox),
    loadSwarmStore: jest.fn(async () => ({ useSwarmStore: { getState: () => ({ init: jest.fn() }) } })),
    getCurrentAgentContext: jest.fn(() => null),
    runAgentBackground: jest.fn(async () => 'bg-1'),
    runAgentSync: jest.fn(),
    t: (key: string) => key,
  } as unknown as ToolBatchExecutionDeps;
  return { deps, inbox };
}

const tool: ToolRequest = { id: 'call-1', name: 'agent_tool', arguments: {} };
const args = JSON.stringify({ team_name: 'research', name: 'bob', prompt: 'look into it' });

describe('swarm teammate agent_tool: permission step + execution', () => {
  it('reuses the agent spawned for the approval prompt instead of spawning a second one', async () => {
    const { swarm, agents } = createFakeSwarm();
    const { deps, inbox } = createDeps(swarm);

    const approved = await resolveSerialToolPermission(tool, args, 'session-1', 'standard', '/repo', deps);
    expect(approved).toBe(true);
    expect(agents).toHaveLength(1);

    await executeAgentTool(tool, args, 'session-1', '/repo', deps);

    expect(swarm.spawnAgent).toHaveBeenCalledTimes(1);
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe('working');
    expect(swarm.startAgent).toHaveBeenCalledWith(agents[0].id, 'task-1');
    // Team was created in the permission step; the leader inbox must still be registered.
    expect(inbox.onTeamCreated).toHaveBeenCalledWith('team-1', 'leader-1');
  });

  it('spawns a fresh teammate when no approval-prompt agent is pending', async () => {
    const { swarm, agents } = createFakeSwarm();
    const { deps } = createDeps(swarm);

    await executeAgentTool(tool, args, 'session-1', '/repo', deps);

    expect(swarm.spawnAgent).toHaveBeenCalledTimes(1);
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe('working');
  });

  it('does not reuse a same-named teammate that already started', async () => {
    const { swarm, agents } = createFakeSwarm();
    const { deps } = createDeps(swarm);

    await executeAgentTool(tool, args, 'session-1', '/repo', deps);
    await executeAgentTool(tool, args, 'session-1', '/repo', deps);

    expect(swarm.spawnAgent).toHaveBeenCalledTimes(2);
    expect(agents.map((agent) => agent.status)).toEqual(['working', 'working']);
  });
});
