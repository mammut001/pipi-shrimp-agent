/**
 * SwarmPanel — Runtime-bound swarm UI
 *
 * Styled to match AgentPanel (Notion/Vercel aesthetic):
 * - White/light gray background
 * - Clean borders and typography
 * - Consistent color palette
 */

import { useEffect, useState } from 'react';
import { useSwarmStore } from '../store/swarmStore';
import type {
  SwarmAgent,
  SwarmTask,
  SwarmMessage,
  TranscriptEntry,
} from '../services/swarm/types';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500',
    working: 'bg-yellow-500',
    idle: 'bg-gray-300',
    completed: 'bg-blue-500',
    failed: 'bg-red-500',
    interrupted: 'bg-orange-400',
    pending: 'bg-gray-200',
    claimed: 'bg-yellow-400',
    in_progress: 'bg-yellow-500',
    disbanded: 'bg-gray-400',
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
      className={`w-full text-left px-3 py-2 text-xs rounded-lg flex items-center gap-2 transition-all ${
        isSelected
          ? 'bg-gray-100 ring-1 ring-gray-200'
          : 'hover:bg-gray-50'
      }`}
    >
      <StatusBadge status={agent.status} />
      <span className="flex-1 truncate text-black font-medium">
        {agent.name}
        {agent.role === 'leader' && (
          <span className="ml-1 text-[10px] text-yellow-600 font-semibold">★</span>
        )}
      </span>
      {unreadCount > 0 && (
        <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {unreadCount}
        </span>
      )}
      <span className="text-[10px] text-black capitalize">{agent.status}</span>
    </button>
  );
}

