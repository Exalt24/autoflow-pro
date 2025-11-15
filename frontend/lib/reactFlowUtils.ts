import type { Edge } from "@xyflow/react";
import type { WorkflowDefinition, WorkflowStep } from "@/types";
import type { WorkflowNode } from "@/components/workflow-builder/nodeTypes";
import { validateNodeConfig } from "@/components/workflow-builder/nodeTypes";
import { STEP_TYPES } from "@/components/workflow-builder/constants";

export const workflowToReactFlow = (
  definition: WorkflowDefinition
): { nodes: WorkflowNode[]; edges: Edge[] } => {
  if (!definition.steps || definition.steps.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: WorkflowNode[] = definition.steps.map((step, index) => {
    const stepInfo = STEP_TYPES[step.type as keyof typeof STEP_TYPES];
    const label = step.config.url
      ? `${stepInfo.label}: ${step.config.url}`
      : step.config.selector
      ? `${stepInfo.label}: ${step.config.selector}`
      : step.config.fieldName
      ? `Extract: ${step.config.fieldName}`
      : stepInfo.label;

    return {
      id: step.id,
      type: "custom",
      position: step.position || { x: 100, y: index * 120 + 100 },
      data: {
        type: step.type,
        config: step.config,
        label,
        isValid: validateNodeConfig(step.type, step.config),
      },
    };
  });

  const edges: Edge[] = [];
  for (let i = 0; i < definition.steps.length - 1; i++) {
    edges.push({
      id: `${definition.steps[i].id}-${definition.steps[i + 1].id}`,
      source: definition.steps[i].id,
      target: definition.steps[i + 1].id,
      type: "smoothstep",
    });
  }

  return { nodes, edges };
};

export const reactFlowToWorkflow = (
  nodes: WorkflowNode[],
  edges: Edge[]
): WorkflowDefinition => {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const orderedSteps: WorkflowStep[] = [];

  const findStartNode = (): WorkflowNode | undefined => {
    const targetIds = new Set(edges.map((e) => e.target));
    return nodes.find((n) => !targetIds.has(n.id));
  };

  let currentNode = findStartNode();
  const visited = new Set<string>();

  while (currentNode && !visited.has(currentNode.id)) {
    visited.add(currentNode.id);
    orderedSteps.push({
      id: currentNode.id,
      type: currentNode.data.type,
      config: currentNode.data.config,
      position: currentNode.position,
    });

    const nextEdge = edges.find((e) => e.source === currentNode!.id);
    currentNode = nextEdge ? nodeMap.get(nextEdge.target) : undefined;
  }

  return { steps: orderedSteps };
};

export const generateNodeId = (): string => {
  return `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const getNodeLabel = (
  type: string,
  config: Record<string, unknown>
): string => {
  const stepInfo = STEP_TYPES[type as keyof typeof STEP_TYPES];
  if (!stepInfo) return type;

  if (config.url)
    return `${stepInfo.label}: ${String(config.url).substring(0, 30)}${
      String(config.url).length > 30 ? "..." : ""
    }`;
  if (config.selector)
    return `${stepInfo.label}: ${String(config.selector).substring(0, 30)}${
      String(config.selector).length > 30 ? "..." : ""
    }`;
  if (config.fieldName) return `Extract: ${String(config.fieldName)}`;
  if (config.key) return `Press: ${String(config.key)}`;
  return stepInfo.label;
};
