import { supabase } from "../config/supabase.js";
import { cacheService } from "../config/cache.js";

interface UsageStats {
  totalWorkflows: number;
  totalExecutions: number;
  executionsThisMonth: number;
  successRate: number;
  averageDuration: number;
}

interface ExecutionTrend {
  date: string;
  total: number;
  successful: number;
  failed: number;
}

interface WorkflowUsage {
  workflowId: string;
  workflowName: string;
  executionCount: number;
  successRate: number;
  averageDuration: number;
}

interface UsageQuota {
  workflowsCount: number;
  workflowsLimit: number;
  executionsCount: number;
  executionsLimit: number;
  storageUsed: number;
  storageLimit: number;
}

interface ErrorAnalysis {
  errorMessage: string;
  count: number;
  lastOccurred: string;
  affectedWorkflows: number;
  affectedExecutions: string[];
}

interface ResourceUsage {
  render: {
    hoursUsed: number;
    hoursLimit: number;
    percentageUsed: number;
  };
  redis: {
    commandsUsed: number;
    commandsLimit: number;
    percentageUsed: number;
    commandsPerMinute: number;
  };
  supabase: {
    bandwidthUsed: number;
    bandwidthLimit: number;
    percentageUsed: number;
  };
  r2: {
    storageUsed: number;
    storageLimit: number;
    percentageUsed: number;
  };
}

class AnalyticsService {
  async getUserStats(userId: string): Promise<UsageStats> {
    const cacheKey = cacheService.getCacheKey("stats", userId);
    const cached = await cacheService.get<UsageStats>(cacheKey);
    if (cached) return cached;

    const [workflowsCount, executionsStats, monthlyExecutions] =
      await Promise.all([
        this.getWorkflowCount(userId),
        this.getExecutionStats(userId),
        this.getMonthlyExecutionCount(userId),
      ]);

    const result = {
      totalWorkflows: workflowsCount,
      totalExecutions: executionsStats.total,
      executionsThisMonth: monthlyExecutions,
      successRate: executionsStats.successRate,
      averageDuration: executionsStats.averageDuration,
    };

    await cacheService.set(cacheKey, result, { ttl: 300 });
    return result;
  }

  async getExecutionTrends(
    userId: string,
    days: number = 30
  ): Promise<ExecutionTrend[]> {
    const cacheKey = cacheService.getCacheKey(
      "trends",
      userId,
      days.toString()
    );
    const cached = await cacheService.get<ExecutionTrend[]>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase.rpc("get_execution_trends", {
      p_user_id: userId,
      p_days: days,
      p_start_date: startDate.toISOString(),
    });

    if (error) {
      console.warn(
        "RPC function not available, using fallback:",
        error.message
      );
      return this.getExecutionTrendsFallback(userId, days);
    }

    const trendMap = new Map<
      string,
      { total: number; successful: number; failed: number }
    >();

    (data || []).forEach((row: any) => {
      trendMap.set(row.date, {
        total: parseInt(row.total) || 0,
        successful: parseInt(row.successful) || 0,
        failed: parseInt(row.failed) || 0,
      });
    });

    const trends: ExecutionTrend[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const dateStr = date.toISOString().split("T")[0];
      const stats = trendMap.get(dateStr) || {
        total: 0,
        successful: 0,
        failed: 0,
      };

      trends.push({
        date: dateStr,
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
      });
    }

    await cacheService.set(cacheKey, trends, { ttl: 900 });
    return trends;
  }

  private async getExecutionTrendsFallback(
    userId: string,
    days: number
  ): Promise<ExecutionTrend[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from("executions")
      .select("started_at, status")
      .eq("user_id", userId)
      .gte("started_at", startDate.toISOString())
      .order("started_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to get execution trends: ${error.message}`);
    }

    const trendMap = new Map<
      string,
      { total: number; successful: number; failed: number }
    >();

    (data || []).forEach((execution) => {
      const date = new Date(execution.started_at).toISOString().split("T")[0];
      const current = trendMap.get(date) || {
        total: 0,
        successful: 0,
        failed: 0,
      };

      current.total++;
      if (execution.status === "completed") current.successful++;
      if (execution.status === "failed") current.failed++;

      trendMap.set(date, current);
    });

    const trends: ExecutionTrend[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const dateStr = date.toISOString().split("T")[0];
      const stats = trendMap.get(dateStr) || {
        total: 0,
        successful: 0,
        failed: 0,
      };

      trends.push({
        date: dateStr,
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
      });
    }

    return trends;
  }

