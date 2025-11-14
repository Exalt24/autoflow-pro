import { WorkflowDefinition, WorkflowStep } from "./api";

export interface ValidationError {
  field: string;
  message: string;
}

export function validateWorkflowName(name: string): ValidationError | null {
  if (!name || name.trim().length === 0) {
    return { field: "name", message: "Workflow name is required" };
  }
  if (name.length > 100) {
    return {
      field: "name",
      message: "Workflow name must be under 100 characters",
    };
  }
  return null;
}

export function validateStepConfig(step: WorkflowStep): ValidationError | null {
  const { type, config } = step;

  switch (type) {
    case "navigate":
      if (!config.url) {
        return {
          field: `step-${step.id}`,
          message: "URL is required for navigate step",
        };
      }
      try {
        new URL(config.url as string);
      } catch {
        return { field: `step-${step.id}`, message: "Invalid URL format" };
      }
      break;

    case "click":
    case "fill":
    case "extract":
    case "scroll":
    case "hover":
      if (!config.selector) {
        return {
          field: `step-${step.id}`,
          message: `Selector is required for ${type} step`,
        };
      }
      break;

    case "fill":
      if (!config.value) {
        return {
          field: `step-${step.id}`,
          message: "Value is required for fill step",
        };
      }
      break;

    case "wait":
      if (!config.duration && !config.selector) {
        return {
          field: `step-${step.id}`,
          message: "Duration or selector is required for wait step",
        };
      }
      if (config.duration && (config.duration as number) < 0) {
        return {
          field: `step-${step.id}`,
          message: "Duration must be positive",
        };
      }
      break;

    case "press_key":
      if (!config.key) {
        return {
          field: `step-${step.id}`,
          message: "Key is required for press_key step",
        };
      }
      break;

    case "execute_js":
      if (!config.script) {
        return {
          field: `step-${step.id}`,
          message: "Script is required for execute_js step",
        };
      }
      break;
  }

  return null;
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!definition.steps || definition.steps.length === 0) {
    errors.push({
      field: "steps",
      message: "Workflow must have at least one step",
    });
    return errors;
  }

  definition.steps.forEach((step) => {
    const error = validateStepConfig(step);
    if (error) {
      errors.push(error);
    }
  });

  return errors;
}
