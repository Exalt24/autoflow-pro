import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { createRedisClient } from "../config/redis.js";

interface WorkflowJobData {
  workflowId: string;
  executionId: string;
  userId: string;
  definition: unknown;
}

interface JobResult {
  executionId: string;
  status: "completed" | "failed";
  duration?: number;
  error?: string;
}

class QueueService {
  private queue: Queue<WorkflowJobData>;
  private worker: Worker<WorkflowJobData, JobResult> | null = null;
  private queueEvents: QueueEvents;
  private redisCommandCount = 0;
  private commandCountResetTime = Date.now();

  constructor() {
    const connection = createRedisClient();

    this.queue = new Queue<WorkflowJobData>("workflow-executions", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 60000,
        },
        removeOnComplete: {
          count: 100,
        },
        removeOnFail: {
          count: 50,
        },
      },
    });

    this.queueEvents = new QueueEvents("workflow-executions", { connection });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.queueEvents.on("completed", ({ jobId }) => {
      console.log(`✓ Job ${jobId} completed`);
    });

    this.queueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(`✗ Job ${jobId} failed: ${failedReason}`);
    });

    this.queueEvents.on("progress", ({ jobId, data }) => {
      console.log(`⟳ Job ${jobId} progress: ${JSON.stringify(data)}`);
    });
  }

  private trackCommand() {
    this.redisCommandCount++;
  }

  async addJob(
    data: WorkflowJobData,
    options?: {
      priority?: number;
      delay?: number;
    }
  ): Promise<Job<WorkflowJobData>> {
    this.trackCommand();
    const job = await this.queue.add("execute-workflow", data, {
      priority: options?.priority,
      delay: options?.delay,
    });

    console.log(
      `✓ Job ${job.id} added to queue for execution ${data.executionId}`
    );
    return job;
  }

  async getJob(jobId: string): Promise<Job<WorkflowJobData> | undefined> {
    this.trackCommand();
    return await this.queue.getJob(jobId);
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress?: unknown;
    result?: JobResult;
    failedReason?: string;
  } | null> {
    this.trackCommand();
    const job = await this.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      status: state,
      progress,
      result,
      failedReason,
    };
  }

  async removeJob(jobId: string): Promise<void> {
    this.trackCommand();
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`✓ Job ${jobId} removed from queue`);
    }
  }

  async pauseQueue(): Promise<void> {
    this.trackCommand();
    await this.queue.pause();
    console.log("⏸ Queue paused");
  }

  async resumeQueue(): Promise<void> {
    this.trackCommand();
    await this.queue.resume();
    console.log("▶ Queue resumed");
  }

  async getQueueMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    this.trackCommand();
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }

  async addRepeatableJob(
    data: Omit<WorkflowJobData, "executionId">,
    cronSchedule: string,
    jobId: string
  ): Promise<void> {
    this.trackCommand();
    await this.queue.add("execute-workflow-scheduled", data as any, {
      repeat: {
        pattern: cronSchedule,
        key: jobId,
      },
      jobId: `scheduled-${jobId}`,
    });
    console.log(`✓ Repeatable job ${jobId} added with cron: ${cronSchedule}`);
  }

  async removeRepeatableJob(
    jobId: string,
    cronSchedule: string
  ): Promise<void> {
    this.trackCommand();
    await this.queue.removeRepeatable("execute-workflow-scheduled", {
      pattern: cronSchedule,
      key: jobId,
    });
    console.log(`✓ Repeatable job ${jobId} removed`);
  }

  async getRepeatableJobs() {
    this.trackCommand();
    return await this.queue.getRepeatableJobs();
  }

  getRedisStats(): {
    commandCount: number;
    timePeriodMs: number;
    commandsPerMinute: number;
    dailyProjection: number;
  } {
    const timePeriodMs = Date.now() - this.commandCountResetTime;
    const commandsPerMinute =
      timePeriodMs > 0 ? (this.redisCommandCount / timePeriodMs) * 60000 : 0;
    const dailyProjection = commandsPerMinute * 60 * 24;

    return {
      commandCount: this.redisCommandCount,
      timePeriodMs,
      commandsPerMinute: Math.round(commandsPerMinute),
      dailyProjection: Math.round(dailyProjection),
    };
  }

  resetRedisStats(): void {
    this.redisCommandCount = 0;
    this.commandCountResetTime = Date.now();
  }

  setWorker(
    processor: (job: Job<WorkflowJobData>) => Promise<JobResult>
  ): void {
    if (this.worker) {
      throw new Error("Worker already set");
    }

    const connection = createRedisClient();

    this.worker = new Worker<WorkflowJobData, JobResult>(
      "workflow-executions",
      processor,
      {
        connection,
        concurrency: 2,
        limiter: {
          max: 10,
          duration: 60000,
        },
      }
    );

    this.worker.on("completed", (job) => {
      console.log(`✓ Worker processed job ${job.id} successfully`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`✗ Worker failed job ${job?.id}: ${err.message}`);
    });

    console.log("✓ Queue worker initialized");
  }

  async close(): Promise<void> {
    await this.queueEvents.close();
    await this.queue.close();
    if (this.worker) {
      await this.worker.close();
    }
    console.log("✓ Queue service closed");
  }
}

export const queueService = new QueueService();
