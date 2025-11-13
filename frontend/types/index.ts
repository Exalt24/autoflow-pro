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
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
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
}
