/**
 * WorkflowCanvas - Interactive drag-and-drop canvas for building workflow graphs
 *
 * Features:
 * - Pan canvas: middle-click drag or Space+drag
 * - Zoom canvas: mouse wheel (0.3x to 2.5x)
 * - Drag agents: mousedown on agent header, mousemove, mouseup
 * - Connect agents: drag from output port to input port
 * - Delete connection: click connection line then press Delete
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { AgentNode } from './AgentNode';
import { ConnectionLine, PendingLine } from './ConnectionLine';
import { DEFAULT_EXECUTION_CONFIG } from '@/types/workflow';

interface WorkflowCanvasProps {
  selectedAgentId: string | null;
  onAgentSelect: (id: string | null) => void;
}

export function WorkflowCanvas({ selectedAgentId, onAgentSelect }: WorkflowCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [pendingLineEnd, setPendingLineEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const {
    agents,
    connections,
    addAgent,
    removeAgent,
    updateAgentPosition,
    addConnection,
    removeConnection,
  } = useWorkflowStore();

  // Convert client coordinates to canvas coordinates
  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - canvasOffset.x) / scale,
      y: (clientY - rect.top - canvasOffset.y) / scale,
    };
  }, [canvasOffset, scale]);

  // Handle mouse wheel for zooming
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.min(Math.max(prev + delta, 0.3), 2.5));
  }, []);

  // Handle panning with middle mouse or space+drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle mouse button or space+left click
    if (e.button === 1 || (e.button === 0 && e.currentTarget === e.target)) {
      // Check if space is pressed
      if (e.button === 0 && e.currentTarget === e.target) {
        // Left click on canvas background - start panning if space held
        if (e.altKey || e.metaKey) {
          setIsPanning(true);
          setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
          return;
        }
      }
      if (e.button === 1) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
      }
    }

    // Click on background to deselect
    if (e.currentTarget === e.target) {
      onAgentSelect(null);
      setSelectedConnectionId(null);
    }
  }, [canvasOffset, onAgentSelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setCanvasOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    // Dragging an agent
    if (draggingAgentId) {
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);
      updateAgentPosition(draggingAgentId, {
        x: x - dragStartPos.x,
        y: y - dragStartPos.y,
      });
    }

    // Drawing a connection line
    if (connectingFrom) {
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);
      setPendingLineEnd({ x, y });
    }
  }, [isPanning, panStart, draggingAgentId, dragStartPos, connectingFrom, toCanvasCoords, updateAgentPosition]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggingAgentId(null);
    setConnectingFrom(null);
    setPendingLineEnd(null);
  }, []);

  // Handle agent drag start
  const handleAgentMouseDown = useCallback((e: React.MouseEvent, agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setDraggingAgentId(agentId);
    setDragStartPos({
      x: x - agent.position.x,
      y: y - agent.position.y,
    });
  }, [agents, toCanvasCoords]);

  // Handle connection start (from output port)
  const handleOutputPortMouseDown = useCallback((e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    setConnectingFrom(agentId);
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setPendingLineEnd({ x, y });
  }, [toCanvasCoords]);

  // Handle connection end (at input port)
  const handleInputPortMouseUp = useCallback((e: React.MouseEvent, targetAgentId: string) => {
    e.stopPropagation();
    if (connectingFrom && connectingFrom !== targetAgentId) {
      addConnection(connectingFrom, targetAgentId, 'onComplete');
    }
    setConnectingFrom(null);
    setPendingLineEnd(null);
  }, [connectingFrom, addConnection]);

  // Handle keyboard for deleting connection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnectionId) {
        removeConnection(selectedConnectionId);
        setSelectedConnectionId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedConnectionId, removeConnection]);

  // Get connection start position
  const getConnectionStartPos = () => {
    if (!connectingFrom) return null;
    const source = agents.find((a) => a.id === connectingFrom);
    if (!source) return null;
    return {
      x: source.position.x + 256, // Right side of agent
      y: source.position.y + 60, // Approximate middle
    };
  };

  const connectionStart = getConnectionStartPos();

  return (
    <div
      ref={canvasRef}
      className="w-full h-full overflow-hidden bg-gray-50 relative"
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* SVG Layer for connections */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${scale})` }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
          </marker>
        </defs>

        {/* Existing connections */}
        {connections.map((conn) => {
          const source = agents.find((a) => a.id === conn.sourceAgentId);
          const target = agents.find((a) => a.id === conn.targetAgentId);
          if (!source || !target) return null;

          return (
            <ConnectionLine
              key={conn.id}
              connection={conn}
              sourceAgent={source}
              targetAgent={target}
              isSelected={selectedConnectionId === conn.id}
              onSelect={setSelectedConnectionId}
              onDelete={removeConnection}
            />
          );
        })}

        {/* Pending connection line */}
        {connectingFrom && pendingLineEnd && connectionStart && (
          <PendingLine
            startX={connectionStart.x}
            startY={connectionStart.y}
            endX={pendingLineEnd.x}
            endY={pendingLineEnd.y}
          />
        )}
      </svg>

      {/* Agent nodes layer */}
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${scale})`, transformOrigin: '0 0' }}
      >
        {agents.map((agent) => (
          <AgentNode
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onSelect={onAgentSelect}
            onMouseDown={handleAgentMouseDown}
            onOutputPortMouseDown={handleOutputPortMouseDown}
            onInputPortMouseUp={handleInputPortMouseUp}
            onDelete={removeAgent}
          />
        ))}
      </div>

      {/* Add Agent button */}
      <button
        className="absolute bottom-4 right-4 px-4 py-2 bg-gray-900 text-white rounded-lg shadow-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
        onClick={() => {
          addAgent({ name: 'New Agent', execution: DEFAULT_EXECUTION_CONFIG });
        }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Agent
      </button>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 px-2 py-1 bg-white rounded shadow text-xs text-gray-500">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}

export default WorkflowCanvas;