  async getTopWorkflows(
    userId: string,
    limit: number = 10
  ): Promise<WorkflowUsage[]> {
    const cacheKey = cacheService.getCacheKey(
      "top-workflows",
      userId,
      limit.toString()
    );
    const cached = await cacheService.get<WorkflowUsage[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase.rpc("get_workflow_usage", {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error) {
      console.warn(
        "RPC function not available, using fallback:",
        error.message
      );
      return this.getTopWorkflowsFallback(userId, limit);
    }

    const result = (data || []).map((row: any) => ({
      workflowId: row.workflow_id,
      workflowName: row.workflow_name || "Unknown",
      executionCount: parseInt(row.execution_count) || 0,
      successRate: parseFloat(row.success_rate) || 0,
      averageDuration: parseFloat(row.average_duration) || 0,
    }));

    await cacheService.set(cacheKey, result, { ttl: 600 });
    return result;
  }

  private async getTopWorkflowsFallback(
    userId: string,
    limit: number
  ): Promise<WorkflowUsage[]> {
    const { data: executions, error: execError } = await supabase
      .from("executions")
      .select("workflow_id, status, duration")
      .eq("user_id", userId)
      .eq("archived", false);

    if (execError) {
      throw new Error(`Failed to get workflow usage: ${execError.message}`);
    }

    const { data: workflows, error: wfError } = await supabase
      .from("workflows")
      .select("id, name")
      .eq("user_id", userId);

    if (wfError) {
      throw new Error(`Failed to get workflows: ${wfError.message}`);
    }

    const workflowMap = new Map(workflows?.map((w) => [w.id, w.name]) || []);
    const usageMap = new Map<
      string,
      { count: number; successful: number; totalDuration: number }
    >();

    (executions || []).forEach((exec) => {
      const current = usageMap.get(exec.workflow_id) || {
        count: 0,
        successful: 0,
        totalDuration: 0,
      };

      current.count++;
      if (exec.status === "completed") current.successful++;
      if (exec.duration) current.totalDuration += exec.duration;

      usageMap.set(exec.workflow_id, current);
    });

    const usage: WorkflowUsage[] = Array.from(usageMap.entries())
      .map(([workflowId, stats]) => ({
        workflowId,
        workflowName: workflowMap.get(workflowId) || "Unknown",
        executionCount: stats.count,
        successRate:
          stats.count > 0 ? (stats.successful / stats.count) * 100 : 0,
        averageDuration:
          stats.count > 0 ? stats.totalDuration / stats.count : 0,
      }))
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, limit);

    return usage;
  }

  async getUserQuota(userId: string): Promise<UsageQuota> {
    const cacheKey = cacheService.getCacheKey("quota", userId);
    const cached = await cacheService.get<UsageQuota>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from("usage_quotas")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to get usage quota: ${error.message}`);
    }

    let result: UsageQuota;

    if (!data) {
      await supabase.from("usage_quotas").insert({
        user_id: userId,
        workflows_count: 0,
        executions_count: 0,
        executions_limit: 50,
        storage_used: 0,
      });

      result = {
        workflowsCount: 0,
        workflowsLimit: 10,
        executionsCount: 0,
        executionsLimit: 50,
        storageUsed: 0,
        storageLimit: 1073741824,
      };
    } else {
      result = {
        workflowsCount: data.workflows_count,
        workflowsLimit: 10,
        executionsCount: data.executions_count,
        executionsLimit: data.executions_limit,
        storageUsed: data.storage_used,
        storageLimit: 1073741824,
      };
    }

    await cacheService.set(cacheKey, result, { ttl: 180 });
    return result;
  }

  async getSlowestWorkflows(
    userId: string,
    limit: number = 10
  ): Promise<WorkflowUsage[]> {
    const usage = await this.getTopWorkflows(userId, 100);
    return usage
      .filter((w) => w.executionCount > 0)
      .sort((a, b) => b.averageDuration - a.averageDuration)
      .slice(0, limit);
  }

  async getFailedWorkflows(
    userId: string,
    limit: number = 10
  ): Promise<WorkflowUsage[]> {
    const usage = await this.getTopWorkflows(userId, 100);
    return usage
      .filter((w) => w.executionCount > 0 && w.successRate < 100)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, limit);
  }

  async getErrorAnalysis(
    userId: string,
    limit: number = 10
  ): Promise<ErrorAnalysis[]> {
    const cacheKey = cacheService.getCacheKey(
      "errors",
      userId,
      limit.toString()
    );
    const cached = await cacheService.get<ErrorAnalysis[]>(cacheKey);
    if (cached) return cached;

    const { data: executions, error } = await supabase
      .from("executions")
      .select("id, workflow_id, error_message, completed_at")
      .eq("user_id", userId)
      .eq("status", "failed")
      .not("error_message", "is", null)
      .order("completed_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to get error analysis: ${error.message}`);
    }

    const errorMap = new Map<
      string,
      {
        count: number;
        lastOccurred: string;
        workflows: Set<string>;
        executions: string[];
      }
    >();

    (executions || []).forEach((e) => {
      const errorMsg = e.error_message || "Unknown error";
      if (!errorMap.has(errorMsg)) {
        errorMap.set(errorMsg, {
          count: 0,
          lastOccurred: e.completed_at || "",
          workflows: new Set(),
          executions: [],
        });
      }
      const errorData = errorMap.get(errorMsg)!;
      errorData.count++;
      errorData.workflows.add(e.workflow_id);
      errorData.executions.push(e.id);
      if (
        !errorData.lastOccurred ||
        (e.completed_at && e.completed_at > errorData.lastOccurred)
      ) {
        errorData.lastOccurred = e.completed_at || "";
      }
    });

