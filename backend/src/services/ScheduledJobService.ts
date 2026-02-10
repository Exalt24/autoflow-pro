import { supabase } from "../config/supabase.js";
import { Database } from "../types/database.js";
import { getNextRunTime, validateCronExpression } from "../utils/cron.js";

type ScheduledJob = Database["public"]["Tables"]["scheduled_jobs"]["Row"];
type ScheduledJobInsert =
  Database["public"]["Tables"]["scheduled_jobs"]["Insert"];
type ScheduledJobUpdate =
  Database["public"]["Tables"]["scheduled_jobs"]["Update"];

export interface CreateScheduledJobParams {
  userId: string;
  workflowId: string;
  cronSchedule: string;
  isActive?: boolean;
}

export interface UpdateScheduledJobParams {
  cronSchedule?: string;
  isActive?: boolean;
}

export interface ListScheduledJobsParams {
  userId: string;
  page?: number;
  limit?: number;
  workflowId?: string;
  isActive?: boolean;
}

export class ScheduledJobService {
  async createScheduledJob(
    params: CreateScheduledJobParams
  ): Promise<ScheduledJob> {
    const validation = validateCronExpression(params.cronSchedule);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }

    const nextRunAt = getNextRunTime(params.cronSchedule);

    const { data, error } = await supabase
      .from("scheduled_jobs")
      .insert({
        user_id: params.userId,
        workflow_id: params.workflowId,
        cron_schedule: params.cronSchedule,
        next_run_at: nextRunAt.toISOString(),
        is_active: params.isActive ?? true,
      })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create scheduled job: ${error.message}`);
    return data;
  }

  async getScheduledJobById(
    id: string,
    userId: string
  ): Promise<ScheduledJob | null> {
    const { data, error } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`Failed to get scheduled job: ${error.message}`);
    }

    return data;
  }

  async listScheduledJobs(params: ListScheduledJobsParams) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("scheduled_jobs")
      .select("*", { count: "exact" })
      .eq("user_id", params.userId);

    if (params.workflowId) {
      query = query.eq("workflow_id", params.workflowId);
    }

    if (params.isActive !== undefined) {
      query = query.eq("is_active", params.isActive);
    }

    query = query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error)
      throw new Error(`Failed to list scheduled jobs: ${error.message}`);

    return {
      scheduledJobs: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  async updateScheduledJob(
    id: string,
    userId: string,
    params: UpdateScheduledJobParams
  ): Promise<ScheduledJob> {
    if (params.cronSchedule) {
      const validation = validateCronExpression(params.cronSchedule);
      if (!validation.valid) {
        throw new Error(`Invalid cron expression: ${validation.error}`);
      }
    }

    const updateData: ScheduledJobUpdate = {};

    if (params.cronSchedule) {
      updateData.cron_schedule = params.cronSchedule;
      updateData.next_run_at = getNextRunTime(
        params.cronSchedule
      ).toISOString();
    }

    if (params.isActive !== undefined) {
      updateData.is_active = params.isActive;
    }

    const { data, error } = await supabase
      .from("scheduled_jobs")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update scheduled job: ${error.message}`);
    return data;
  }

  async deleteScheduledJob(id: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("scheduled_jobs")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error)
      throw new Error(`Failed to delete scheduled job: ${error.message}`);
  }

  async updateNextRunTime(id: string): Promise<void> {
    const { data: job, error: fetchError } = await supabase
      .from("scheduled_jobs")
      .select("cron_schedule")
      .eq("id", id)
      .single();

    if (fetchError)
      throw new Error(`Failed to fetch scheduled job: ${fetchError.message}`);

    if (!job) {
      throw new Error("Scheduled job not found");
    }

    const nextRunAt = getNextRunTime(job.cron_schedule);

    const { error: updateError } = await supabase
      .from("scheduled_jobs")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt.toISOString(),
      })
      .eq("id", id);

    if (updateError)
      throw new Error(`Failed to update run times: ${updateError.message}`);
  }

  async getUpcomingJobs(limit: number = 10): Promise<ScheduledJob[]> {
    const { data, error } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .eq("is_active", true)
      .order("next_run_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to get upcoming jobs: ${error.message}`);
    return data || [];
  }

  async getJobExecutionHistory(
    scheduledJobId: string,
    userId: string,
    limit: number = 20
  ) {
    const jobResult = await supabase
      .from("scheduled_jobs")
      .select("workflow_id")
      .eq("id", scheduledJobId)
      .single();

    if (!jobResult.data) {
      throw new Error("Scheduled job not found");
    }

    const { data, error } = await supabase
      .from("executions")
      .select("*")
      .eq("user_id", userId)
      .eq("workflow_id", jobResult.data.workflow_id)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error)
      throw new Error(`Failed to get execution history: ${error.message}`);
    return data || [];
  }
}

export const scheduledJobService = new ScheduledJobService();
