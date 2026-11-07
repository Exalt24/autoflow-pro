// Shared types for the Temporal orchestration of one automation run. The workflow bundle imports this file, so it holds
// only types and constants: no Node APIs, no I/O.

import type { RetryPolicy } from "@temporalio/common";

export interface RunStepInput {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface RunInput {
  runId: string;
  workflowId: string;
  userId: string;
  steps: RunStepInput[];
  /** Budget for one step including its retries. Defaults to DEFAULT_STEP_TIMEOUT_MS. */
  stepTimeoutMs?: number;
}

export type RunState = "pending" | "validating" | "running" | "archiving" | "completed" | "failed" | "cancelled" | "timed_out";
export type FinalRunState = "completed" | "failed" | "cancelled" | "timed_out";

export interface RunStatus {
  runId: string;
  state: RunState;
  currentStep: number;
  totalSteps: number;
  completedSteps: string[];
  error?: string;
}

export interface RunResult {
  runId: string;
  state: FinalRunState;
  completedSteps: string[];
  error?: string;
  /** Where the archive activity put the record. Absent when archiving itself failed. */
  archiveKey?: string;
  archiveError?: string;
}

export interface ArchiveRecord {
  runId: string;
  workflowId: string;
  userId: string;
  state: FinalRunState;
  completedSteps: string[];
  error?: string;
}

export interface StepRequest {
  runId: string;
  index: number;
  step: RunStepInput;
}

/** What the workflow calls. The worker registers an implementation; tests register mocks. */
export interface RunActivities {
  validateRun(input: RunInput): Promise<void>;
  startRun(input: RunInput): Promise<void>;
  executeStep(req: StepRequest): Promise<void>;
  archiveRun(record: ArchiveRecord): Promise<string>;
}

export const TASK_QUEUE = "autoflow-runs";
export const CANCEL_SIGNAL = "cancelRun";
export const STATUS_QUERY = "getStatus";
export const DEFAULT_STEP_TIMEOUT_MS = 60_000;
export const MAX_STEPS = 200;

/** Thrown (as a non retryable ApplicationFailure) by validateRun. Retrying the same bad input cannot help. */
export const VALIDATION_ERROR = "ValidationError";

export const RETRY_POLICY = {
  initialInterval: "1 second",
  backoffCoefficient: 2,
  maximumInterval: "30 seconds",
  maximumAttempts: 4,
  nonRetryableErrorTypes: [VALIDATION_ERROR],
} satisfies RetryPolicy;

export const runWorkflowId = (runId: string) => `run-${runId}`;
