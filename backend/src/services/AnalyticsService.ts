import { supabase } from "../config/supabase.js";

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

class AnalyticsService {
  async getUserStats(userId: string): Promise<UsageStats> {
    const [workflowsCount, executionsStats, monthlyExecutions] =
      await Promise.all([
        this.getWorkflowCount(userId),
        this.getExecutionStats(userId),
        this.getMonthlyExecutionCount(userId),
      ]);

    return {
      totalWorkflows: workflowsCount,
      totalExecutions: executionsStats.total,
      executionsThisMonth: monthlyExecutions,
      successRate: executionsStats.successRate,
      averageDuration: executionsStats.averageDuration,
    };
  }

  async getExecutionTrends(
    userId: string,
    days: number = 30
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
    const { data, error } = await supabase
      .from("usage_quotas")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to get usage quota: ${error.message}`);
    }

    if (!data) {
      await supabase.from("usage_quotas").insert({
        user_id: userId,
        workflows_count: 0,
        executions_count: 0,
        executions_limit: 50,
        storage_used: 0,
      });

      return {
        workflowsCount: 0,
        workflowsLimit: 10,
        executionsCount: 0,
        executionsLimit: 50,
        storageUsed: 0,
        storageLimit: 1073741824,
      };
    }

    return {
      workflowsCount: data.workflows_count,
      workflowsLimit: 10,
      executionsCount: data.executions_count,
      executionsLimit: data.executions_limit,
      storageUsed: data.storage_used,
      storageLimit: 1073741824,
    };
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
