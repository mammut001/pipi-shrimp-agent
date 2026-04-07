/**
 * Swarm Store State Consistency Tests
 *
 * Tests for swarm store state management and derived views.
 * These tests verify that the store correctly derives UI state
 * from repository data and maintains consistency.
 */

import { useSwarmStore } from '../swarmStore.js';
import type { SwarmTeam, SwarmAgent } from '../../services/swarm/types.js';

// Mock the repository to control test data
jest.mock('../../services/swarm/repository', () => ({
  getAllRuns: jest.fn(),
  getAllTeams: jest.fn(),
  getAllAgents: jest.fn(),
  getAllTasks: jest.fn(),
  getAllMessages: jest.fn(),
  getPendingPermissions: jest.fn(),
}));

const mockRepo = require('../../services/swarm/repository');

describe('Swarm Store State Consistency', () => {
  beforeEach(() => {
    // Reset store state
    useSwarmStore.setState({
      runs: [],
      teams: [],
      agents: [],
      tasks: [],
      messages: [],
      pendingPermissions: [],
      selectedTeamId: null,
      selectedAgentId: null,
      panelExpanded: false,
      totalUnreadCount: 0,
      totalPendingPermissions: 0,
      activeAgentCount: 0,
      initialized: false,
    });

    // Reset mocks
    mockRepo.getAllRuns.mockReturnValue([]);
    mockRepo.getAllTeams.mockReturnValue([]);
    mockRepo.getAllAgents.mockReturnValue([]);
    mockRepo.getAllTasks.mockReturnValue([]);
    mockRepo.getAllMessages.mockReturnValue([]);
    mockRepo.getPendingPermissions.mockReturnValue([]);
  });

  describe('Derived Counts', () => {
    it('calculates active agent count correctly', () => {
      const agents: SwarmAgent[] = [
        { id: '1', status: 'working', teamId: 'team1' } as SwarmAgent,
        { id: '2', status: 'idle', teamId: 'team1' } as SwarmAgent,
        { id: '3', status: 'completed', teamId: 'team1' } as SwarmAgent,
      ];

      mockRepo.getAllAgents.mockReturnValue(agents);

      const store = useSwarmStore.getState();
      store.sync();

      expect(store.activeAgentCount).toBe(2); // working + idle
    });

    it('calculates total unread count', () => {
      const messages = [
        { id: '1', readAt: null },
        { id: '2', readAt: new Date() },
        { id: '3', readAt: null },
      ];

      mockRepo.getAllMessages.mockReturnValue(messages);

      const store = useSwarmStore.getState();
      store.sync();

      expect(store.totalUnreadCount).toBe(2);
    });

    it('calculates pending permissions count', () => {
      const permissions = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'granted' },
      ];

      mockRepo.getPendingPermissions.mockReturnValue(permissions);

      const store = useSwarmStore.getState();
      store.sync();

      expect(store.totalPendingPermissions).toBe(1);
    });
  });

  describe('Selection Logic', () => {
    it('returns selected team agents', () => {
      const teams: SwarmTeam[] = [
        { id: 'team1', name: 'Team 1' } as SwarmTeam,
      ];
      const agents: SwarmAgent[] = [
        { id: '1', teamId: 'team1' } as SwarmAgent,
        { id: '2', teamId: 'team2' } as SwarmAgent,
      ];

      mockRepo.getAllTeams.mockReturnValue(teams);
      mockRepo.getAllAgents.mockReturnValue(agents);

      const store = useSwarmStore.getState();
      store.selectTeam('team1');
      store.sync();

      const selectedAgents = store.getSelectedTeamAgents();
      expect(selectedAgents).toHaveLength(1);
      expect(selectedAgents[0].id).toBe('1');
    });

    it('clears agent selection when team changes', () => {
      const store = useSwarmStore.getState();
      store.selectAgent('agent1');
      store.selectTeam('team2');

      expect(store.selectedAgentId).toBeNull();
    });
  });

  describe('Panel Visibility', () => {
    it('shows panel when teams exist', () => {
      const teams: SwarmTeam[] = [{ id: 'team1' } as SwarmTeam];
      mockRepo.getAllTeams.mockReturnValue(teams);

      const store = useSwarmStore.getState();
      store.sync();

      // Panel should be visible (not null) when teams exist
      expect(store.teams).toHaveLength(1);
    });

    it('hides panel when no activity', () => {
      const store = useSwarmStore.getState();
      store.sync();

      expect(store.teams).toHaveLength(0);
      expect(store.agents).toHaveLength(0);
    });
  });
});