    const errors = Array.from(errorMap.entries())
      .map(([errorMessage, data]) => ({
        errorMessage,
        count: data.count,
        lastOccurred: data.lastOccurred,
        affectedWorkflows: data.workflows.size,
        affectedExecutions: data.executions.slice(0, 5),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    await cacheService.set(cacheKey, errors, { ttl: 600 });
    return errors;
  }

  async getResourceUsage(userId: string): Promise<ResourceUsage> {
    const cacheKey = cacheService.getCacheKey("resources", userId);
    const cached = await cacheService.get<ResourceUsage>(cacheKey);
    if (cached) return cached;

    const [renderHours, redisCommands, supabaseBandwidth, r2Storage] =
      await Promise.all([
        this.estimateRenderHours(),
        this.getRedisCommandUsage(),
        this.estimateSupabaseBandwidth(userId),
        this.getR2StorageUsage(userId),
      ]);

    const result: ResourceUsage = {
      render: {
        hoursUsed: renderHours,
        hoursLimit: 750,
        percentageUsed: (renderHours / 750) * 100,
      },
      redis: {
        commandsUsed: redisCommands.commandCount,
        commandsLimit: 10000,
        percentageUsed: (redisCommands.commandCount / 10000) * 100,
        commandsPerMinute: redisCommands.commandsPerMinute,
      },
      supabase: {
        bandwidthUsed: supabaseBandwidth,
        bandwidthLimit: 2 * 1024 * 1024 * 1024,
        percentageUsed: (supabaseBandwidth / (2 * 1024 * 1024 * 1024)) * 100,
      },
      r2: {
        storageUsed: r2Storage,
        storageLimit: 10 * 1024 * 1024 * 1024,
        percentageUsed: (r2Storage / (10 * 1024 * 1024 * 1024)) * 100,
      },
    };

    await cacheService.set(cacheKey, result, { ttl: 300 });
    return result;
  }

  private async estimateRenderHours(): Promise<number> {
    const uptimeSeconds = process.uptime();
    const uptimeHours = uptimeSeconds / 3600;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const daysSinceMonthStart = Math.floor(
      (Date.now() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)
    );

    const estimatedMonthlyHours =
      daysSinceMonthStart > 0
        ? (uptimeHours / daysSinceMonthStart) * 30
        : uptimeHours;

    return Math.min(estimatedMonthlyHours, 750);
  }

  private async getRedisCommandUsage(): Promise<{
    commandCount: number;
    commandsPerMinute: number;
  }> {
    const { queueService } = await import("./QueueService.js");
    const stats = queueService.getRedisStats();

    return {
      commandCount: Math.min(stats.dailyProjection, stats.commandCount),
      commandsPerMinute: stats.commandsPerMinute,
    };
  }

  private async estimateSupabaseBandwidth(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: executionCount, error: execError } = await supabase
      .from("executions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("started_at", startOfMonth.toISOString());

    if (execError) {
      console.warn("Failed to estimate bandwidth:", execError.message);
      return 0;
    }

    const { count: logCount, error: logError } = await supabase
      .from("execution_logs")
      .select("*", { count: "exact", head: true })
      .gte("timestamp", startOfMonth.toISOString());

    if (logError) {
      console.warn("Failed to count logs:", logError.message);
      return 0;
    }

    const avgExecutionSize = 2048;
    const avgLogSize = 256;

    const estimatedBandwidth =
      (executionCount || 0) * avgExecutionSize * 2 +
      (logCount || 0) * avgLogSize;

    return estimatedBandwidth;
  }

  private async getR2StorageUsage(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from("executions")
      .select("id")
      .eq("user_id", userId)
      .eq("archived", true);

    if (error) {
      console.warn("Failed to get R2 usage:", error.message);
      return 0;
    }

    const archivedCount = data?.length || 0;
    const avgArchiveSize = 51200;

    return archivedCount * avgArchiveSize;
  }

  async clearCache(userId: string): Promise<void> {
    await cacheService.del(`*:${userId}*`);
  }

  private async getWorkflowCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from("workflows")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to get workflow count: ${error.message}`);
    }

    return count || 0;
  }

  private async getExecutionStats(
    userId: string
  ): Promise<{ total: number; successRate: number; averageDuration: number }> {
    const { data, error } = await supabase
      .from("executions")
      .select("status, duration")
      .eq("user_id", userId)
      .eq("archived", false);

    if (error) {
      throw new Error(`Failed to get execution stats: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return { total: 0, successRate: 0, averageDuration: 0 };
    }

    const total = data.length;
    const successful = data.filter((e) => e.status === "completed").length;
    const totalDuration = data.reduce((sum, e) => sum + (e.duration || 0), 0);

    return {
      total,
      successRate: (successful / total) * 100,
      averageDuration: totalDuration / total,
    };
  }

  private async getMonthlyExecutionCount(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from("executions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("started_at", startOfMonth.toISOString());

    if (error) {
      throw new Error(
        `Failed to get monthly execution count: ${error.message}`
      );
    }

    return count || 0;
  }
}

export const analyticsService = new AnalyticsService();
