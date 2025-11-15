"use client";

import { AlertCircle, AlertTriangle, CheckCircle, X } from "lucide-react";
import type { ValidationError } from "./utils";

interface ValidationPanelProps {
  errors: ValidationError[];
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

export function ValidationPanel({
  errors,
  onClose,
  onNodeClick,
}: ValidationPanelProps) {
  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warningCount = errors.filter((e) => e.severity === "warning").length;

  return (
    <div className="absolute top-4 right-4 w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {errorCount === 0 && warningCount === 0 ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-gray-900">Workflow Valid</h3>
            </>
          ) : (
            <>
              {errorCount > 0 ? (
                <AlertCircle className="w-5 h-5 text-red-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              )}
              <h3 className="font-semibold text-gray-900">
                {errorCount > 0 ? "Validation Errors" : "Warnings"}
              </h3>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close validation panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 max-h-96 overflow-y-auto">
        {errorCount === 0 && warningCount === 0 ? (
          <p className="text-sm text-gray-600">
            All steps are properly configured and connected. Your workflow is
            ready to execute.
          </p>
        ) : (
          <div className="space-y-2">
            {errors.map((error, index) => (
              <div
                key={index}
                onClick={() =>
                  error.nodeId !== "workflow" && onNodeClick(error.nodeId)
                }
                className={`p-3 rounded-lg border ${
                  error.severity === "error"
                    ? "bg-red-50 border-red-200"
                    : "bg-yellow-50 border-yellow-200"
                } ${
                  error.nodeId !== "workflow"
                    ? "cursor-pointer hover:opacity-80"
                    : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  {error.severity === "error" ? (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                  )}
                  <p
                    className={`text-sm ${
                      error.severity === "error"
                        ? "text-red-800"
                        : "text-yellow-800"
                    }`}
                  >
                    {error.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {(errorCount > 0 || warningCount > 0) && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Summary:</span>
              <div className="flex items-center gap-4">
                {errorCount > 0 && (
                  <span className="text-red-600 font-medium">
                    {errorCount} error{errorCount !== 1 ? "s" : ""}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="text-yellow-600 font-medium">
                    {warningCount} warning{warningCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
