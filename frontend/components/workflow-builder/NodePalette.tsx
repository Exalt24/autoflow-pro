"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import type { StepType } from "@/types";
import { STEP_TYPES, CATEGORIES } from "./constants";
import { NodePaletteItem } from "./NodePaletteItem";

interface NodePaletteProps {
  onDragStart: (event: React.DragEvent, type: StepType) => void;
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORIES)
  );

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const groupedSteps = useMemo(() => {
    const filtered = Object.entries(STEP_TYPES).filter(([, info]) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        info.label.toLowerCase().includes(searchLower) ||
        info.description.toLowerCase().includes(searchLower)
      );
    });

    const grouped: Record<
      string,
      Array<[string, (typeof STEP_TYPES)[keyof typeof STEP_TYPES]]>
    > = {};

    filtered.forEach(([type, info]) => {
      if (!grouped[info.category]) {
        grouped[info.category] = [];
      }
      grouped[info.category].push([type, info]);
    });

    return grouped;
  }, [search]);

  return (
    <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Node Palette
        </h2>
        <div className="relative">
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.keys(groupedSteps).length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No nodes found
          </div>
        ) : (
          CATEGORIES.filter((category) => groupedSteps[category]).map(
            (category) => {
              const isExpanded = expandedCategories.has(category);
              const nodes = groupedSteps[category];

              return (
                <div key={category} className="space-y-2">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span>{category}</span>
                    <span className="text-xs text-gray-500 font-normal">
                      ({nodes.length})
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 pl-2">
                      {nodes.map(([type]) => (
                        <NodePaletteItem
                          key={type}
                          type={type as StepType}
                          onDragStart={onDragStart}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            }
          )
        )}
      </div>

      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="text-xs text-gray-500">
          <p className="font-medium mb-1">💡 Tip:</p>
          <p>
            Drag nodes from the palette onto the canvas to add them to your
            workflow.
          </p>
        </div>
      </div>
    </div>
  );
}
