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
      return { code: "" };
    case "conditional":
      return { conditionType: "element_exists", selector: "" };
    case "loop":
      return { loopType: "elements", selector: "", maxIterations: 100 };
    case "set_variable":
      return { variableName: "", variableValue: "" };
    case "extract_to_variable":
      return { selector: "", variableName: "" };
    case "download_file":
      return { triggerMethod: "click", selector: "", waitForDownload: true };
    case "drag_drop":
      return { sourceSelector: "", targetSelector: "" };
    case "set_cookie":
      return { name: "", value: "", domain: "" };
    case "get_cookie":
      return { name: "", variableName: "" };
    case "set_localstorage":
      return { key: "", value: "" };
    case "get_localstorage":
      return { key: "", variableName: "" };
    case "select_dropdown":
      return { selector: "", selectBy: "value", value: "" };
    case "right_click":
      return { selector: "" };
    case "double_click":
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
        !!config.code &&
        typeof config.code === "string" &&
        config.code.trim().length > 0
      );
    case "conditional":
      const condType = config.conditionType as string;
      if (!condType) return false;

      if (condType === "element_exists" || condType === "element_visible") {
        return !!config.selector;
      }
      if (condType === "text_contains") {
        return !!config.selector && !!config.text;
      }
      if (condType === "value_equals") {
        return !!config.variableName && config.value !== undefined;
      }
      if (condType === "custom_js") {
        return !!config.customScript;
      }
      return false;
    case "loop":
      const loopType = (config.loopType as string) || "elements";
      if (loopType === "elements") {
        return !!config.selector && typeof config.selector === "string";
      }
      if (loopType === "count") {
        return (
          !!config.count && typeof config.count === "number" && config.count > 0
        );
      }
      return false;
    case "set_variable":
      return (
        !!config.variableName &&
        typeof config.variableName === "string" &&
        config.variableName.trim().length > 0 &&
        config.variableValue !== undefined
      );
    case "extract_to_variable":
      return (
        !!config.selector &&
        !!config.variableName &&
        typeof config.selector === "string" &&
        typeof config.variableName === "string"
      );
    case "download_file":
      const triggerMethod = (config.triggerMethod as string) || "click";
      if (triggerMethod === "click") {
        return !!config.selector && typeof config.selector === "string";
      }
      if (triggerMethod === "url") {
        return !!config.url && typeof config.url === "string";
      }
      return false;
    case "drag_drop":
      return !!config.sourceSelector && !!config.targetSelector;
    case "set_cookie":
      return !!config.name && !!config.value;
    case "get_cookie":
      return !!config.name;
    case "set_localstorage":
      return !!config.key && config.value !== undefined;
    case "get_localstorage":
      return !!config.key;
    case "select_dropdown":
      const selectBy = (config.selectBy as string) || "value";
      if (selectBy === "value") return !!config.selector && !!config.value;
      if (selectBy === "label") return !!config.selector && !!config.label;
      if (selectBy === "index")
        return !!config.selector && config.index !== undefined;
      return false;
    case "right_click":
    case "double_click":
      return !!config.selector;
    case "screenshot":
      return true;
    default:
      return false;
  }
};
