const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = await response.json();

        // Handle different error response formats
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.error && typeof errorData.error === "string") {
          errorMessage = errorData.error;
        } else if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }

        // Special handling for rate limits
        if (response.status === 429) {
          errorMessage = `Rate limit exceeded. ${errorMessage}`;
        }
      } catch {
        // If JSON parsing fails, use default message
      }

      throw new Error(errorMessage);
    }

    // Handle empty responses (like DELETE)
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    // Catch network errors (backend not running)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(`Cannot connect to ${API_URL}. Is the backend running?`);
    }
    // Re-throw API errors as-is
    throw error;
  }
}

// Workflows
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

export interface PaginatedWorkflows {
  workflows: Workflow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const workflowsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.search) queryParams.set("search", params.search);
    if (params?.status) queryParams.set("status", params.status);

    return apiRequest<PaginatedWorkflows>(
      `/workflows?${queryParams.toString()}`
    );
  },

  getById: (id: string) => apiRequest<Workflow>(`/workflows/${id}`),

  create: (data: {
    name: string;
    description?: string;
    definition: WorkflowDefinition;
    status?: "draft" | "active" | "archived";
  }) =>
    apiRequest<Workflow>("/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Workflow>) =>
    apiRequest<Workflow>(`/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiRequest<void>(`/workflows/${id}`, { method: "DELETE" }),

  duplicate: (id: string) =>
    apiRequest<Workflow>(`/workflows/${id}/duplicate`, { method: "POST" }),

  execute: (id: string) =>
    apiRequest<{ jobId: string; executionId: string; message: string }>(
      `/workflows/${id}/execute`,
      { method: "POST" }
    ),
};

// Executions
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
  error_message?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  step_id?: string;
}

export interface PaginatedExecutions {
  executions: Execution[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const executionsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    workflowId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.workflowId) queryParams.set("workflowId", params.workflowId);
    if (params?.status) queryParams.set("status", params.status);
    if (params?.startDate) queryParams.set("startDate", params.startDate);
    if (params?.endDate) queryParams.set("endDate", params.endDate);

    return apiRequest<PaginatedExecutions>(
      `/executions?${queryParams.toString()}`
    );
  },

  getById: (id: string) => apiRequest<Execution>(`/executions/${id}`),

  getLogs: (id: string, params?: { page?: number; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());

    return apiRequest<{
      logs: LogEntry[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/executions/${id}/logs?${queryParams.toString()}`);
  },

  delete: (id: string) =>
    apiRequest<void>(`/executions/${id}`, { method: "DELETE" }),
};

// Analytics
export interface UserStats {
  totalWorkflows: number;
  totalExecutions: number;
  successRate: number;
  avgExecutionTime: number;
}

export interface ExecutionTrend {
  date: string;
  count: number;
  successCount: number;
  failureCount: number;
}

export interface TopWorkflow {
  workflowId: string;
  workflowName: string;
  executionCount: number;
}

export interface UsageQuota {
  workflowsCount: number;
  executionsCount: number;
  executionsLimit: number;
  storageUsed: number;
}

export interface ErrorAnalysis {
  errorMessage: string;
  count: number;
  lastOccurred: string;
  affectedWorkflows: number;
  affectedExecutions: string[];
}

export interface SlowestWorkflow {
  workflowId: string;
  workflowName: string;
  averageDuration: number;
  executionCount: number;
}

export const analyticsApi = {
  getStats: () => apiRequest<UserStats>("/analytics/stats"),

  getTrends: (days?: number) => {
    const queryParams = new URLSearchParams();
    if (days) queryParams.set("days", days.toString());
    return apiRequest<ExecutionTrend[]>(
      `/analytics/trends?${queryParams.toString()}`
    );
  },

  getTopWorkflows: (limit?: number) => {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set("limit", limit.toString());
    return apiRequest<TopWorkflow[]>(
      `/analytics/top-workflows?${queryParams.toString()}`
    );
  },

  getUsage: () => apiRequest<UsageQuota>("/analytics/usage"),

  getSlowestWorkflows: (limit?: number) => {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set("limit", limit.toString());
    return apiRequest<SlowestWorkflow[]>(
      `/analytics/slowest-workflows?${queryParams.toString()}`
    );
  },

  getFailedWorkflows: (limit?: number) => {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set("limit", limit.toString());
    return apiRequest<TopWorkflow[]>(
      `/analytics/failed-workflows?${queryParams.toString()}`
    );
  },

  getErrors: (limit?: number) => {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set("limit", limit.toString());
    return apiRequest<ErrorAnalysis[]>(
      `/analytics/errors?${queryParams.toString()}`
    );
  },
};

// User
export interface UserProfile {
  id: string;
  email: string;
  created_at: string;
}

export const userApi = {
  getProfile: () => apiRequest<UserProfile>("/user/profile"),
};

// Scheduled Jobs
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

export interface PaginatedScheduledJobs {
  scheduledJobs: ScheduledJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const scheduledJobsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    workflowId?: string;
    isActive?: boolean;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.workflowId) queryParams.set("workflowId", params.workflowId);
    if (params?.isActive !== undefined)
      queryParams.set("isActive", params.isActive.toString());

    return apiRequest<PaginatedScheduledJobs>(
      `/scheduled-jobs?${queryParams.toString()}`
    );
  },

  getById: (id: string) => apiRequest<ScheduledJob>(`/scheduled-jobs/${id}`),

  create: (data: {
    workflowId: string;
    cronSchedule: string;
    isActive?: boolean;
  }) =>
    apiRequest<ScheduledJob>("/scheduled-jobs", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { cronSchedule?: string; isActive?: boolean }) =>
    apiRequest<ScheduledJob>(`/scheduled-jobs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiRequest<void>(`/scheduled-jobs/${id}`, { method: "DELETE" }),

  getNextRuns: (id: string, count?: number) => {
    const queryParams = new URLSearchParams();
    if (count) queryParams.set("count", count.toString());
    return apiRequest<{ cronSchedule: string; nextRuns: string[] }>(
      `/scheduled-jobs/${id}/next-runs?${queryParams.toString()}`
    );
  },

  getHistory: (id: string, limit?: number) => {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set("limit", limit.toString());
    return apiRequest<{
      scheduledJobId: string;
      executions: Execution[];
      total: number;
    }>(`/scheduled-jobs/${id}/history?${queryParams.toString()}`);
  },

  getStats: (id: string) =>
    apiRequest<{
      consecutiveFailures: number;
      lastFailureAt: string | null;
      recentFailureRate: number;
      totalRecentExecutions: number;
      isPaused: boolean;
    }>(`/scheduled-jobs/${id}/stats`),
};
