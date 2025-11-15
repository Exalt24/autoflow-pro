"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CustomNode } from "./CustomNode";
import { EdgeDeleteButton } from "./EdgeDeleteButton";
import type { WorkflowNode } from "./nodeTypes";
import { createDefaultConfig, validateNodeConfig } from "./nodeTypes";
import { GRID_SIZE } from "./constants";
import { generateNodeId, getNodeLabel } from "@/lib/reactFlowUtils";
import type { StepType, StepConfig } from "@/types";

interface FlowCanvasProps {
  initialNodes: WorkflowNode[];
  initialEdges: Edge[];
  onNodeClick?: (node: WorkflowNode) => void;
}

export interface FlowCanvasRef {
  fitView: () => void;
  autoLayout: () => void;
  clearAll: () => void;
  getState: () => { nodes: WorkflowNode[]; edges: Edge[] };
  updateNode: (nodeId: string, config: StepConfig) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
}

export const FlowCanvas = forwardRef<FlowCanvasRef, FlowCanvasProps>(
  ({ initialNodes, initialEdges, onNodeClick }, ref) => {
    const [nodes, setNodes, handleNodesChange] =
      useNodesState<Node>(initialNodes);
    const [edges, setEdges, handleEdgesChange] = useEdgesState(initialEdges);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition, fitView: rfFitView } = useReactFlow();

    const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
    const edgeTypes = useMemo(() => ({ default: EdgeDeleteButton }), []);

    const isValidConnection = useCallback(
      (connection: Connection) => {
        if (!connection.source || !connection.target) return false;
        if (connection.source === connection.target) return false;

        const existingEdge = edges.find(
          (e) =>
            e.source === connection.source && e.target === connection.target
        );
        if (existingEdge) return false;

        return true;
      },
      [edges]
    );

    const onConnect = useCallback(
      (connection: Connection) => {
        if (!isValidConnection(connection)) return;

        const newEdge = {
          ...connection,
          type: "default",
          animated: true,
        } as Edge;

        setEdges((eds) => {
          const filtered = eds.filter((e) => e.source !== connection.source);
          return addEdge(newEdge, filtered);
        });
      },
      [setEdges, isValidConnection]
    );

    const handleNodeClickInternal = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        onNodeClick?.(node as WorkflowNode);
      },
      [onNodeClick]
    );

    const onNodesChangeInternal = useCallback(
      (changes: unknown) => {
        handleNodesChange(changes as never);
      },
      [handleNodesChange]
    );

    const onEdgesChangeInternal = useCallback(
      (changes: unknown) => {
        handleEdgesChange(changes as never);
      },
      [handleEdgesChange]
    );

    const onDragOver = useCallback((event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault();

        const type = event.dataTransfer.getData(
          "application/reactflow"
        ) as StepType;
        if (!type) return;

        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        const config = createDefaultConfig(type);
        const newNode: WorkflowNode = {
          id: generateNodeId(),
          type: "custom",
          position,
          data: {
            type,
            config,
            label: getNodeLabel(type, config),
            isValid: validateNodeConfig(type, config),
          },
        };

        setNodes((nds) => [...nds, newNode]);
      },
      [screenToFlowPosition, setNodes]
    );

    const handleUpdateNode = useCallback(
      (nodeId: string, config: StepConfig) => {
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === nodeId) {
              const nodeData = node.data as WorkflowNode["data"];
              const updatedNode = {
                ...node,
                data: {
                  ...nodeData,
                  config,
                  label: getNodeLabel(nodeData.type, config),
                  isValid: validateNodeConfig(nodeData.type, config),
                },
              };
              return updatedNode;
            }
            return node;
          })
        );
      },
      [setNodes]
    );

    const handleDeleteNode = useCallback(
      (nodeId: string) => {
        setNodes((nds) => nds.filter((n) => n.id !== nodeId));
        setEdges((eds) =>
          eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
        );
      },
      [setNodes, setEdges]
    );

    const handleDeleteEdge = useCallback(
      (edgeId: string) => {
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      },
      [setEdges]
    );

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        fitView: () => {
          rfFitView({ padding: 0.2, duration: 300 });
        },
        autoLayout: () => {
          const layouted = nodes.map((node, index) => ({
            ...node,
            position: { x: 250, y: index * 120 + 100 },
          }));
          setNodes(layouted);
          setTimeout(() => rfFitView({ padding: 0.2, duration: 300 }), 50);
        },
        clearAll: () => {
          setNodes([]);
          setEdges([]);
        },
        getState: () => ({
          nodes: nodes as WorkflowNode[],
          edges,
        }),
        updateNode: handleUpdateNode,
        deleteNode: handleDeleteNode,
        deleteEdge: handleDeleteEdge,
      }),
      [
        nodes,
        edges,
        rfFitView,
        setNodes,
        setEdges,
        handleUpdateNode,
        handleDeleteNode,
        handleDeleteEdge,
      ]
    );

    const proOptions = { hideAttribution: true };

    return (
      <div ref={reactFlowWrapper} className="w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeInternal}
          onEdgesChange={onEdgesChangeInternal}
          onConnect={onConnect}
          onNodeClick={handleNodeClickInternal}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={proOptions}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
        >
          <Background color="#e5e7eb" gap={GRID_SIZE} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as Record<string, unknown>;
              return data?.isValid ? "#6A9BA6" : "#103B40";
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        </ReactFlow>
      </div>
    );
  }
);

FlowCanvas.displayName = "FlowCanvas";
