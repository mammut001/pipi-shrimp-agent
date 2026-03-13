/**
 * WorkflowView - Main workflow builder interface
 *
 * Combines canvas, config panel, execution bar, and output panel.
 * This is the main entry point for the workflow feature.
 */

import { useState } from 'react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowExecutionBar } from './WorkflowExecutionBar';
import { AgentConfigPanel } from './AgentConfigPanel';
import { WorkflowOutputPanel } from './WorkflowOutputPanel';
import { WorkflowRunHistory } from './WorkflowRunHistory';

export function WorkflowView() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [outputPanelOpen, setOutputPanelOpen] = useState(true);

  const handleAgentSelect = (id: string | null) => {
    setSelectedAgentId(id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top: Execution bar */}
      <WorkflowExecutionBar />

      {/* Main: Canvas + Config panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden bg-gray-50">
          <WorkflowCanvas
            selectedAgentId={selectedAgentId}
            onAgentSelect={handleAgentSelect}
          />
        </div>

        {/* Right: Agent config panel (320px) */}
        {selectedAgentId && (
          <div className="w-80 border-l border-gray-200 overflow-hidden">
            <AgentConfigPanel
              agentId={selectedAgentId}
              onClose={() => setSelectedAgentId(null)}
            />
          </div>
        )}
      </div>

      {/* Bottom: Output panel (collapsible, ~200px) */}
      {outputPanelOpen && (
        <div className="h-48 border-t border-gray-200">
          <WorkflowOutputPanel />
        </div>
      )}

      {/* Toggle output panel */}
      <button
        onClick={() => setOutputPanelOpen(!outputPanelOpen)}
        className="absolute bottom-0 left-1/2 transform -translate-x-1/2 px-3 py-1 bg-white border border-gray-200 border-b-0 rounded-t-lg shadow-sm text-xs text-gray-500 hover:text-gray-700"
      >
        {outputPanelOpen ? '▼' : '▲'}
      </button>

      {/* History floating panel */}
      <WorkflowRunHistory />
    </div>
  );
}

export default WorkflowView;
