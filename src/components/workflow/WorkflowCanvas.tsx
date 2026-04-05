/**
 * WorkflowCanvas - React Flow powered canvas for building workflow graphs
 *
 * Migrated from hand-written SVG+Div canvas to @xyflow/react for:
 * - Built-in pan/zoom/fit controls
 * - Background dot pattern
 * - NodeResizer support
 * - Automatic edge routing
 * - Drag-and-drop node positioning
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '@/store/workflowStore';
import { AgentNode } from './AgentNode';
import { CustomEdge } from './CustomEdge';
import { AgentTemplateDrawer } from './AgentTemplateDrawer';
import type { WorkflowAgent, WorkflowConnection, RouteCondition, AgentTemplate } from '@/types/workflow';

const nodeTypes = {
  agent: AgentNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

interface WorkflowCanvasProps {
  selectedAgentId: string | null;
  onAgentSelect: (id: string | null) => void;
}

const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({ selectedAgentId, onAgentSelect }) => {
  const {
    agents,
    connections,
    addAgent,
    removeAgent,
    updateAgentPosition,
  } = useWorkflowStore();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [templateDrawerPosition, setTemplateDrawerPosition] = useState<{ x: number; y: number } | null>(null);

  // Convert store agents to React Flow nodes
  const initialNodes: Node[] = useMemo(() => {
    return agents.map((agent: WorkflowAgent) => ({
      id: agent.id,
      type: 'agent',
      position: agent.position,
      style: {
        width: agent.width ?? 240,
        height: agent.height,
      },
      selected: agent.id === selectedAgentId,
      data: {
        agent,
        allAgents: agents,
        onRemove: removeAgent,
        onRemoveSkill: () => {},
        onAddSkill: () => {},
        onUpdateName: (id: string, name: string) => {
          useWorkflowStore.getState().updateAgent(id, { name });
        },
        onUpdateSize: updateAgentPosition,
        onSetInputFrom: (agentId: string, fromId: string | null) => {
          useWorkflowStore.getState().setAgentInputFrom(agentId, fromId);
        },
        onAddRoute: (agentId: string, condition: RouteCondition, targetAgentId: string, keyword?: string) => {
          useWorkflowStore.getState().addOutputRoute(agentId, {
            condition,
            targetAgentId,
            keyword: condition === 'outputContains' ? keyword : undefined,
          });
        },
        onRemoveRoute: (agentId: string, routeId: string) => {
          useWorkflowStore.getState().removeOutputRoute(agentId, routeId);
        },
        onUpdateRoute: (agentId: string, routeId: string, updates: { condition?: RouteCondition; keyword?: string; targetAgentId?: string }) => {
          useWorkflowStore.getState().updateOutputRoute(agentId, routeId, updates);
        },
        onSelect: (id: string) => onAgentSelect(id),
      },
    }));
  }, [agents, selectedAgentId, removeAgent, updateAgentPosition, onAgentSelect]);

  // Convert store connections to React Flow edges
  const initialEdges: Edge[] = useMemo(() => {
    return connections.map((conn: WorkflowConnection) => ({
      id: conn.id,
      source: conn.sourceAgentId,
      target: conn.targetAgentId,
      type: 'custom',
      label: conn.condition,
      labelBgStyle: { fill: '#f9fafb' },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#9CA3AF', strokeWidth: 2 },
      animated: false,
    }));
  }, [connections]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes from store when agents change
  React.useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // Sync edges from store when connections change
  React.useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Handle new visual connections (edges)
  // Note: Connections should be configured in the panel, not by dragging
  // This only adds visual edges without modifying the store
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;

      // Check if connection already exists in store
      const exists = connections.some(
        (c) => c.sourceAgentId === params.source && c.targetAgentId === params.target
      );

      if (!exists) {
        // Don't allow manual connection creation - show a hint instead
        // The user should configure connections in the agent panel
        console.info('请在 Agent 配置面板中设置输入/输出连接');
        return;
      }

      // If connection exists, add visual edge
      const conn = connections.find(
        (c) => c.sourceAgentId === params.source && c.targetAgentId === params.target
      );

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: conn?.id || crypto.randomUUID(),
            type: 'custom',
            label: conn?.condition || 'onComplete',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#9CA3AF', strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [connections, setEdges]
  );

  // Handle edge deletion - only removes visual edge, not the actual connection
  // Actual connection removal should be done in the panel
  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      // Just remove visual edges, don't touch the store
      // Store connections are managed through the panel
      setEdges((eds) => eds.filter((e) => !deletedEdges.some((de) => de.id === e.id)));
    },
    [setEdges]
  );

  // Handle node selection
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onAgentSelect(node.id);
    },
    [onAgentSelect]
  );

  // Handle canvas click (deselect)
  const onPaneClick = useCallback(() => {
    onAgentSelect(null);
    setContextMenu(null);
  }, [onAgentSelect]);

  // Handle right-click context menu
  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
    if (bounds) {
      setContextMenu({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    }
  }, []);

  // Add agent at context menu position (opens template drawer)
  const handleAddAgent = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const reactFlowBounds = (e.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = {
        x: e.clientX - reactFlowBounds.left,
        y: e.clientY - reactFlowBounds.top,
      };

      setTemplateDrawerPosition(position);
      setTemplateDrawerOpen(true);
      setContextMenu(null);
    },
    []
  );

  // Add agent from template
  const handleAddFromTemplate = useCallback(
    (template: AgentTemplate, position?: { x: number; y: number }) => {
      const newAgent = addAgent({
        name: template.name,
        soulPrompt: template.soulPrompt,
        task: template.task,
        execution: template.execution,
      });

      // Update position if provided
      if (position) {
        useWorkflowStore.getState().updateAgentPosition(newAgent.id, position);
      }

      setTemplateDrawerOpen(false);
      setTemplateDrawerPosition(null);
    },
    [addAgent]
  );

  // Add agent via button (center of viewport)
  const handleAddAgentButton = useCallback(() => {
    setTemplateDrawerOpen(true);
    setTemplateDrawerPosition(null);
  }, []);

  // Handle keyboard delete
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAgentId) {
        // Don't delete if typing in an input
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
          return;
        }
        removeAgent(selectedAgentId);
        onAgentSelect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAgentId, removeAgent, onAgentSelect]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onContextMenu={onContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2.5}
        defaultEdgeOptions={{
          type: 'custom',
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        className="bg-gray-50"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        <Controls showInteractive={false} className="bg-white border border-gray-200 rounded-lg shadow-md" />

        {/* Add Agent Panel */}
        <Panel position="bottom-right" className="flex flex-col gap-2">
          <button
            onClick={handleAddAgentButton}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg shadow-lg hover:bg-gray-800 transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Agent
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg shadow hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear All
          </button>
          <button
            onClick={() => useWorkflowStore.getState().createA_B_C_Workflow()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg shadow-lg hover:bg-purple-700 transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            A→B→C 预设
          </button>
        </Panel>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y, transform: 'translate(-50%, -50%)' }}
            onMouseLeave={() => setContextMenu(null)}
          >
            <button
              onClick={handleAddAgent}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-gray-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Agent Here
            </button>
          </div>
        )}
      </ReactFlow>

      {/* Agent Template Drawer */}
      <AgentTemplateDrawer
        isOpen={templateDrawerOpen}
        onClose={() => {
          setTemplateDrawerOpen(false);
          setTemplateDrawerPosition(null);
        }}
        onSelect={(template) => handleAddFromTemplate(template, templateDrawerPosition || undefined)}
      />

      {/* Clear confirmation dialog */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4">
            <h3 className="font-medium text-gray-900 mb-2">确认清空画布？</h3>
            <p className="text-sm text-gray-500 mb-4">这将删除所有 Agent 和连接。此操作不可撤销。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={() => {
                  useWorkflowStore.getState().clearCanvas();
                  setShowClearConfirm(false);
                  onAgentSelect(null);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { WorkflowCanvas };
export default WorkflowCanvas;
