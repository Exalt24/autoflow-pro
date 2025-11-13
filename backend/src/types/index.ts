export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  status: "draft" | "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
}

export interface WorkflowStep {
  id: string;
  type: StepType;
  config: StepConfig;
  position?: { x: number; y: number };
}

export type StepType =
  | "navigate"
  | "click"
  | "fill"
  | "extract"
  | "wait"
  | "screenshot"
  | "scroll"
  | "hover"
  | "press_key"
  | "execute_js"
  | "conditional"
  | "loop";

export interface StepConfig {
  [key: string]: unknown;
  selector?: string;
  url?: string;
  value?: string;
  duration?: number;
}

export interface Execution {
  id: string;
  workflow_id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  duration?: number;
  logs?: LogEntry[];
  extracted_data?: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  step_id?: string;
}

export interface ScheduledJob {
  id: string;
  workflow_id: string;
  user_id: string;
  cron_schedule: string;
  next_run_at: string;
  last_run_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsageQuota {
  user_id: string;
  workflows_count: number;
  executions_count: number;
  executions_limit: number;
  storage_used: number;
}
