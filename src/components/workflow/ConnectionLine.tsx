/**
 * ConnectionLine - SVG bezier curve connecting two agent nodes
 *
 * Renders:
 * - Invisible wide path for click detection
 * - Visible curved line with arrow marker
 * - Condition label at midpoint
 */

import React from 'react';
import type { WorkflowConnection, WorkflowAgent } from '@/types/workflow';

interface ConnectionLineProps {
  connection: WorkflowConnection;
  sourceAgent: WorkflowAgent;
  targetAgent: WorkflowAgent;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConnectionLine({
  connection,
  sourceAgent,
  targetAgent,
  isSelected,
  onSelect,
  onDelete,
}: ConnectionLineProps) {
  // Calculate connection points (right side of source, left side of target)
  const sourceWidth = 256; // w-64 = 256px
  const sourceX = sourceAgent.position.x + sourceWidth;
  const sourceY = sourceAgent.position.y + 60; // Approximate middle height

  const targetX = targetAgent.position.x;
  const targetY = targetAgent.position.y + 60;

  // Calculate control points for bezier curve
  const deltaX = targetX - sourceX;
  const controlOffset = Math.min(Math.abs(deltaX) * 0.5, 80);

  const path = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;

  // Midpoint for label
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(connection.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onDelete(connection.id);
    }
  };

  return (
    <g
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Connection from ${sourceAgent.name} to ${targetAgent.name}`}
    >
      {/* Invisible wide path for click detection */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth={12}
        fill="none"
        style={{ cursor: 'pointer' }}
      />
      {/* Visible line */}
      <path
        d={path}
        stroke={isSelected ? '#3B82F6' : '#9CA3AF'}
        strokeWidth={2}
        fill="none"
        markerEnd="url(#arrowhead)"
      />
      {/* Condition label */}
      {connection.condition && (
        <text
          x={midX}
          y={midY - 8}
          textAnchor="middle"
          fontSize={10}
          fill="#6B7280"
          className="select-none"
        >
          {connection.condition}
        </text>
      )}
    </g>
  );
}

interface PendingLineProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function PendingLine({ startX, startY, endX, endY }: PendingLineProps) {
  const deltaX = endX - startX;
  const controlOffset = Math.min(Math.abs(deltaX) * 0.5, 80);

  const path = `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;

  return (
    <path
      d={path}
      stroke="#3B82F6"
      strokeWidth={2}
      strokeDasharray="5,5"
      fill="none"
      markerEnd="url(#arrowhead)"
    />
  );
}

export default ConnectionLine;
