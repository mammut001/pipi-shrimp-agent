/**
 * AgentNode - A card component representing an agent in the workflow canvas
 *
 * Displays:
 * - Agent name and status indicator
 * - Task description
 * - Model info and execution mode
 * - Input/Output ports for connections
 */

import React from 'react';
import type { WorkflowAgent } from '@/types/workflow';

interface AgentNodeProps {
  agent: WorkflowAgent;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onOutputPortMouseDown: (e: React.MouseEvent, id: string) => void;
  onInputPortMouseUp: (e: React.MouseEvent, id: string) => void;
  onDelete: (id: string) => void;
}

export function AgentNode({
  agent,
  isSelected,
  onSelect,
  onMouseDown,
  onOutputPortMouseDown,
  onInputPortMouseUp,
  onDelete,
}: AgentNodeProps) {
  const statusColors = {
    idle: 'border-gray-200',
    running: 'border-blue-500 animate-pulse',
    completed: 'border-green-500',
    error: 'border-red-500',
  };

  const statusBgColors = {
    idle: 'bg-gray-400',
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    error: 'bg-red-500',
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't start drag if clicking on ports or delete button
    if (
      (e.target as HTMLElement).closest('.port') ||
      (e.target as HTMLElement).closest('.delete-btn')
    ) {
      return;
    }
    onMouseDown(e, agent.id);
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOutputPortMouseDown(e, agent.id);
  };

  const handleInputPortMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInputPortMouseUp(e, agent.id);
  };

  return (
    <div
      className={`absolute w-64 bg-white rounded-xl border-2 shadow-sm transition-all duration-200 ${
        statusColors[agent.status]
      } ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
      style={{
        left: agent.position.x,
        top: agent.position.y,
      }}
      onClick={() => onSelect(agent.id)}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 cursor-move">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusBgColors[agent.status]}`} />
          <span className="font-medium text-sm text-gray-900 truncate max-w-40">
            {agent.name}
          </span>
        </div>
        <button
          className="delete-btn p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(agent.id);
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-xs text-gray-600 space-y-1">
        {agent.task && (
          <p className="truncate" title={agent.task}>
            {agent.task}
          </p>
        )}
        <p className="text-gray-400">
          Mode: {agent.execution.mode === 'single' ? '单次执行' : `多轮执行 (${agent.execution.maxRounds || 3}x)`}
        </p>
      </div>

      {/* Footer with ports */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
        {/* Input Port */}
        <div
          className="port w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm cursor-crosshair hover:bg-gray-400"
          onMouseUp={handleInputPortMouseUp}
          title="Input"
        />

        {/* Output Port */}
        <div
          className="port w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm cursor-crosshair hover:bg-gray-400"
          onMouseDown={handleOutputPortMouseDown}
          title="Output"
        />
      </div>
    </div>
  );
}

export default AgentNode;
