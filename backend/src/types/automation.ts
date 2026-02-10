import type { WorkflowDefinition, WorkflowStep } from "./database.js";

export interface ExecutionContext {
  executionId: string;
  workflowId: string;
  userId: string;
  definition: WorkflowDefinition;
  variables: Record<string, unknown>;
  extractedData: Record<string, unknown>;
  loopContext?: LoopContext;
}

export interface LoopContext {
  stepId: string;
  totalIterations: number;
  currentIteration: number;
  currentElement?: unknown;
  shouldBreak: boolean;
}

export interface StepResult {
  success: boolean;
  data?: unknown;
  error?: string;
  screenshot?: Buffer;
}

export interface BrowserResources {
  browser: import("playwright-core").Browser | null;
  context: import("playwright-core").BrowserContext | null;
  page: import("playwright-core").Page | null;
}

export interface EngineConfig {
  headless: boolean;
  timeout: number;
  maxConcurrent: number;
  screenshotOnError: boolean;
}

export interface ExecutionProgress {
  currentStep: number;
  totalSteps: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}

export interface ExecutionCallbacks {
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
  onLog?: (log: {
    level: "info" | "warn" | "error";
    message: string;
    stepId?: string;
  }) => void | Promise<void>;
  onStepComplete?: (stepId: string, result: StepResult) => void | Promise<void>;
  onComplete?: (extractedData: Record<string, unknown>) => void | Promise<void>;
  onError?: (error: Error, stepId?: string) => void | Promise<void>;
}