function TaskRow({ task }: { task: SwarmTask }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-gray-200 text-black',
    claimed: 'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <StatusBadge status={task.status} />
      <span className="flex-1 truncate text-black">{task.description}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[task.status] || 'bg-gray-100 text-black'}`}>
        {task.status.replace('_', ' ')}
      </span>
    </div>
  );
}

function MessageRow({ msg, agents }: { msg: SwarmMessage; agents: SwarmAgent[] }) {
  const [expanded, setExpanded] = useState(false);
  const from = agents.find(a => a.id === msg.fromAgentId);
  const to = agents.find(a => a.id === msg.toAgentId);
  const isUnread = !msg.readAt;

  const typeColors: Record<string, string> = {
    task_assignment: 'bg-purple-100 text-purple-700',
    task_result: 'bg-green-100 text-green-700',
    question: 'bg-blue-100 text-blue-700',
    answer: 'bg-gray-100 text-black',
    status_update: 'bg-yellow-100 text-yellow-700',
    permission_request: 'bg-red-100 text-red-700',
    permission_result: 'bg-green-100 text-green-700',
  };

  const isLong = true;

  return (
    <div
      className={`px-3 py-2 text-xs border-l-2 ${
        isUnread ? 'bg-blue-50 border-blue-400' : 'border-gray-100'
      } ${isLong ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-black font-medium">{from?.name || 'unknown'}</span>
        <span className="text-[10px] text-black">→</span>
        <span className="text-black font-medium">{to?.name || 'unknown'}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeColors[msg.messageType] || 'bg-gray-100 text-black'}`}>
          {msg.messageType.replace('_', ' ')}
        </span>
        {isLong && (
          <span className="text-blue-500 text-[10px] ml-auto">{expanded ? '▲' : '▼'}</span>
        )}
        {isUnread && !expanded && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse ml-1" />
        )}
      </div>
      <div className={`text-black mt-0.5 text-[11px] ${expanded ? 'whitespace-pre-wrap break-all max-h-96 overflow-y-auto' : 'truncate'}`}>{msg.content || '—'}</div>
    </div>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  const [expanded, setExpanded] = useState(false);
  const eventConfig: Record<string, { icon: string; bg: string }> = {
    agent_started: { icon: '🚀', bg: 'bg-gray-50' },
    user_prompt_injected: { icon: '📝', bg: 'bg-blue-50' },
    assistant_output: { icon: '🤖', bg: 'bg-gray-50' },
    tool_called: { icon: '🔧', bg: 'bg-yellow-50' },
    tool_result: { icon: '📋', bg: 'bg-green-50' },
    permission_requested: { icon: '🔐', bg: 'bg-red-50' },
    permission_resolved: { icon: '✅', bg: 'bg-green-50' },
    agent_completed: { icon: '✔️', bg: 'bg-green-50' },
    agent_failed: { icon: '❌', bg: 'bg-red-50' },
  };

  const config = eventConfig[entry.eventType] || { icon: '·', bg: 'bg-gray-50' };
  const isLong = true;

  return (
    <div
      className={`px-3 py-1.5 text-xs border-l-2 border-gray-100 ${config.bg} ${isLong ? 'cursor-pointer hover:bg-gray-100' : ''}`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-1.5">
        <span>{config.icon}</span>
        <span className="text-black text-[10px]">{entry.eventType.replace('_', ' ')}</span>
        {entry.toolName && (
          <span className="text-black text-[10px]">({entry.toolName})</span>
        )}
        <span className="text-black text-[10px] ml-auto">
          {new Date(entry.createdAt).toLocaleTimeString()}
        </span>
        {isLong && (
          <span className="text-blue-500 text-[10px] ml-1">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      <div className={`text-black mt-0.5 text-[11px] ${expanded ? 'whitespace-pre-wrap break-all max-h-96 overflow-y-auto' : 'truncate'}`}>{entry.content || '—'}</div>
    </div>
  );
}

function AgentDetail({ agentId }: { agentId: string }) {
  const store = useSwarmStore();
  const agent = store.agents.find(a => a.id === agentId);
  if (!agent) return <div className="p-4 text-xs text-black">Agent not found</div>;

  const transcript = store.getSelectedAgentTranscript();
  const summary = store.getAgentTranscriptSummary(agentId);
  const inbox = store.getAgentInboxSummary(agentId);
  const currentTask = agent.currentTaskId
    ? store.tasks.find(t => t.id === agent.currentTaskId)
    : null;

  return (
    <div className="space-y-4">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={agent.status} />
          <span className="text-sm font-bold text-black">{agent.name}</span>
          {agent.role === 'leader' && (
            <span className="text-[10px] text-yellow-600 font-semibold bg-yellow-50 px-1.5 py-0.5 rounded">leader</span>
          )}
        </div>
        <div className="text-[11px] text-black mt-1">
          ID: {agent.id.slice(-8)} · Model: {agent.model || 'default'}
        </div>
      </div>

      {currentTask && (
        <div className="px-4">
          <div className="text-[10px] text-black font-semibold uppercase tracking-wide mb-2">Current Task</div>
          <TaskRow task={currentTask} />
        </div>
      )}

      <div className="px-4">
        <div className="text-[10px] text-black font-semibold uppercase tracking-wide mb-2">
          Inbox <span className="text-black">({inbox.totalUnread} unread)</span>
        </div>
        {inbox.totalUnread === 0 ? (
          <div className="text-xs text-black py-2">No unread messages</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(inbox.byType).map(([type, count]) => (
              <div key={type} className="text-xs text-black py-1 flex justify-between">
                <span className="capitalize">{type.replace('_', ' ')}</span>
                <span className="text-black">{count as number}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <TranscriptSection transcript={transcript} totalEntries={summary.totalEntries} />
    </div>
  );
}

function TranscriptSection({ transcript, totalEntries }: { transcript: TranscriptEntry[]; totalEntries: number }) {
  const COLLAPSED_COUNT = 6;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? transcript : transcript.slice(-COLLAPSED_COUNT);
  const hiddenCount = transcript.length - shown.length;

  return (
    <div>
      <div className="px-4 flex items-center justify-between">
        <div className="text-[10px] text-black font-semibold uppercase tracking-wide">
          Transcript <span className="text-black">({totalEntries} entries)</span>
        </div>
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-blue-600 hover:text-blue-700 font-medium"
          >
            {expanded ? 'Show less' : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
      <div className="max-h-[250px] overflow-y-auto mt-2">
        {shown.length > 0 ? (
          shown.map(entry => <TranscriptRow key={entry.id} entry={entry} />)
        ) : (
          <div className="px-4 text-xs text-black py-2">No transcript entries</div>
        )}
      </div>
    </div>
  );
}

function TeamDetail({ teamId }: { teamId: string }) {
  const store = useSwarmStore();
  const team = store.teams.find(t => t.id === teamId);
  if (!team) return <div className="p-4 text-xs text-black">Team not found</div>;

  const teamTasks = store.getSelectedTeamTasks();
  const teamMessages = store.getSelectedTeamMessages();
  const taskSummary = store.getTeamTaskSummary(teamId);
  const pendingPerms = store.pendingPermissions.filter(p => p.teamId === teamId);
  const unreadMessages = teamMessages.filter(m => !m.readAt);

  const [tab, setTab] = useState<'tasks' | 'messages'>('tasks');

  return (
    <div className="space-y-4">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={team.status} />
          <span className="text-sm font-bold text-black">{team.name}</span>
        </div>
        {team.description && (
          <div className="text-xs text-black mt-1">{team.description}</div>
        )}
        <div className="text-[11px] text-black mt-1">
          Tasks: {taskSummary.completed}/{taskSummary.total}
          {pendingPerms.length > 0 && (
            <span className="text-red-500 ml-2">· {pendingPerms.length} pending permissions</span>
          )}
        </div>
      </div>

      <div className="px-4 flex gap-1">
        <button
          onClick={() => setTab('tasks')}
          className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === 'tasks'
              ? 'bg-gray-800 text-white'
              : 'bg-gray-100 text-black hover:bg-gray-200'
          }`}
        >
          Tasks ({teamTasks.length})
        </button>
        <button
          onClick={() => setTab('messages')}
          className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
            tab === 'messages'
              ? 'bg-gray-800 text-white'
              : 'bg-gray-100 text-black hover:bg-gray-200'
          }`}
        >
          Messages
          {unreadMessages.length > 0 && (
            <span className="bg-blue-500 text-white text-[10px] px-1 py-0.5 rounded-full">
              {unreadMessages.length}
            </span>
          )}
        </button>
      </div>

      <div className="max-h-[300px] overflow-y-auto">
        {tab === 'tasks' && (
          <>
            {teamTasks.map(task => <TaskRow key={task.id} task={task} />)}
            {teamTasks.length === 0 && (
              <div className="px-4 text-xs text-black py-4 text-center">No tasks</div>
            )}
          </>
        )}
        {tab === 'messages' && (
          <>
            {teamMessages.length > 0 ? (
              teamMessages
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 30)
                .map(msg => <MessageRow key={msg.id} msg={msg} agents={store.agents} />)
            ) : (
              <div className="px-4 text-xs text-black py-4 text-center">No messages</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SwarmPanel() {
  const store = useSwarmStore();

  useEffect(() => {
    store.init();
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

  if (teams.length === 0 && agents.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => store.togglePanel()}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-bold text-black flex-1 text-left">
          🪼 Swarm Runtime
        </span>
        <div className="flex items-center gap-2">
          {activeAgentCount > 0 && (
            <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
              {activeAgentCount} active
            </span>
          )}
          {totalUnreadCount > 0 && (
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              {totalUnreadCount} unread
            </span>
          )}
          {totalPendingPermissions > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              {totalPendingPermissions} perms
            </span>
          )}
        </div>
        <span className="text-black text-xs">
          {panelExpanded ? '▲' : '▼'}
        </span>
      </button>

      {panelExpanded && (
        <div className="border-t border-gray-100">
          <div className="flex max-h-[400px] overflow-hidden">
            <div className="w-[200px] border-r border-gray-100 overflow-y-auto">
              {teams.map(team => {
                const teamAgents = agents.filter(a => a.teamId === team.id);
                const activeAgents = teamAgents.filter(a => a.status === 'idle' || a.status === 'working');
                const completedAgents = teamAgents.filter(a => a.status !== 'idle' && a.status !== 'working');
                const isTeamSelected = selectedTeamId === team.id;
                const isTeamDone = team.status === 'disbanded' || team.status === 'completed';

                return (
                  <div key={team.id}>
                    <button
                      onClick={() => store.selectTeam(team.id)}
                      className={`w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                        isTeamSelected ? 'bg-gray-50' : ''
                      } ${isTeamDone ? 'opacity-50' : ''}`}
                    >
                      <StatusBadge status={team.status} />
                      <span className="flex-1 truncate text-black">{team.name}</span>
                      <span className="text-[10px] text-black">({teamAgents.length})</span>
                    </button>

                    {isTeamSelected && (
                      <div className="pl-2 pr-2 pb-2 space-y-0.5">
                        {activeAgents.map(agent => (
                          <AgentRow
                            key={agent.id}
                            agent={agent}
                            isSelected={selectedAgentId === agent.id}
                            unreadCount={store.getAgentInboxSummary(agent.id).totalUnread}
                            onClick={() => store.selectAgent(agent.id)}
                          />
                        ))}
                        {completedAgents.length > 0 && (
                          <>
                            <div className="text-[10px] text-black px-2 py-1 mt-1">Completed</div>
                            {completedAgents.map(agent => (
                              <AgentRow
                                key={agent.id}
                                agent={agent}
                                isSelected={selectedAgentId === agent.id}
                                unreadCount={store.getAgentInboxSummary(agent.id).totalUnread}
                                onClick={() => store.selectAgent(agent.id)}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {teams.length === 0 && (
                <div className="p-4 text-xs text-black text-center">No active teams</div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50/50">
              {selectedAgentId ? (
                <AgentDetail agentId={selectedAgentId} />
              ) : selectedTeamId ? (
                <TeamDetail teamId={selectedTeamId} />
              ) : (
                <div className="p-8 text-xs text-black text-center">
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
