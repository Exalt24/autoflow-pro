import type { Job } from "bullmq";
import { AutomationEngine } from "./AutomationEngine.js";
import { executionService } from "./ExecutionService.js";
import { getWebSocketServer } from "../websocket/index.js";
import type { WebSocketServer } from "../websocket/index.js";
import { uploadFile, BUCKETS, getUserFilePath } from "../config/storage.js";
import type {
  ExecutionContext,
  ExecutionCallbacks,
} from "../types/automation.js";
import type { WorkflowDefinition } from "../types/database.js";

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

export async function processWorkflowJob(
  job: Job<WorkflowJobData>
): Promise<JobResult> {
  const { executionId, workflowId, userId, definition } = job.data;

  let wsServer: WebSocketServer | undefined;
  try {
    wsServer = getWebSocketServer();
  } catch (error) {
    // WebSocket not available in test mode - will be skipped gracefully
  }

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  try {
    await executionService.updateExecutionStatus(
      executionId,
      userId,
      "running"
    );

    wsServer?.broadcastToExecution(executionId, "execution:status", {
      executionId,
      status: "running",
      progress: 0,
    });

    const context: ExecutionContext = {
      executionId,
      workflowId,
      userId,
      definition: definition as WorkflowDefinition,
      variables: {},
      extractedData: {},
    };

    const callbacks: ExecutionCallbacks = {
      onProgress: async (progress) => {
        await job.updateProgress(progress.percentage);

        wsServer?.broadcastToExecution(executionId, "execution:status", {
          executionId,
          status: "running",
          progress: progress.percentage,
          estimatedTimeRemaining: progress.estimatedTimeRemaining,
        });
      },

      onLog: async (log) => {
        await executionService.addLog(
          executionId,
          userId,
          log.level,
          log.message,
          log.stepId
        );

        wsServer?.broadcastToExecution(executionId, "execution:log", {
          executionId,
          log: {
            timestamp: new Date().toISOString(),
            level: log.level,
            message: log.message,
            step_id: log.stepId,
          },
        });
      },

      onStepComplete: async (stepId, result) => {
        if (result.screenshot) {
          try {
            const filename = `${stepId}-${Date.now()}.png`;
            const path = getUserFilePath(userId, filename);

            await uploadFile(
              BUCKETS.EXECUTION_SCREENSHOTS,
              path,
              result.screenshot,
              "image/png"
            );

            await executionService.addLog(
              executionId,
              userId,
              "info",
              `Screenshot saved: ${filename}`,
              stepId
            );
          } catch (error: any) {
            await executionService.addLog(
              executionId,
              userId,
              "error",
              `Failed to upload screenshot: ${error.message}`,
              stepId
            );
          }
        }
      },

      onComplete: async (extractedData) => {
        const completedAt = new Date().toISOString();
        const startedExecution = await executionService.getExecutionById(
          executionId,
          userId
        );
        const duration = startedExecution
          ? Math.round(
              (new Date(completedAt).getTime() -
                new Date(startedExecution.started_at).getTime()) /
                1000
            )
          : 0;

        await executionService.updateExecution(executionId, userId, {
          status: "completed",
          completedAt,
          duration,
          extractedData,
        });

        wsServer?.broadcastToExecution(executionId, "execution:completed", {
          executionId,
          status: "completed",
          duration,
          extractedData,
        });

        wsServer?.broadcastToUser(userId, "execution:completed", {
          executionId,
          workflowId,
          status: "completed",
        });
      },

      onError: async (error, stepId) => {
        await executionService.addLog(
          executionId,
          userId,
          "error",
          error.message,
          stepId
        );
      },
    };

    await engine.executeWorkflow(context, callbacks);

    return {
      executionId,
      status: "completed",
      duration: 0,
    };
  } catch (error: any) {
    const completedAt = new Date().toISOString();
    const startedExecution = await executionService.getExecutionById(
      executionId,
      userId
    );
    const duration = startedExecution
      ? Math.round(
          (new Date(completedAt).getTime() -
            new Date(startedExecution.started_at).getTime()) /
            1000
        )
      : 0;

    await executionService.updateExecution(executionId, userId, {
      status: "failed",
      completedAt,
      duration,
      errorMessage: error.message,
    });

    wsServer?.broadcastToExecution(executionId, "execution:failed", {
      executionId,
      status: "failed",
      error: error.message,
    });

    wsServer?.broadcastToUser(userId, "execution:failed", {
      executionId,
      workflowId,
      status: "failed",
      error: error.message,
    });

    return {
      executionId,
      status: "failed",
      duration,
      error: error.message,
    };
  } finally {
    await engine.shutdown();
  }
}
