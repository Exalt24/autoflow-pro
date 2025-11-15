"use client";

import type { StepType } from "@/types";
import { STEP_TYPES } from "./constants";

interface NodePaletteItemProps {
  type: StepType;
  onDragStart: (event: React.DragEvent, type: StepType) => void;
}

export function NodePaletteItem({ type, onDragStart }: NodePaletteItemProps) {
  const stepInfo = STEP_TYPES[type as keyof typeof STEP_TYPES];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type)}
      className="p-3 bg-white border-2 border-gray-200 rounded-lg cursor-move hover:border-gray-400 hover:shadow-md transition-all duration-200 group"
      style={{ borderLeftColor: stepInfo.color, borderLeftWidth: "4px" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: stepInfo.color }}
        >
          {stepInfo.label.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 group-hover:text-gray-700">
            {stepInfo.label}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
            {stepInfo.description}
          </div>
        </div>
      </div>
    </div>
  );
}
