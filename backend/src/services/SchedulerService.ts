import { queueService } from "./QueueService.js";
import { scheduledJobService } from "./ScheduledJobService.js";
import { workflowService } from "./WorkflowService.js";
import { executionService } from "./ExecutionService.js";
import { supabase } from "../config/supabase.js";

interface FailureTracker {
  [jobId: string]: {
    consecutiveFailures: number;
    lastFailureAt: string;
  };
}

export class SchedulerService {
  private isInitialized = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private failureTracker: FailureTracker = {};

  async initialize() {
    if (this.isInitialized) return;

    console.log("🕒 Initializing Scheduler Service...");

    await this.syncScheduledJobs();

    this.checkInterval = setInterval(() => {
      this.checkScheduledJobs().catch((error) => {
        console.error("Error checking scheduled jobs:", error);
      });
    }, 60000);

    this.isInitialized = true;
    console.log("✅ Scheduler Service initialized");
  }

  async syncScheduledJobs() {
    console.log("🔄 Syncing scheduled jobs with BullMQ...");

    const { data: jobs, error } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .eq("is_active", true);

    if (error) {
      console.error("Failed to fetch scheduled jobs:", error);
      return;
    }

    for (const job of jobs || []) {
      try {
        await this.addRepeatableJob(
          job.id,
          job.workflow_id,
          job.user_id,
          job.cron_schedule
        );
      } catch (error: any) {
        console.error(`Failed to sync job ${job.id}:`, error.message);
      }
    }

    console.log(`✅ Synced ${jobs?.length || 0} scheduled jobs`);
  }

  async addRepeatableJob(
    jobId: string,
    workflowId: string,
    userId: string,
    cronSchedule: string
  ) {
    const workflow = await workflowService.getWorkflowById(workflowId, userId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    await queueService.addRepeatableJob(
      {
        workflowId,
        userId,
        definition: workflow.definition,
      },
      cronSchedule,
      jobId
    );
  }

  async removeRepeatableJob(jobId: string, cronSchedule: string) {
    await queueService.removeRepeatableJob(jobId, cronSchedule);
  }

  async updateRepeatableJob(
    jobId: string,
    oldCronSchedule: string,
    newCronSchedule: string,
    workflowId: string,
    userId: string
  ) {
    await this.removeRepeatableJob(jobId, oldCronSchedule);
    await this.addRepeatableJob(jobId, workflowId, userId, newCronSchedule);
  }

  private async checkScheduledJobs() {
    const now = new Date().toISOString();

    const { data: dueJobs, error } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", now);

    if (error || !dueJobs || dueJobs.length === 0) return;

    // Batch fetch all workflows to avoid N+1 queries
    const uniqueWorkflowIds = [
      ...new Set(dueJobs.map((job) => job.workflow_id)),
    ];
    const { data: workflows, error: wfError } = await supabase
      .from("workflows")
      .select("*")
      .in("id", uniqueWorkflowIds);

    if (wfError) {
      console.error("Failed to batch fetch workflows:", wfError.message);
      return;
    }

    const workflowMap = new Map(
      (workflows || []).map((w) => [w.id, w])
    );

    for (const job of dueJobs) {
      try {
        const workflow = workflowMap.get(job.workflow_id);
        if (!workflow || workflow.user_id !== job.user_id) continue;

        const execution = await executionService.createExecution({
          workflowId: job.workflow_id,
          userId: job.user_id,
          status: "queued",
        });

        await queueService.addJob({
          workflowId: job.workflow_id,
          userId: job.user_id,
          executionId: execution.id,
          definition: workflow.definition,
        });

        await scheduledJobService.updateNextRunTime(job.id);

        console.log(
          `✅ Triggered scheduled job ${job.id} -> execution ${execution.id}`
        );

        setTimeout(
          () => this.checkExecutionResult(job.id, execution.id),
          120000
        );
      } catch (error: any) {
        console.error(
          `Failed to execute scheduled job ${job.id}:`,
          error.message
        );
        await this.recordFailure(job.id);
      }
    }
  }

  private async checkExecutionResult(jobId: string, executionId: string) {
    try {
      const { data: execution } = await supabase
        .from("executions")
        .select("status")
        .eq("id", executionId)
        .single();

      if (!execution) return;

      if (execution.status === "failed") {
        await this.recordFailure(jobId);
      } else if (execution.status === "completed") {
        this.resetFailureCount(jobId);
      }
    } catch (error) {
      console.error(`Failed to check execution result: ${error}`);
    }
  }

  private async recordFailure(jobId: string) {
    if (!this.failureTracker[jobId]) {
      this.failureTracker[jobId] = {
        consecutiveFailures: 0,
        lastFailureAt: new Date().toISOString(),
      };
    }

    this.failureTracker[jobId].consecutiveFailures += 1;
    this.failureTracker[jobId].lastFailureAt = new Date().toISOString();

    const failures = this.failureTracker[jobId].consecutiveFailures;

    console.warn(
      `⚠️  Scheduled job ${jobId} failed ${failures} times consecutively`
    );

    if (failures >= 5) {
      console.error(
        `❌ Pausing scheduled job ${jobId} after 5 consecutive failures`
      );
      await this.pauseJobDueToFailures(jobId);
    }
  }

  private resetFailureCount(jobId: string) {
    if (this.failureTracker[jobId]) {
      delete this.failureTracker[jobId];
    }
  }

  private async pauseJobDueToFailures(jobId: string) {
    try {
      const { data: job } = await supabase
        .from("scheduled_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (!job) return;

      await scheduledJobService.updateScheduledJob(jobId, job.user_id, {
        isActive: false,
      });

      await this.removeRepeatableJob(jobId, job.cron_schedule);

      console.log(`✅ Successfully paused job ${jobId}`);
    } catch (error) {
      console.error(`Failed to pause job ${jobId}:`, error);
    }
  }

  async getJobFailureStats(jobId: string) {
    const tracker = this.failureTracker[jobId];

    const jobResult = await supabase
      .from("scheduled_jobs")
      .select("workflow_id")
      .eq("id", jobId)
      .single();

    if (!jobResult.data) {
      throw new Error("Scheduled job not found");
    }

    const { data: recentExecutions } = await supabase
      .from("executions")
      .select("status")
      .eq("workflow_id", jobResult.data.workflow_id)
      .order("started_at", { ascending: false })
      .limit(20);

    const totalExecutions = recentExecutions?.length || 0;
    const failedExecutions =
      recentExecutions?.filter((e) => e.status === "failed").length || 0;
    const failureRate =
      totalExecutions > 0 ? (failedExecutions / totalExecutions) * 100 : 0;

    return {
      consecutiveFailures: tracker?.consecutiveFailures || 0,
      lastFailureAt: tracker?.lastFailureAt || null,
      recentFailureRate: Math.round(failureRate),
      totalRecentExecutions: totalExecutions,
      isPaused: tracker?.consecutiveFailures >= 5,
    };
  }

  async shutdown() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isInitialized = false;
    console.log("🛑 Scheduler Service shutdown");
  }
}

export const schedulerService = new SchedulerService();
