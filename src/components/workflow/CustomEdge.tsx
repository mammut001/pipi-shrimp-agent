/**
 * CustomEdge - React Flow custom edge with condition label
 *
 * Features:
 * - Smooth bezier curve
 * - Condition label with background
 * - Bidirectional bypass arc (when two nodes connect to each other)
 */

import React from 'react';
import { getBezierPath, EdgeLabelRenderer, type EdgeProps, useReactFlow } from '@xyflow/react';

export interface CustomEdgeData {
  condition?: string;
}

function CustomEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  source,
  target,
}: EdgeProps): React.ReactElement {
  const { getEdges } = useReactFlow();

  // Check if there's a reverse connection (bidirectional)
  const reverseEdge = getEdges().find(
    (e) => e.source === target && e.target === source
  );

  // Calculate bezier path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  });

  const label = (data as CustomEdgeData | undefined)?.condition || 'onComplete';

  return (
    <>
      {/* Main edge path */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={selected ? '#3B82F6' : '#9CA3AF'}
        strokeWidth={selected ? 2.5 : 2}
        fill="none"
        markerEnd={markerEnd}
        style={{ cursor: 'pointer' }}
      />

      {/* Bidirectional bypass arc */}
      {reverseEdge && (
        <path
          d={`M ${sourceX} ${sourceY - 20} C ${sourceX} ${sourceY - 60}, ${targetX} ${targetY - 60}, ${targetX} ${targetY - 20}`}
          stroke={selected ? '#3B82F6' : '#9CA3AF'}
          strokeWidth={1.5}
          strokeDasharray="4,4"
          fill="none"
          opacity={0.5}
        />
      )}

      {/* Label */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div className="px-2 py-0.5 bg-white border border-gray-200 rounded text-[10px] text-gray-600 shadow-sm select-none">
            {label}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export { CustomEdgeComponent as CustomEdge };
export default CustomEdgeComponent;
