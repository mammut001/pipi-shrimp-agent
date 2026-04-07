/**
 * SwarmPanel — Runtime-bound swarm UI
 *
 * Shows teams, agents, tasks, mailbox, and transcript state.
 * All data is driven by the swarm store (repository-backed), not mock state.
 *
 * Prioritizes observability, debuggability, and truthfulness
 * over polished visuals.
 */

import { useEffect, useState } from 'react';
import { useSwarmStore } from '../store/swarmStore';
import type {
  SwarmAgent,
  SwarmTask,
  SwarmMessage,
  TranscriptEntry,
} from '../services/swarm/types';

// =============================================================================
// Subcomponents
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500',
    working: 'bg-yellow-500',
    idle: 'bg-gray-400',
    completed: 'bg-blue-500',
    failed: 'bg-red-500',
    interrupted: 'bg-orange-500',
    pending: 'bg-gray-300',
    claimed: 'bg-yellow-400',
    in_progress: 'bg-yellow-500',
    disbanded: 'bg-gray-500',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-300'}`}
      title={status}
    />
  );
}

function AgentRow({
  agent,
  isSelected,
  unreadCount,
  onClick,
}: {
  agent: SwarmAgent;
  isSelected: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1 text-xs rounded flex items-center gap-2 hover:bg-white/5 ${
        isSelected ? 'bg-white/10 ring-1 ring-white/20' : ''
      }`}
    >
      <StatusBadge status={agent.status} />
      <span className="flex-1 truncate">
        {agent.name}
        {agent.role === 'leader' && (
          <span className="ml-1 text-[10px] text-yellow-400">★</span>
        )}
      </span>
      {unreadCount > 0 && (
        <span className="bg-blue-500 text-white text-[10px] px-1 rounded-full min-w-[16px] text-center">
          {unreadCount}
        </span>
      )}
      <span className="text-[10px] text-white/40">{agent.status}</span>
    </button>
  );
}

function TaskRow({ task }: { task: SwarmTask }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <StatusBadge status={task.status} />
      <span className="flex-1 truncate text-white/70">{task.description}</span>
      {task.assignedAgentId && (
        <span className="text-[10px] text-white/40 truncate max-w-[60px]">
          {task.assignedAgentId.slice(-6)}
        </span>
      )}
    </div>
  );
}

function MessageRow({ msg, agents }: { msg: SwarmMessage; agents: SwarmAgent[] }) {
  const from = agents.find(a => a.id === msg.fromAgentId);
  const isUnread = !msg.readAt;

  return (
    <div className={`px-2 py-1 text-xs ${isUnread ? 'bg-blue-500/10' : ''}`}>
      <div className="flex items-center gap-1">
        <span className="text-white/60">{from?.name || 'unknown'}</span>
        <span className="text-[10px] text-white/30">→</span>
        <span className="text-white/40">{msg.messageType}</span>
        {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
      </div>
      <div className="text-white/50 truncate mt-0.5">{msg.content}</div>
    </div>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  const eventIcons: Record<string, string> = {
    agent_started: '🚀',
    user_prompt_injected: '📝',
    assistant_output: '🤖',
    tool_called: '🔧',
    tool_result: '📋',
    permission_requested: '🔐',
    permission_resolved: '✅',
    agent_completed: '✔️',
    agent_failed: '❌',
  };

  return (
    <div className="px-2 py-1 text-xs border-l-2 border-white/10">
      <div className="flex items-center gap-1">
        <span>{eventIcons[entry.eventType] || '·'}</span>
        <span className="text-white/50 text-[10px]">{entry.eventType}</span>
        {entry.toolName && (
          <span className="text-white/30 text-[10px]">({entry.toolName})</span>
        )}
        <span className="text-white/20 text-[10px] ml-auto">
          {new Date(entry.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="text-white/60 truncate mt-0.5">{entry.content}</div>
    </div>
  );
}

// =============================================================================
// Detail panels
// =============================================================================

function AgentDetail({ agentId }: { agentId: string }) {
  const store = useSwarmStore();
  const agent = store.agents.find(a => a.id === agentId);
  if (!agent) return <div className="p-2 text-xs text-white/40">Agent not found</div>;

  const transcript = store.getSelectedAgentTranscript();
  const summary = store.getAgentTranscriptSummary(agentId);
  const inbox = store.getAgentInboxSummary(agentId);
  const currentTask = agent.currentTaskId
    ? store.tasks.find(t => t.id === agent.currentTaskId)
    : null;

  return (
    <div className="space-y-3">
      {/* Agent header */}
      <div className="px-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusBadge status={agent.status} />
          {agent.name}
          {agent.role === 'leader' && <span className="text-yellow-400 text-xs">leader</span>}
        </div>
        <div className="text-[10px] text-white/30 mt-0.5">
          ID: {agent.id} | Model: {agent.model || 'default'}
        </div>
      </div>

      {/* Current task */}
      {currentTask && (
        <div className="px-2">
          <div className="text-[10px] text-white/50 uppercase mb-1">Current Task</div>
          <TaskRow task={currentTask} />
        </div>
      )}

      {/* Inbox summary */}
      <div className="px-2">
        <div className="text-[10px] text-white/50 uppercase mb-1">
          Inbox ({inbox.totalUnread} unread)
        </div>
        {inbox.totalUnread === 0 && (
          <div className="text-xs text-white/30">No unread messages</div>
        )}
        {Object.entries(inbox.byType).map(([type, count]) => (
          <div key={type} className="text-xs text-white/50">
            {type}: {count as number}
          </div>
        ))}
      </div>

      {/* Transcript summary */}
      <div className="px-2">
        <div className="text-[10px] text-white/50 uppercase mb-1">
          Transcript ({summary.totalEntries} entries)
        </div>
      </div>

      {/* Recent transcript entries */}
      <div className="max-h-[300px] overflow-y-auto">
        {transcript.slice(-20).map(entry => (
          <TranscriptRow key={entry.id} entry={entry} />
        ))}
        {transcript.length === 0 && (
          <div className="px-2 text-xs text-white/30">No transcript entries</div>
        )}
      </div>
    </div>
  );
}

function TeamDetail({ teamId }: { teamId: string }) {
  const store = useSwarmStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return <div className="p-2 text-xs text-white/40">Team not found</div>;

  const teamTasks = store.getSelectedTeamTasks();
  const teamMessages = store.getSelectedTeamMessages();
  const taskSummary = store.getTeamTaskSummary(teamId);
  const pendingPerms = store.pendingPermissions.filter(p => p.teamId === teamId);

  const [tab, setTab] = useState<'tasks' | 'messages'>('tasks');

  return (
    <div className="space-y-3">
      {/* Team header */}
      <div className="px-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusBadge status={team.status} />
          {team.name}
        </div>
        {team.description && (
          <div className="text-xs text-white/50 mt-0.5">{team.description}</div>
        )}
        <div className="text-[10px] text-white/30 mt-0.5">
          Tasks: {taskSummary.completed}/{taskSummary.total}
          {pendingPerms.length > 0 && ` | ${pendingPerms.length} pending permissions`}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-2">
        <button
          onClick={() => setTab('tasks')}
          className={`text-[10px] px-2 py-0.5 rounded ${tab === 'tasks' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'}`}
        >
          Tasks ({teamTasks.length})
        </button>
        <button
          onClick={() => setTab('messages')}
          className={`text-[10px] px-2 py-0.5 rounded ${tab === 'messages' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'}`}
        >
          Messages ({teamMessages.length})
        </button>
      </div>

      {/* Content */}
      <div className="max-h-[300px] overflow-y-auto">
        {tab === 'tasks' && (
          <>
            {teamTasks.map(task => <TaskRow key={task.id} task={task} />)}
            {teamTasks.length === 0 && (
              <div className="px-2 text-xs text-white/30">No tasks</div>
            )}
          </>
        )}
        {tab === 'messages' && (
          <>
            {teamMessages
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 50)
              .map(msg => (
                <MessageRow key={msg.id} msg={msg} agents={store.agents} />
              ))}
            {teamMessages.length === 0 && (
              <div className="px-2 text-xs text-white/30">No messages</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Panel
// =============================================================================

export function SwarmPanel() {
  const store = useSwarmStore();

  // Initialize on mount
  useEffect(() => {
    store.init();
    return () => {
      // Don't cleanup on unmount — keep subscriptions alive
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    teams,
    agents,
    panelExpanded,
    selectedTeamId,
    selectedAgentId,
    totalUnreadCount,
    totalPendingPermissions,
    activeAgentCount,
  } = store;

  // Don't render if no swarm activity
  if (teams.length === 0 && agents.length === 0) {
    return null;
  }

  return (
    <div className="bg-black/40 backdrop-blur border border-white/10 rounded-lg text-white text-sm overflow-hidden">
      {/* Header bar */}
      <button
        onClick={() => store.togglePanel()}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-medium flex-1 text-left">
          Swarm Runtime
        </span>
        {activeAgentCount > 0 && (
          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 rounded">
            {activeAgentCount} active
          </span>
        )}
        {totalUnreadCount > 0 && (
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 rounded">
            {totalUnreadCount} unread
          </span>
        )}
        {totalPendingPermissions > 0 && (
          <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded">
            {totalPendingPermissions} perms
          </span>
        )}
        <span className="text-white/30 text-[10px]">
          {panelExpanded ? '▼' : '▶'}
        </span>
      </button>

      {panelExpanded && (
        <div className="border-t border-white/10">
          <div className="flex">
            {/* Left: team/agent list */}
            <div className="w-[180px] border-r border-white/10 max-h-[500px] overflow-y-auto">
              {/* Teams */}
              {teams.map(team => (
                <div key={team.id}>
                  <button
                    onClick={() => store.selectTeam(team.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs font-medium hover:bg-white/5 flex items-center gap-1 ${
                      selectedTeamId === team.id ? 'bg-white/10' : ''
                    }`}
                  >
                    <StatusBadge status={team.status} />
                    <span className="truncate">{team.name}</span>
                  </button>

                  {/* Team agents */}
                  <div className="pl-2">
                    {agents
                      .filter(a => a.teamId === team.id)
                      .map(agent => (
                        <AgentRow
                          key={agent.id}
                          agent={agent}
                          isSelected={selectedAgentId === agent.id}
                          unreadCount={store.getAgentInboxSummary(agent.id).totalUnread}
                          onClick={() => {
                            store.selectTeam(team.id);
                            store.selectAgent(agent.id);
                          }}
                        />
                      ))}
                  </div>
                </div>
              ))}

              {teams.length === 0 && (
                <div className="p-3 text-xs text-white/30 text-center">
                  No active teams
                </div>
              )}
            </div>

            {/* Right: detail view */}
            <div className="flex-1 min-w-0 max-h-[500px] overflow-y-auto">
              {selectedAgentId ? (
                <AgentDetail agentId={selectedAgentId} />
              ) : selectedTeamId ? (
                <TeamDetail teamId={selectedTeamId} />
              ) : (
                <div className="p-4 text-xs text-white/30 text-center">
                  Select a team or agent to inspect
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
