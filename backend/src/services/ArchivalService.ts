import { supabase } from "../config/supabase.js";
import { uploadToR2, deleteFromR2, r2Enabled } from "../config/r2.js";
import { cacheService } from "../config/cache.js";

interface ArchivalResult {
  executionId: string;
  archived: boolean;
  r2Key: string | null;
  error?: string;
}

export class ArchivalService {
  private readonly DEFAULT_RETENTION_DAYS = 30;
  private readonly BATCH_SIZE = 50;

  async getUserRetentionDays(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from("usage_quotas")
      .select("retention_days")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return this.DEFAULT_RETENTION_DAYS;
    }

    return data.retention_days || this.DEFAULT_RETENTION_DAYS;
  }

  async updateUserRetentionDays(
    userId: string,
    retentionDays: number
  ): Promise<boolean> {
    if (![7, 30, 90].includes(retentionDays)) {
      throw new Error("Retention days must be 7, 30, or 90");
    }

    const { data: existing, error: checkError } = await supabase
      .from("usage_quotas")
      .select("user_id")
      .eq("user_id", userId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw new Error(`Failed to check user quota: ${checkError.message}`);
    }

    if (!existing) {
      const { error: insertError } = await supabase
        .from("usage_quotas")
        .insert({
          user_id: userId,
          workflows_count: 0,
          executions_count: 0,
          executions_limit: 50,
          storage_used: 0,
          retention_days: retentionDays,
        });

      if (insertError) {
        throw new Error(`Failed to create user quota: ${insertError.message}`);
      }
    } else {
      const { error: updateError } = await supabase
        .from("usage_quotas")
        .update({ retention_days: retentionDays })
        .eq("user_id", userId);

      if (updateError) {
        throw new Error(
          `Failed to update retention policy: ${updateError.message}`
        );
      }
    }

    return true;
  }

  async getExecutionsToArchive(userId?: string): Promise<string[]> {
    let retentionDays = this.DEFAULT_RETENTION_DAYS;

    if (userId) {
      retentionDays = await this.getUserRetentionDays(userId);
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let query = supabase
      .from("executions")
      .select("id")
      .eq("archived", false)
      .lt("completed_at", cutoffDate.toISOString())
      .limit(this.BATCH_SIZE);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get executions to archive: ${error.message}`);
    }

    return (data || []).map((e) => e.id);
  }

  async archiveExecution(executionId: string): Promise<ArchivalResult> {
    if (!r2Enabled) {
      return {
        executionId,
        archived: false,
        r2Key: null,
        error: "R2 storage is not configured. Set CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_ACCOUNT_ID to enable archival.",
      };
    }

    try {
      const { data: execution, error: fetchError } = await supabase
        .from("executions")
        .select("*")
        .eq("id", executionId)
        .single();

      if (fetchError || !execution) {
        return {
          executionId,
          archived: false,
          r2Key: null,
          error: "Execution not found",
        };
      }

      if (execution.archived) {
        return {
          executionId,
          archived: true,
          r2Key: execution.r2_key,
          error: "Already archived",
        };
      }

      const archiveKey = `executions/${execution.user_id}/${executionId}.json`;

      const archiveData = {
        id: execution.id,
        workflow_id: execution.workflow_id,
        user_id: execution.user_id,
        status: execution.status,
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        duration: execution.duration,
        logs: execution.logs,
        extracted_data: execution.extracted_data,
        error_message: execution.error_message,
        archived_at: new Date().toISOString(),
      };

      await uploadToR2(
        archiveKey,
        JSON.stringify(archiveData, null, 2),
        "application/json"
      );

      const { error: updateError } = await supabase
        .from("executions")
        .update({
          archived: true,
          r2_key: archiveKey,
          logs: [],
          extracted_data: {},
        })
        .eq("id", executionId);

      if (updateError) {
        await deleteFromR2(archiveKey).catch(() => {});
        throw new Error(`Failed to update execution: ${updateError.message}`);
      }

      const { error: logsDeleteError } = await supabase
        .from("execution_logs")
        .delete()
        .eq("execution_id", executionId);

      if (logsDeleteError) {
        console.warn(
          `Failed to delete execution logs: ${logsDeleteError.message}`
        );
      }

      await this.invalidateAnalyticsCache(execution.user_id);

      return {
        executionId,
        archived: true,
        r2Key: archiveKey,
      };
    } catch (error: any) {
      return {
        executionId,
        archived: false,
        r2Key: null,
        error: error.message,
      };
    }
  }

  async archiveBatch(userId?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: ArchivalResult[];
  }> {
    const executionIds = await this.getExecutionsToArchive(userId);

    const results: ArchivalResult[] = [];

    for (const executionId of executionIds) {
      const result = await this.archiveExecution(executionId);
      results.push(result);

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const successful = results.filter((r) => r.archived && !r.error).length;
    const failed = results.filter((r) => !r.archived || r.error).length;

    return {
      total: results.length,
      successful,
      failed,
      results,
    };
  }

  async restoreExecution(executionId: string): Promise<boolean> {
    if (!r2Enabled) {
      console.error("R2 storage is not configured. Cannot restore archived executions.");
      return false;
    }

    try {
      const { data: execution, error: fetchError } = await supabase
        .from("executions")
        .select("r2_key, user_id")
        .eq("id", executionId)
        .single();

      if (fetchError || !execution || !execution.r2_key) {
        return false;
      }

      const { downloadFromR2 } = await import("../config/r2.js");
      const archiveData = await downloadFromR2(execution.r2_key);
      const parsedData = JSON.parse(archiveData.toString("utf-8"));

      const { error: updateError } = await supabase
        .from("executions")
        .update({
          archived: false,
          r2_key: null,
          logs: parsedData.logs || [],
          extracted_data: parsedData.extracted_data || {},
        })
        .eq("id", executionId);

      if (updateError) {
        throw new Error(`Failed to restore execution: ${updateError.message}`);
      }

      await this.invalidateAnalyticsCache(execution.user_id);

      return true;
    } catch (error: any) {
      console.error("Restore execution failed:", error);
      return false;
    }
  }

  async getArchivalStats(userId?: string): Promise<{
    totalExecutions: number;
    archivedExecutions: number;
    activeExecutions: number;
    eligibleForArchival: number;
    retentionDays?: number;
  }> {
    let retentionDays = this.DEFAULT_RETENTION_DAYS;

    if (userId) {
      retentionDays = await this.getUserRetentionDays(userId);
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let totalQuery = supabase
      .from("executions")
      .select("id", { count: "exact", head: true });
    let archivedQuery = supabase
      .from("executions")
      .select("id", { count: "exact", head: true })
      .eq("archived", true);
    let activeQuery = supabase
      .from("executions")
      .select("id", { count: "exact", head: true })
      .eq("archived", false);
    let eligibleQuery = supabase
      .from("executions")
      .select("id", { count: "exact", head: true })
      .eq("archived", false)
      .lt("completed_at", cutoffDate.toISOString());

    if (userId) {
      totalQuery = totalQuery.eq("user_id", userId);
      archivedQuery = archivedQuery.eq("user_id", userId);
      activeQuery = activeQuery.eq("user_id", userId);
      eligibleQuery = eligibleQuery.eq("user_id", userId);
    }

    const [totalRes, archivedRes, activeRes, eligibleRes] = await Promise.all([
      totalQuery,
      archivedQuery,
      activeQuery,
      eligibleQuery,
    ]);

    return {
      totalExecutions: totalRes.count || 0,
      archivedExecutions: archivedRes.count || 0,
      activeExecutions: activeRes.count || 0,
      eligibleForArchival: eligibleRes.count || 0,
      retentionDays: userId ? retentionDays : undefined,
    };
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

export const archivalService = new ArchivalService();
