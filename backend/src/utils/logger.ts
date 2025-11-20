import pino from "pino";
import { env } from "../config/environment.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function logError(error: Error, context?: Record<string, any>) {
  logger.error(
    {
      err: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...context,
    },
    "Error occurred"
  );
}

export function logInfo(message: string, data?: Record<string, any>) {
  logger.info(data, message);
}

export function logWarning(message: string, data?: Record<string, any>) {
  logger.warn(data, message);
}

export function logDebug(message: string, data?: Record<string, any>) {
  logger.debug(data, message);
}

export function logWorkflowExecution(
  workflowId: string,
  executionId: string,
  status: string,
  duration?: number
) {
  logger.info(
    {
      workflowId,
      executionId,
      status,
      duration,
      type: "workflow_execution",
    },
    `Workflow execution ${status}`
  );
}

export function logScheduledJobExecution(
  jobId: string,
  workflowId: string,
  status: string
) {
  logger.info(
    {
      jobId,
      workflowId,
      status,
      type: "scheduled_job",
    },
    `Scheduled job ${status}`
  );
}

export function logArchival(successful: number, failed: number, total: number) {
  logger.info(
    {
      successful,
      failed,
      total,
      type: "archival",
    },
    "Archival batch completed"
  );
}

export function logAPIRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  userId?: string
) {
  logger.info(
    {
      method,
      path,
      statusCode,
      duration,
      userId,
      type: "api_request",
    },
    `${method} ${path} - ${statusCode}`
  );
}
