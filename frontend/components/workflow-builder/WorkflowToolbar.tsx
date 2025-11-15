"use client";

import {
  Maximize,
  Grid3x3,
  CheckCircle,
  Trash2,
  AlertCircle,
  Keyboard,
} from "lucide-react";
import { useState } from "react";

interface WorkflowToolbarProps {
  onFitView: () => void;
  onAutoLayout: () => void;
  onValidate: () => void;
  onClear: () => void;
  hasNodes: boolean;
  errorCount: number;
  warningCount: number;
}

export function WorkflowToolbar({
  onFitView,
  onAutoLayout,
  onValidate,
  onClear,
  hasNodes,
  errorCount,
  warningCount,
}: WorkflowToolbarProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-2 z-10">
        <button
          onClick={onFitView}
          disabled={!hasNodes}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Fit view to canvas (F)"
        >
          <Maximize className="w-4 h-4" />
          <span>Fit View</span>
        </button>

        <div className="w-px h-6 bg-gray-300" />

        <button
          onClick={onAutoLayout}
          disabled={!hasNodes}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Auto-arrange nodes"
        >
          <Grid3x3 className="w-4 h-4" />
          <span>Auto Layout</span>
        </button>

        <div className="w-px h-6 bg-gray-300" />

        <button
          onClick={onValidate}
          disabled={!hasNodes}
          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
            errorCount > 0
              ? "text-red-700 bg-red-50 hover:bg-red-100"
              : warningCount > 0
              ? "text-yellow-700 bg-yellow-50 hover:bg-yellow-100"
              : "text-green-700 bg-green-50 hover:bg-green-100"
          }`}
          title="Validate workflow"
        >
          {errorCount > 0 ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          <span>Validate</span>
          {(errorCount > 0 || warningCount > 0) && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-white rounded">
              {errorCount + warningCount}
            </span>
          )}
        </button>

        <div className="w-px h-6 bg-gray-300" />

        <button
          onClick={onClear}
          disabled={!hasNodes}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Clear all nodes"
        >
          <Trash2 className="w-4 h-4" />
          <span>Clear All</span>
        </button>

        <div className="w-px h-6 bg-gray-300" />

        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          title="Keyboard shortcuts"
        >
          <Keyboard className="w-4 h-4" />
        </button>
      </div>

      {showShortcuts && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10">
          <h4 className="font-semibold text-gray-900 mb-3">
            Keyboard Shortcuts
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Delete node</span>
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">
                Delete
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Deselect</span>
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">
                Esc
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Fit view</span>
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">
                F
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Save workflow</span>
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">
                Ctrl+S
              </kbd>
            </div>
          </div>
          <button
            onClick={() => setShowShortcuts(false)}
            className="mt-3 w-full px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
