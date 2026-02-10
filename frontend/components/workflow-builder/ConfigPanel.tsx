"use client";

import { useState, useEffect, useRef } from "react";
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

  const prevNodeId = useRef(node?.id);
  useEffect(() => {
    if (node?.id !== prevNodeId.current) {
      setConfig(node?.data.config || {});
      prevNodeId.current = node?.id;
    }
  }, [node?.id, node?.data.config]);

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
              value={(config.code as string) || ""}
              onChange={(e) => handleChange("code", e.target.value)}
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

        {node.data.type === "set_variable" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Variable Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.variableName as string) || ""}
                onChange={(e) => handleChange("variableName", e.target.value)}
                placeholder="myVariable"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Alphanumeric characters and underscores only
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Value <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.variableValue as string) || ""}
                onChange={(e) => handleChange("variableValue", e.target.value)}
                placeholder="Hello or ${'{otherVariable}'}"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Can use ${"{variableName}"} to reference other variables
              </p>
            </div>
          </>
        )}

        {node.data.type === "extract_to_variable" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.selector as string) || ""}
                onChange={(e) => handleChange("selector", e.target.value)}
                placeholder=".product-name, h1"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Variable Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.variableName as string) || ""}
                onChange={(e) => handleChange("variableName", e.target.value)}
                placeholder="productName"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Variable will store the extracted value
              </p>
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

        {node.data.type === "download_file" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trigger Method <span className="text-red-500">*</span>
              </label>
              <select
                value={(config.triggerMethod as string) || "click"}
                onChange={(e) => handleChange("triggerMethod", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="click">Click Element</option>
                <option value="url">Navigate to URL</option>
              </select>
            </div>

            {config.triggerMethod === "click" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selector <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.selector as string) || ""}
                  onChange={(e) => handleChange("selector", e.target.value)}
                  placeholder="a[download], button.download"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Element that triggers the download
                </p>
              </div>
            )}

            {config.triggerMethod === "url" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Download URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.url as string) || ""}
                  onChange={(e) => handleChange("url", e.target.value)}
                  placeholder="https://example.com/file.pdf"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={(config.waitForDownload as boolean) !== false}
                  onChange={(e) =>
                    handleChange("waitForDownload", e.target.checked)
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm">
                  Wait for download and upload to storage
                </span>
              </label>
              <p className="mt-1 text-xs text-gray-500 ml-6">
                If unchecked, only triggers download without waiting
              </p>
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 <strong>Note:</strong> Downloaded files are stored in
                Supabase Storage under workflow-attachments bucket. Max file
                size: 10MB.
              </p>
            </div>
          </>
        )}

        {node.data.type === "drag_drop" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Source Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.sourceSelector as string) || ""}
                onChange={(e) => handleChange("sourceSelector", e.target.value)}
                placeholder=".draggable-item"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.targetSelector as string) || ""}
                onChange={(e) => handleChange("targetSelector", e.target.value)}
                placeholder=".drop-zone"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "set_cookie" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cookie Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.name as string) || ""}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="session_id"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cookie Value <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.value as string) || ""}
                onChange={(e) => handleChange("value", e.target.value)}
                placeholder="abc123"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Domain (optional)
              </label>
              <input
                type="text"
                value={(config.domain as string) || ""}
                onChange={(e) => handleChange("domain", e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "get_cookie" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cookie Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.name as string) || ""}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="session_id"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store in Variable (optional)
              </label>
              <input
                type="text"
                value={(config.variableName as string) || ""}
                onChange={(e) => handleChange("variableName", e.target.value)}
                placeholder="cookieValue"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "set_localstorage" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Key <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.key as string) || ""}
                onChange={(e) => handleChange("key", e.target.value)}
                placeholder="user_preferences"
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
                placeholder='{"theme": "dark"}'
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "get_localstorage" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Key <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.key as string) || ""}
                onChange={(e) => handleChange("key", e.target.value)}
                placeholder="user_preferences"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store in Variable (optional)
              </label>
              <input
                type="text"
                value={(config.variableName as string) || ""}
                onChange={(e) => handleChange("variableName", e.target.value)}
                placeholder="preferences"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </>
        )}

        {node.data.type === "select_dropdown" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selector <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={(config.selector as string) || ""}
                onChange={(e) => handleChange("selector", e.target.value)}
                placeholder="select#country"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select By
              </label>
              <select
                value={(config.selectBy as string) || "value"}
                onChange={(e) => handleChange("selectBy", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="value">Value</option>
                <option value="label">Label (Text)</option>
                <option value="index">Index</option>
              </select>
            </div>
            {(config.selectBy === "value" || !config.selectBy) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Value <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.value as string) || ""}
                  onChange={(e) => handleChange("value", e.target.value)}
                  placeholder="us"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
            {config.selectBy === "label" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Label <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.label as string) || ""}
                  onChange={(e) => handleChange("label", e.target.value)}
                  placeholder="United States"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
            {config.selectBy === "index" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Index <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={(config.index as number) || 0}
                  onChange={(e) =>
                    handleChange("index", parseInt(e.target.value))
                  }
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
          </>
        )}

        {(node.data.type === "right_click" ||
          node.data.type === "double_click") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selector <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={(config.selector as string) || ""}
              onChange={(e) => handleChange("selector", e.target.value)}
              placeholder=".context-menu-target"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {node.data.type === "conditional" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Condition Type <span className="text-red-500">*</span>
              </label>
              <select
                value={(config.conditionType as string) || "element_exists"}
                onChange={(e) => handleChange("conditionType", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="element_exists">Element Exists</option>
                <option value="element_visible">Element Visible</option>
                <option value="text_contains">Text Contains</option>
                <option value="value_equals">Value Comparison</option>
                <option value="custom_js">Custom JavaScript</option>
              </select>
            </div>

            {(config.conditionType === "element_exists" ||
              config.conditionType === "element_visible" ||
              config.conditionType === "text_contains") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selector <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.selector as string) || ""}
                  onChange={(e) => handleChange("selector", e.target.value)}
                  placeholder=".element, #id, [data-test]"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            {config.conditionType === "text_contains" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Text to Find <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.text as string) || ""}
                  onChange={(e) => handleChange("text", e.target.value)}
                  placeholder="Search text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            {config.conditionType === "value_equals" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Variable Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={(config.variableName as string) || ""}
                    onChange={(e) =>
                      handleChange("variableName", e.target.value)
                    }
                    placeholder="variableName"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Operator
                  </label>
                  <select
                    value={(config.operator as string) || "equals"}
                    onChange={(e) => handleChange("operator", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="contains">Contains</option>
                    <option value="not_contains">Does Not Contain</option>
                    <option value="greater_than">Greater Than</option>
                    <option value="less_than">Less Than</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Value <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={(config.value as string) || ""}
                    onChange={(e) => handleChange("value", e.target.value)}
                    placeholder="Expected value"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </>
            )}

            {config.conditionType === "custom_js" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  JavaScript Condition <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={(config.customScript as string) || ""}
                  onChange={(e) => handleChange("customScript", e.target.value)}
                  placeholder="return variables.count > 10;"
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Must return true or false. Access variables via{" "}
                  <code className="px-1 py-0.5 bg-gray-100 rounded">
                    variables.name
                  </code>
                </p>
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 <strong>Note:</strong> Condition result will be stored in
                extracted data. Use this with subsequent steps or loops.
              </p>
            </div>
          </>
        )}

        {node.data.type === "loop" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Loop Type <span className="text-red-500">*</span>
              </label>
              <select
                value={(config.loopType as string) || "elements"}
                onChange={(e) => handleChange("loopType", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="elements">Loop Over Elements</option>
                <option value="count">Loop N Times</option>
              </select>
            </div>

            {config.loopType === "elements" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selector <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={(config.selector as string) || ""}
                  onChange={(e) => handleChange("selector", e.target.value)}
                  placeholder=".item, li, tr, .product"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Loop will iterate over all matching elements
                </p>
              </div>
            )}

            {config.loopType === "count" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Count <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={(config.count as number) || 1}
                  onChange={(e) =>
                    handleChange("count", parseInt(e.target.value))
                  }
                  min="1"
                  placeholder="5"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Number of times to repeat
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Iterations (Safety Limit)
              </label>
              <input
                type="number"
                value={(config.maxIterations as number) || 100}
                onChange={(e) =>
                  handleChange("maxIterations", parseInt(e.target.value))
                }
                min="1"
                max="1000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-500">
                Prevents infinite loops (default: 100)
              </p>
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <p className="text-sm text-blue-800 font-medium">
                💡 Loop Variables Available:
              </p>
              <ul className="text-xs text-blue-700 space-y-1 ml-4">
                <li>
                  <code className="px-1 py-0.5 bg-blue-100 rounded">
                    ${"loopIndex"}
                  </code>{" "}
                  - Current index (0-based)
                </li>
                <li>
                  <code className="px-1 py-0.5 bg-blue-100 rounded">
                    ${"loopIteration"}
                  </code>{" "}
                  - Current iteration (1-based)
                </li>
                <li>
                  <code className="px-1 py-0.5 bg-blue-100 rounded">
                    ${"loopTotal"}
                  </code>{" "}
                  - Total iterations
                </li>
                {config.loopType === "elements" && (
                  <>
                    <li>
                      <code className="px-1 py-0.5 bg-blue-100 rounded">
                        ${"loopElementText"}
                      </code>{" "}
                      - Current element text
                    </li>
                    <li>
                      <code className="px-1 py-0.5 bg-blue-100 rounded">
                        ${"loopElementHTML"}
                      </code>{" "}
                      - Current element HTML
                    </li>
                  </>
                )}
              </ul>
            </div>
          </>
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
