import type { Node } from "@xyflow/react";
import type { StepType, StepConfig } from "@/types";

export interface WorkflowNodeData extends Record<string, unknown> {
  type: StepType;
  config: StepConfig;
  label: string;
  isValid: boolean;
  isActive?: boolean;
  isCompleted?: boolean;
  hasError?: boolean;
}

export type WorkflowNode = Node<WorkflowNodeData>;

export const createDefaultConfig = (type: StepType): StepConfig => {
  switch (type) {
    case "navigate":
      return { url: "" };
    case "click":
      return { selector: "" };
    case "fill":
      return { selector: "", value: "" };
    case "extract":
      return { selector: "", fieldName: "" };
    case "wait":
      return { duration: 1000 };
    case "screenshot":
      return {};
    case "scroll":
      return { selector: "" };
    case "hover":
      return { selector: "" };
    case "press_key":
      return { key: "Enter" };
    case "execute_js":
      return { script: "" };
    case "conditional":
      return { condition: "" };
    case "loop":
      return { selector: "" };
    default:
      return {};
  }
};

export const validateNodeConfig = (
  type: StepType,
  config: StepConfig
): boolean => {
  switch (type) {
    case "navigate":
      return (
        !!config.url &&
        typeof config.url === "string" &&
        config.url.trim().length > 0
      );
    case "click":
    case "scroll":
    case "hover":
      return (
        !!config.selector &&
        typeof config.selector === "string" &&
        config.selector.trim().length > 0
      );
    case "fill":
      return !!config.selector && !!config.value;
    case "extract":
      return !!config.selector && !!config.fieldName;
    case "wait":
      return config.duration ? config.duration > 0 : !!config.selector;
    case "press_key":
      return !!config.key && typeof config.key === "string";
    case "execute_js":
      return (
        !!config.script &&
        typeof config.script === "string" &&
        config.script.trim().length > 0
      );
    case "conditional":
      return !!config.condition;
    case "loop":
      return !!config.selector;
    case "screenshot":
      return true;
    default:
      return false;
  }
};
