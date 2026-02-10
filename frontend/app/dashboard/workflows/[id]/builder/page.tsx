"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Toast } from "@/components/ui/Toast";
import { useParams, useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrowLeft, Save } from "lucide-react";
import {
  FlowCanvas,
  type FlowCanvasRef,
} from "@/components/workflow-builder/FlowCanvas";
import { NodePalette } from "@/components/workflow-builder/NodePalette";
import { ConfigPanel } from "@/components/workflow-builder/ConfigPanel";
import { WorkflowToolbar } from "@/components/workflow-builder/WorkflowToolbar";
import { ValidationPanel } from "@/components/workflow-builder/ValidationPanel";
import { KeyboardShortcuts } from "@/components/workflow-builder/KeyboardShortcuts";
import { validateWorkflow } from "@/components/workflow-builder/utils";
import { workflowToReactFlow, reactFlowToWorkflow } from "@/lib/reactFlowUtils";
import { workflowsApi } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Workflow, StepType } from "@/types";
import type { WorkflowNode } from "@/components/workflow-builder/nodeTypes";
import type { Edge } from "@xyflow/react";

function WorkflowBuilderContent() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.id as string;
  const flowCanvasRef = useRef<FlowCanvasRef>(null);

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    const fetchWorkflow = async () => {
      try {
        const data = await workflowsApi.getById(workflowId);
        setWorkflow(data);
        const { nodes: flowNodes, edges: flowEdges } = workflowToReactFlow(
          data.definition
        );
        setNodes(flowNodes);
        setEdges(flowEdges);
      } catch (err) {
        console.error("Failed to load workflow:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflow();
  }, [workflowId]);

  const handleSave = async () => {
    if (!workflow || !flowCanvasRef.current) return;

    setSaving(true);
    try {
      const state = flowCanvasRef.current.getState();
      const definition = reactFlowToWorkflow(state.nodes, state.edges);
      await workflowsApi.update(workflowId, { definition });
      setToast({message: "Workflow saved successfully!", type: "success"});
    } catch (err) {
      console.error("Failed to save workflow:", err);
      setToast({message: err instanceof Error ? err.message : "Failed to save workflow", type: "error"});
    } finally {
      setSaving(false);
    }
  };

  const handleNodeClick = (node: WorkflowNode) => {
    setSelectedNodeId(node.id);
  };

  const handleDragStart = useCallback(
    (event: React.DragEvent, type: StepType) => {
      event.dataTransfer.setData("application/reactflow", type);
      event.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const state = flowCanvasRef.current?.getState() || { nodes, edges };
  const validationErrors = validateWorkflow(state.nodes, state.edges);
  const errorCount = validationErrors.filter(
    (e) => e.severity === "error"
  ).length;
  const warningCount = validationErrors.filter(
    (e) => e.severity === "warning"
  ).length;

  const handleValidationNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowValidation(false);
  };

  const handleClearAll = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAll = () => {
    setShowClearConfirm(false);
    flowCanvasRef.current?.clearAll();
  };

  const handleKeyboardSave = () => {
    if (!saving) {
      handleSave();
    }
  };

  const selectedNode = selectedNodeId
    ? state.nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading workflow...</div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-600">Workflow not found</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={showClearConfirm}
        onConfirm={confirmClearAll}
        onCancel={() => setShowClearConfirm(false)}
        title="Clear All Nodes"
        message="This will remove all steps from the canvas. This cannot be undone."
        confirmLabel="Clear All"
        variant="danger"
      />
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/workflows")}
            className="text-gray-600 hover:text-gray-900"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {workflow.name}
            </h1>
            <p className="text-sm text-gray-500">Visual Workflow Builder</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <NodePalette onDragStart={handleDragStart} />
        <div className="flex-1 relative">
          <KeyboardShortcuts
            selectedNodeId={selectedNodeId}
            onDeleteNode={() => {
              if (selectedNodeId)
                flowCanvasRef.current?.deleteNode(selectedNodeId);
            }}
            onDeselectNode={() => setSelectedNodeId(null)}
            onFitView={() => flowCanvasRef.current?.fitView()}
            onSave={handleKeyboardSave}
          />
          <WorkflowToolbar
            onFitView={() => flowCanvasRef.current?.fitView()}
            onAutoLayout={() => flowCanvasRef.current?.autoLayout()}
            onValidate={() => setShowValidation(true)}
            onClear={handleClearAll}
            hasNodes={state.nodes.length > 0}
            errorCount={errorCount}
            warningCount={warningCount}
          />
          {showValidation && (
            <ValidationPanel
              errors={validationErrors}
              onClose={() => setShowValidation(false)}
              onNodeClick={handleValidationNodeClick}
            />
          )}
          <FlowCanvas
            ref={flowCanvasRef}
            initialNodes={nodes}
            initialEdges={edges}
            onNodeClick={handleNodeClick}
          />
        </div>
        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onUpdate={(nodeId, config) => {
              flowCanvasRef.current?.updateNode(nodeId, config);
            }}
            onDelete={(nodeId) => {
              flowCanvasRef.current?.deleteNode(nodeId);
              setSelectedNodeId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent />
    </ReactFlowProvider>
  );
}
