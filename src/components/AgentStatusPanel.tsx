/**
 * Agent Status Panel
 *
 * Shows running agents, their status, and task list.
 */

import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

interface AgentInfo {
  agentId: string;
  sessionId: string;
  content: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

export function AgentStatusPanel() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    // Listen for agent completion
    const unlistenComplete = listen<{
      agent_id: string;
      session_id: string;
      content: string;
      success: boolean;
      error?: string;
    }>('agent-complete', (event) => {
      setAgents(prev => [...prev, {
        agentId: event.payload.agent_id,
        sessionId: event.payload.session_id,
        content: event.payload.content,
        success: event.payload.success,
        error: event.payload.error,
        timestamp: Date.now(),
      }]);
    });

    // Listen for subagent completion (from TS side)
    const unlistenSubagent = listen<{
      agentId: string;
      sessionId: string;
      content: string;
      success: boolean;
      error?: string;
    }>('subagent-complete', (event) => {
      setAgents(prev => [...prev, {
        agentId: event.payload.agentId,
        sessionId: event.payload.sessionId,
        content: event.payload.content,
        success: event.payload.success,
        error: event.payload.error,
        timestamp: Date.now(),
      }]);
    });

    return () => {
      unlistenComplete.then(fn => fn());
      unlistenSubagent.then(fn => fn());
    };
  }, []);

  if (agents.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-700">Agents ({agents.length})</h3>
        <button
          onClick={() => setAgents([])}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Clear
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {agents.map((agent) => (
          <div
            key={agent.agentId}
            className="border-b border-gray-100 last:border-b-0"
          >
            <div
              className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-2"
              onClick={() => setExpandedId(expandedId === agent.agentId ? null : agent.agentId)}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.success ? 'bg-green-500' : 'bg-red-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 truncate">
                  {agent.agentId.slice(0, 12)}...
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(agent.timestamp).toLocaleTimeString()}
                </p>
              </div>
              <svg
                className={`w-3 h-3 text-gray-400 transition-transform ${expandedId === agent.agentId ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {expandedId === agent.agentId && (
              <div className="px-3 pb-2">
                <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {agent.error || agent.content.slice(0, 500)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
