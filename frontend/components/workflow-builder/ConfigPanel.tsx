"use client";

import { useState } from "react";
import { X, Trash2, AlertCircle } from "lucide-react";
import type { WorkflowNode } from "./nodeTypes";
import type { StepConfig } from "@/types";
import { STEP_TYPES } from "./constants";
import { validateNodeConfig } from "./nodeTypes";

interface ConfigPanelProps {
  node: WorkflowNode | null;
  onClose: () => void;
  onUpdate: (nodeId: string, config: StepConfig) => void;
  onDelete: (nodeId: string) => void;
}

export function ConfigPanel({
  node,
  onClose,
  onUpdate,
  onDelete,
}: ConfigPanelProps) {
  const [config, setConfig] = useState<StepConfig>(node?.data.config || {});

  if (!node) return null;

  const stepInfo = STEP_TYPES[node.data.type as keyof typeof STEP_TYPES];
  const isValid = validateNodeConfig(node.data.type, config);

  const handleChange = (key: string, value: unknown) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    onUpdate(node.id, newConfig);
  };

  const handleDelete = () => {
    if (confirm("Delete this step?")) {
      onDelete(node.id);
      onClose();
    }
  };

  return (
    <div className="w-96 bg-white border-l border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Configure Step
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div
          className="px-3 py-2 rounded text-sm font-medium text-white inline-block"
          style={{ backgroundColor: stepInfo.color }}
        >
          {stepInfo.label}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isValid && (
          <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="text-sm text-orange-800">
              Please complete all required fields to validate this step.
            </div>
          </div>
        )}

        {node.data.type === "navigate" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              URL <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={(config.url as string) || ""}
              onChange={(e) => handleChange("url", e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {(node.data.type === "click" || node.data.type === "hover") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selector <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={(config.selector as string) || ""}
              onChange={(e) => handleChange("selector", e.target.value)}
              placeholder=".button, #submit, [data-test='btn']"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-gray-500">
              CSS selector or XPath. Right-click → Inspect in browser to find.
            </p>
          </div>
        )}

        {node.data.type === "fill" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.selector as string) || ""}
                onChange={(e) => handleChange("selector", e.target.value)}
                placeholder="input[name='email']"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Value <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.value as string) || ""}
                onChange={(e) => handleChange("value", e.target.value)}
                placeholder="Text to fill"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "extract" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.selector as string) || ""}
                onChange={(e) => handleChange("selector", e.target.value)}
                placeholder=".price, h1, [data-id]"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Field Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.fieldName as string) || ""}
                onChange={(e) => handleChange("fieldName", e.target.value)}
                placeholder="productPrice"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Attribute (optional)
              </label>
              <input
                type="text"
                value={(config.attribute as string) || ""}
                onChange={(e) => handleChange("attribute", e.target.value)}
                placeholder="href, src, data-id"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty to extract text content
              </p>
            </div>
          </>
        )}

        {node.data.type === "wait" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Duration (ms)
            </label>
            <input
              type="number"
              value={(config.duration as number) || 1000}
              onChange={(e) =>
                handleChange("duration", parseInt(e.target.value))
              }
              min="0"
              step="100"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-gray-500">
              Or specify selector below to wait for element
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-2 mt-3">
              Selector (optional)
            </label>
            <input
              type="text"
              value={(config.selector as string) || ""}
              onChange={(e) => handleChange("selector", e.target.value)}
              placeholder=".loaded, #content"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {node.data.type === "screenshot" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selector (optional)
            </label>
            <input
              type="text"
              value={(config.selector as string) || ""}
              onChange={(e) => handleChange("selector", e.target.value)}
              placeholder="Leave empty for full page"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {node.data.type === "scroll" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selector
              </label>
              <input
                type="text"
                value={(config.selector as string) || ""}
                onChange={(e) => handleChange("selector", e.target.value)}
                placeholder=".element-to-scroll-to"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Or use X/Y coordinates below
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  X Position
                </label>
                <input
                  type="number"
                  value={(config.x as number) || 0}
                  onChange={(e) => handleChange("x", parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Y Position
                </label>
                <input
                  type="number"
                  value={(config.y as number) || 0}
                  onChange={(e) => handleChange("y", parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </>
        )}

        {node.data.type === "press_key" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={(config.key as string) || ""}
              onChange={(e) => handleChange("key", e.target.value)}
              placeholder="Enter, Escape, Tab, ArrowDown"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {node.data.type === "execute_js" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              JavaScript Code <span className="text-red-500">*</span>
            </label>
            <textarea
              value={(config.script as string) || ""}
              onChange={(e) => handleChange("script", e.target.value)}
              placeholder="return document.title;"
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Use{" "}
              <code className="px-1 py-0.5 bg-gray-100 rounded">return</code> to
              get a value
            </p>
          </div>
        )}

        {node.data.type === "conditional" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Condition <span className="text-red-500">*</span>
            </label>
            <textarea
              value={(config.condition as string) || ""}
              onChange={(e) => handleChange("condition", e.target.value)}
              placeholder="JavaScript condition expression"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
          </div>
        )}

        {node.data.type === "loop" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selector <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={(config.selector as string) || ""}
              onChange={(e) => handleChange("selector", e.target.value)}
              placeholder=".item, li, tr"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-gray-500">
              Loop will iterate over all matching elements
            </p>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={handleDelete}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete Step
        </button>
        <p className="text-xs text-gray-500 text-center mt-2">
          Tip: Click on connection line to delete it
        </p>
      </div>
    </div>
  );
}
