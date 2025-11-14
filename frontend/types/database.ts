export interface Database {
  public: {
    Tables: {
      workflows: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          definition: WorkflowDefinition;
          status: "draft" | "active" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          definition: WorkflowDefinition;
          status?: "draft" | "active" | "archived";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          definition?: WorkflowDefinition;
          status?: "draft" | "active" | "archived";
          created_at?: string;
          updated_at?: string;
        };
      };
      executions: {
        Row: {
          id: string;
          workflow_id: string;
          user_id: string;
          status: "queued" | "running" | "completed" | "failed";
          started_at: string;
          completed_at: string | null;
          duration: number | null;
          logs: LogEntry[] | null;
          extracted_data: Record<string, unknown> | null;
          error_message: string | null;
          archived: boolean;
          r2_key: string | null;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          user_id: string;
          status?: "queued" | "running" | "completed" | "failed";
          started_at?: string;
          completed_at?: string | null;
          duration?: number | null;
          logs?: LogEntry[] | null;
          extracted_data?: Record<string, unknown> | null;
          error_message?: string | null;
          archived?: boolean;
          r2_key?: string | null;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          user_id?: string;
          status?: "queued" | "running" | "completed" | "failed";
          started_at?: string;
          completed_at?: string | null;
          duration?: number | null;
          logs?: LogEntry[] | null;
          extracted_data?: Record<string, unknown> | null;
          error_message?: string | null;
          archived?: boolean;
          r2_key?: string | null;
        };
      };
      execution_logs: {
        Row: {
          id: string;
          execution_id: string;
          timestamp: string;
          level: "info" | "warn" | "error";
          message: string;
          step_id: string | null;
          metadata: Record<string, unknown> | null;
        };
        Insert: {
          id?: string;
          execution_id: string;
          timestamp?: string;
          level: "info" | "warn" | "error";
          message: string;
          step_id?: string | null;
          metadata?: Record<string, unknown> | null;
        };
        Update: {
          id?: string;
          execution_id?: string;
          timestamp?: string;
          level?: "info" | "warn" | "error";
          message?: string;
          step_id?: string | null;
          metadata?: Record<string, unknown> | null;
        };
      };
      scheduled_jobs: {
        Row: {
          id: string;
          workflow_id: string;
          user_id: string;
          cron_schedule: string;
          next_run_at: string;
          last_run_at: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          user_id: string;
          cron_schedule: string;
          next_run_at: string;
          last_run_at?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          user_id?: string;
          cron_schedule?: string;
          next_run_at?: string;
          last_run_at?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      usage_quotas: {
        Row: {
          user_id: string;
          workflows_count: number;
          executions_count: number;
          executions_limit: number;
          storage_used: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          workflows_count?: number;
          executions_count?: number;
          executions_limit?: number;
          storage_used?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          workflows_count?: number;
          executions_count?: number;
          executions_limit?: number;
          storage_used?: number;
          updated_at?: string;
        };
      };
    };
  };
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

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  step_id?: string;
}

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
