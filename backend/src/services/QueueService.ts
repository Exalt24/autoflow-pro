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

  async addJob(
    data: WorkflowJobData,
    options?: {
      priority?: number;
      delay?: number;
    }
  ): Promise<Job<WorkflowJobData>> {
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
    return await this.queue.getJob(jobId);
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress?: unknown;
    result?: JobResult;
    failedReason?: string;
  } | null> {
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
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`✓ Job ${jobId} removed from queue`);
    }
  }

  async pauseQueue(): Promise<void> {
    await this.queue.pause();
    console.log("⏸ Queue paused");
  }

  async resumeQueue(): Promise<void> {
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
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
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
