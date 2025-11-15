import type { Node, Edge } from "@xyflow/react";
import type { WorkflowNode } from "./nodeTypes";

export interface ValidationError {
  nodeId: string;
  message: string;
  severity: "error" | "warning";
}

export const validateWorkflow = (
  nodes: WorkflowNode[],
  edges: Edge[]
): ValidationError[] => {
  const errors: ValidationError[] = [];

  if (nodes.length === 0) {
    errors.push({
      nodeId: "workflow",
      message: "Workflow has no steps",
      severity: "error",
    });
    return errors;
  }

  nodes.forEach((node) => {
    if (!node.data.isValid) {
      errors.push({
        nodeId: node.id,
        message: `Step "${node.data.label}" has incomplete configuration`,
        severity: "error",
      });
    }
  });

  const connectedNodes = new Set<string>();

  edges.forEach((edge) => {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  });

  nodes.forEach((node) => {
    if (nodes.length > 1 && !connectedNodes.has(node.id)) {
      errors.push({
        nodeId: node.id,
        message: `Step "${node.data.label}" is not connected to workflow`,
        severity: "warning",
      });
    }
  });

  const targetNodes = new Set(edges.map((e) => e.target));
  const startNodes = nodes.filter((n) => !targetNodes.has(n.id));

  if (startNodes.length === 0 && nodes.length > 1) {
    errors.push({
      nodeId: "workflow",
      message: "Workflow has no start node (circular dependency detected)",
      severity: "error",
    });
  }

  if (startNodes.length > 1) {
    errors.push({
      nodeId: "workflow",
      message: "Workflow has multiple start nodes (disconnected branches)",
      severity: "warning",
    });
  }

  return errors;
};

export const autoLayoutNodes = (nodes: Node[]): Node[] => {
  if (nodes.length === 0) return nodes;

  const positioned: Node[] = [];
  const VERTICAL_SPACING = 120;

  let currentY = 100;
  nodes.forEach((node) => {
    positioned.push({
      ...node,
      position: { x: 250, y: currentY },
    });
    currentY += VERTICAL_SPACING;
  });

  return positioned;
};
