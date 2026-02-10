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
    return {
      id: step.id,
      type: "custom",
      position: step.position || { x: 100, y: index * 120 + 100 },
      data: {
        type: step.type,
        config: step.config,
        label: getNodeLabel(step.type, step.config as Record<string, unknown>),
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
      type: "default",
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

  // Include any disconnected nodes so they aren't lost on save
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      orderedSteps.push({
        id: node.id,
        type: node.data.type,
        config: node.data.config,
        position: node.position,
      });
    }
  }

  return { steps: orderedSteps };
};

export const generateNodeId = (): string => {
  return `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const truncate = (str: string, max = 30): string =>
  str.length > max ? `${str.substring(0, max)}...` : str;

export const getNodeLabel = (
  type: string,
  config: Record<string, unknown>
): string => {
  const stepInfo = STEP_TYPES[type as keyof typeof STEP_TYPES];
  if (!stepInfo) return type;

  switch (type) {
    case "navigate":
      return config.url ? `Navigate: ${truncate(String(config.url))}` : stepInfo.label;
    case "click":
    case "scroll":
    case "hover":
    case "right_click":
    case "double_click":
      return config.selector ? `${stepInfo.label}: ${truncate(String(config.selector))}` : stepInfo.label;
    case "fill":
      if (config.selector && config.value)
        return `Fill: ${truncate(String(config.selector), 20)} = "${truncate(String(config.value), 15)}"`;
      return config.selector ? `Fill: ${truncate(String(config.selector))}` : stepInfo.label;
    case "extract":
      return config.fieldName ? `Extract: ${String(config.fieldName)}` : stepInfo.label;
    case "wait":
      if (config.selector) return `Wait: ${truncate(String(config.selector))}`;
      return config.duration ? `Wait: ${config.duration}ms` : stepInfo.label;
    case "screenshot":
      return config.fullPage ? "Screenshot (Full Page)" : stepInfo.label;
    case "press_key":
      return config.key ? `Press: ${String(config.key)}` : stepInfo.label;
    case "execute_js":
      return "Execute JavaScript";
    case "conditional":
      return config.conditionType ? `If: ${String(config.conditionType).replace(/_/g, " ")}` : stepInfo.label;
    case "loop":
      if (config.loopType === "count") return `Loop: ${config.count || "?"} times`;
      return config.selector ? `Loop: ${truncate(String(config.selector))}` : stepInfo.label;
    case "set_variable":
      return config.variableName ? `Set: ${String(config.variableName)}` : stepInfo.label;
    case "extract_to_variable":
      return config.variableName ? `Extract → ${String(config.variableName)}` : stepInfo.label;
    case "download_file":
      return config.triggerMethod === "url" ? "Download (URL)" : "Download (Click)";
    case "drag_drop":
      return config.sourceSelector ? `Drag: ${truncate(String(config.sourceSelector), 20)}` : stepInfo.label;
    case "set_cookie":
    case "get_cookie":
      return config.name ? `${stepInfo.label}: ${String(config.name)}` : stepInfo.label;
    case "set_localstorage":
    case "get_localstorage":
      return config.key ? `${stepInfo.label}: ${String(config.key)}` : stepInfo.label;
    case "select_dropdown":
      return config.selector ? `Select: ${truncate(String(config.selector))}` : stepInfo.label;
    default:
      return stepInfo.label;
  }
};
