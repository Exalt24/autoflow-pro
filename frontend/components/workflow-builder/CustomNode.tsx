"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { STEP_TYPES } from "./constants";
import type { WorkflowNodeData } from "./nodeTypes";

function CustomNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const stepInfo = STEP_TYPES[nodeData.type as keyof typeof STEP_TYPES];

  const borderColor = selected
    ? "border-blue-500"
    : nodeData.hasError
    ? "border-red-500"
    : nodeData.isCompleted
    ? "border-green-500"
    : nodeData.isActive
    ? "border-yellow-500"
    : "border-gray-300";

  return (
    <div
      className={`bg-white rounded-lg border-2 ${borderColor} shadow-md transition-all duration-200 hover:shadow-lg min-w-[200px]`}
      style={{ borderColor: selected ? undefined : stepInfo.color }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div
            className="px-2 py-1 rounded text-xs font-medium text-white"
            style={{ backgroundColor: stepInfo.color }}
          >
            {stepInfo.label}
          </div>
          <div className="flex items-center gap-1">
            {nodeData.isActive && (
              <Loader2 className="w-4 h-4 text-yellow-600 animate-spin" />
            )}
            {nodeData.isCompleted && (
              <Check className="w-4 h-4 text-green-600" />
            )}
            {nodeData.hasError && (
              <AlertCircle className="w-4 h-4 text-red-600" />
            )}
            {!nodeData.isValid &&
              !nodeData.isActive &&
              !nodeData.isCompleted && (
                <AlertCircle className="w-4 h-4 text-orange-600" />
              )}
          </div>
        </div>

        <div
          className="text-sm text-gray-700 font-medium truncate"
          title={nodeData.label}
        >
          {nodeData.label}
        </div>

        {!nodeData.isValid && (
          <div className="mt-1 text-xs text-orange-600">
            Configuration incomplete
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
