"use client";

import { X } from "lucide-react";
import { type EdgeProps, getBezierPath, BaseEdge } from "@xyflow/react";

export function EdgeDeleteButton({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onEdgeClick = () => {
    const win = window as Window & { _deleteEdge?: (edgeId: string) => void };
    win._deleteEdge?.(id);
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} />
      <g transform={`translate(${labelX}, ${labelY})`}>
        <rect
          x={-12}
          y={-12}
          width={24}
          height={24}
          rx={12}
          fill="white"
          stroke="#ef4444"
          strokeWidth={2}
          className="cursor-pointer hover:fill-red-50"
          onClick={onEdgeClick}
        />
        <foreignObject x={-10} y={-10} width={20} height={20}>
          <div className="flex items-center justify-center w-full h-full pointer-events-none">
            <X className="w-3 h-3 text-red-600" />
          </div>
        </foreignObject>
      </g>
    </>
  );
}
