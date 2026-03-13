/**
 * WorkflowOutputPanel - Real-time output display panel
 *
 * Shows streaming output from each agent during workflow execution.
 * Collapsible panel at the bottom of the workflow view.
 */

import { useState, useEffect, useRef } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowEngine } from '@/services/workflowEngine';

export function WorkflowOutputPanel() {
  const { agents, isRunning } = useWorkflowStore();
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string>>(new Map());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    workflowEngine.setStreamChunkCallback((agentId, _chunk, fullContent) => {
      setAgentOutputs((prev) => {
        const newMap = new Map(prev);
        newMap.set(agentId, fullContent);
        return newMap;
      });
    });
  }, []);

  // Auto-expand running agent
  useEffect(() => {
    if (isRunning) {
      const runningAgent = agents.find((a) => a.status === 'running');
      if (runningAgent) {
        setExpandedAgents((prev) => new Set(prev).add(runningAgent.id));
      }
    }
  }, [isRunning, agents]);

  const toggleExpand = (agentId: string) => {
    setExpandedAgents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <h3 className="font-medium text-sm text-gray-900">实时输出</h3>
        <span className="text-xs text-gray-500">
          {agents.filter((a) => agentOutputs.has(a.id)).length} / {agents.length} agents
        </span>
      </div>

      {/* Output list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            添加 Agent 后将显示输出
          </div>
        ) : (
          agents.map((agent) => {
            const output = agentOutputs.get(agent.id) || '';
            const isExpanded = expandedAgents.has(agent.id);
            const isRunning = agent.status === 'running';

            return (
              <div key={agent.id} className="border-b border-gray-100">
                {/* Agent header */}
                <button
                  onClick={() => toggleExpand(agent.id)}
                  className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agent.status === 'completed'
                          ? 'bg-green-500'
                          : agent.status === 'running'
                          ? 'bg-blue-500 animate-pulse'
                          : agent.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-300'
                      }`}
                    />
                    <span className="text-sm font-medium text-gray-900">
                      {agent.name}
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Agent output */}
                {isExpanded && (
                  <div className="px-4 pb-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                      {output || (isRunning ? '等待输出...' : '无输出')}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default WorkflowOutputPanel;
