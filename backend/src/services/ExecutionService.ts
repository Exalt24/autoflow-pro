import { supabase } from "../config/supabase.js";
import { cacheService } from "../config/cache.js";
import type { Database } from "../types/database.js";

type ExecutionRow = Database["public"]["Tables"]["executions"]["Row"];
type ExecutionInsert = Database["public"]["Tables"]["executions"]["Insert"];
type ExecutionUpdate = Database["public"]["Tables"]["executions"]["Update"];
type LogEntry = Database["public"]["Tables"]["execution_logs"]["Insert"];

interface CreateExecutionInput {
  workflowId: string;
  userId: string;
  status?: "queued" | "running" | "completed" | "failed";
}

interface UpdateExecutionInput {
  status?: "queued" | "running" | "completed" | "failed";
  completedAt?: string;
  duration?: number;
  extractedData?: Record<string, unknown>;
  errorMessage?: string;
}

interface ListExecutionsOptions {
  userId: string;
  workflowId?: string;
  status?: "queued" | "running" | "completed" | "failed";
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

class ExecutionService {
  async createExecution(input: CreateExecutionInput): Promise<ExecutionRow> {
    const executionData: ExecutionInsert = {
      workflow_id: input.workflowId,
      user_id: input.userId,
      status: input.status || "queued",
      started_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("executions")
      .insert(executionData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create execution: ${error.message}`);
    }

    await this.incrementUserExecutionCount(input.userId);
    await this.invalidateAnalyticsCache(input.userId);
    console.log(
      `✓ Created execution ${data.id} for workflow ${input.workflowId}`
    );

    return data;
  }

  async getExecutionById(
    executionId: string,
    userId: string
  ): Promise<ExecutionRow | null> {
    const { data, error } = await supabase
      .from("executions")
      .select("*")
      .eq("id", executionId)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new Error(`Failed to get execution: ${error.message}`);
    }

    return data;
  }

  async listExecutions(options: ListExecutionsOptions): Promise<{
    executions: ExecutionRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("executions")
      .select("id, workflow_id, user_id, status, started_at, completed_at, duration, error_message, archived", { count: "exact" })
      .eq("user_id", options.userId)
      .eq("archived", false);

    if (options.workflowId) {
      query = query.eq("workflow_id", options.workflowId);
    }

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.startDate) {
      query = query.gte("started_at", options.startDate);
    }

    if (options.endDate) {
      query = query.lte("started_at", options.endDate);
    }

    query = query
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list executions: ${error.message}`);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      executions: (data || []) as any,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async updateExecution(
    executionId: string,
    userId: string,
    input: UpdateExecutionInput
  ): Promise<ExecutionRow> {
    const updateData: ExecutionUpdate = {};

    if (input.status !== undefined) updateData.status = input.status;
    if (input.completedAt !== undefined)
      updateData.completed_at = input.completedAt;
    if (input.duration !== undefined) updateData.duration = input.duration;
    if (input.extractedData !== undefined)
      updateData.extracted_data = input.extractedData as any;
    if (input.errorMessage !== undefined)
      updateData.error_message = input.errorMessage;

    const { data, error } = await supabase
      .from("executions")
      .update(updateData)
      .eq("id", executionId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update execution: ${error.message}`);
    }

    await this.invalidateAnalyticsCache(userId);
    console.log(`✓ Updated execution ${executionId} status: ${input.status}`);
    return data;
  }

  async updateExecutionStatus(
    executionId: string,
    userId: string,
    status: "queued" | "running" | "completed" | "failed",
    errorMessage?: string
  ): Promise<ExecutionRow> {
    const input: UpdateExecutionInput = { status };

    if (status === "completed" || status === "failed") {
      const execution = await this.getExecutionById(executionId, userId);
      if (execution) {
        const completedAt = new Date().toISOString();
        const startedAt = new Date(execution.started_at);
        const duration = Math.floor(
          (new Date(completedAt).getTime() - startedAt.getTime()) / 1000
        );

        input.completedAt = completedAt;
        input.duration = duration;

        await this.invalidateAnalyticsCache(userId);      }
    }

    if (errorMessage) {
      input.errorMessage = errorMessage;
    }

    return await this.updateExecution(executionId, userId, input);
  }

  async addLog(
    executionId: string,
    userId: string,
    level: "info" | "warn" | "error",
    message: string,
    stepId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const execution = await this.getExecutionById(executionId, userId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    const logData: LogEntry = {
      execution_id: executionId,
      level,
      message,
      step_id: stepId || null,
      metadata: (metadata as any) || {},
      timestamp: new Date().toISOString(),
    };

    const { error } = await supabase.from("execution_logs").insert(logData);

    if (error) {
      console.error(`Failed to add log: ${error.message}`);
    }
  }

  async getLogs(
    executionId: string,
    userId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{
    logs: Array<{
      id: string;
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
      step_id: string | null;
      metadata: Record<string, unknown>;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const execution = await this.getExecutionById(executionId, userId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    const page = options?.page || 1;
    const limit = options?.limit || 100;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("execution_logs")
      .select("*", { count: "exact" })
      .eq("execution_id", executionId)
      .order("timestamp", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to get logs: ${error.message}`);
    }

    return {
      logs: data || [],
      total: count || 0,
      page,
      limit,
    };
  }

  async deleteExecution(executionId: string, userId: string): Promise<void> {
    await supabase
      .from("execution_logs")
      .delete()
      .eq("execution_id", executionId);

    const { error } = await supabase
      .from("executions")
      .delete()
      .eq("id", executionId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to delete execution: ${error.message}`);
    }

    await this.invalidateAnalyticsCache(userId);    console.log(`✓ Deleted execution ${executionId}`);
  }

  async markAsArchived(
    executionId: string,
    userId: string,
    r2Key: string
  ): Promise<void> {
    const { error } = await supabase
      .from("executions")
      .update({ archived: true, r2_key: r2Key })
      .eq("id", executionId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to mark execution as archived: ${error.message}`);
    }

    await this.invalidateAnalyticsCache(userId);
    console.log(`✓ Marked execution ${executionId} as archived`);
  }

  async getOldExecutions(daysOld: number): Promise<ExecutionRow[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data, error } = await supabase
      .from("executions")
      .select("*")
      .eq("archived", false)
      .lt("started_at", cutoffDate.toISOString())
      .limit(50);

    if (error) {
      throw new Error(`Failed to get old executions: ${error.message}`);
    }

    return data || [];
  }

  private async incrementUserExecutionCount(userId: string): Promise<void> {
    const { data: quota } = await supabase
      .from("usage_quotas")
      .select("executions_count")
      .eq("user_id", userId)
      .single();

    const newCount = (quota?.executions_count || 0) + 1;

    const { error } = await supabase
      .from("usage_quotas")
      .upsert({
        user_id: userId,
        executions_count: newCount,
        retention_days: 30,
      })
      .select()
      .single();

    if (error && error.code !== "23505") {
      console.error(`Failed to update execution count: ${error.message}`);
    }
  }

  private async invalidateAnalyticsCache(userId: string): Promise<void> {
    await Promise.all([
      cacheService.del(`stats:${userId}`),
      cacheService.del(`trends:${userId}`),
      cacheService.del(`top-workflows:${userId}`),
      cacheService.del(`errors:${userId}`),
      cacheService.del(`quota:${userId}`),
      cacheService.del(`resources:${userId}`),
    ]);
  }
}

export const executionService = new ExecutionService();
