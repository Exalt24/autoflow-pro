import { FastifyRequest, FastifyReply } from "fastify";
import {
  isValidUUID,
  isValidURL,
  isValidCronExpression,
  isValidStepType,
  isValidWorkflowStatus,
  isValidExecutionStatus,
  isValidRetentionDays,
  isValidSelector,
} from "../utils/validators.js";

export async function validateWorkflowId(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  if (!isValidUUID(id)) {
    return reply.status(400).send({
      error: "Invalid workflow ID",
      message: "Workflow ID must be a valid UUID",
    });
  }
}

export async function validateExecutionId(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  if (!isValidUUID(id)) {
    return reply.status(400).send({
      error: "Invalid execution ID",
      message: "Execution ID must be a valid UUID",
    });
  }
}

export async function validateScheduledJobId(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  if (!isValidUUID(id)) {
    return reply.status(400).send({
      error: "Invalid scheduled job ID",
      message: "Scheduled job ID must be a valid UUID",
    });
  }
}

export async function validateWorkflowCreation(
  request: FastifyRequest<{
    Body: {
      name: string;
      description?: string;
      definition: any;
      status?: string;
    };
  }>,
  reply: FastifyReply
) {
  const { name, definition, status } = request.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return reply.status(400).send({
      error: "Invalid workflow name",
      message: "Name is required and must be a non-empty string",
    });
  }

  if (name.length > 200) {
    return reply.status(400).send({
      error: "Invalid workflow name",
      message: "Name must be less than 200 characters",
    });
  }

  if (!definition || typeof definition !== "object") {
    return reply.status(400).send({
      error: "Invalid workflow definition",
      message: "Definition is required and must be an object",
    });
  }

  if (!Array.isArray(definition.steps)) {
    return reply.status(400).send({
      error: "Invalid workflow definition",
      message: "Definition must contain a steps array",
    });
  }

  for (const step of definition.steps) {
    if (!step.id || !step.type || !step.config) {
      return reply.status(400).send({
        error: "Invalid step structure",
        message: "Each step must have id, type, and config",
      });
    }

    if (!isValidStepType(step.type)) {
      return reply.status(400).send({
        error: "Invalid step type",
        message: `Step type '${step.type}' is not valid`,
      });
    }

    if (step.config.url && !isValidURL(step.config.url)) {
      return reply.status(400).send({
        error: "Invalid URL in step config",
        message: `URL '${step.config.url}' is not valid`,
      });
    }

    if (step.config.selector && !isValidSelector(step.config.selector)) {
      return reply.status(400).send({
        error: "Invalid selector in step config",
        message: "Selector contains potentially dangerous content",
      });
    }
  }

  if (status && !isValidWorkflowStatus(status)) {
    return reply.status(400).send({
      error: "Invalid workflow status",
      message: "Status must be 'draft', 'active', or 'archived'",
    });
  }
}

export async function validateScheduledJobCreation(
  request: FastifyRequest<{
    Body: { workflowId: string; cronSchedule: string; isActive?: boolean };
  }>,
  reply: FastifyReply
) {
  const { workflowId, cronSchedule } = request.body;

  if (!workflowId || !isValidUUID(workflowId)) {
    return reply.status(400).send({
      error: "Invalid workflow ID",
      message: "Workflow ID must be a valid UUID",
    });
  }

  if (!cronSchedule || typeof cronSchedule !== "string") {
    return reply.status(400).send({
      error: "Invalid cron schedule",
      message: "Cron schedule is required and must be a string",
    });
  }

  if (!isValidCronExpression(cronSchedule)) {
    return reply.status(400).send({
      error: "Invalid cron expression",
      message: "Cron schedule must be a valid cron expression",
    });
  }
}

export async function validateRetentionPolicy(
  request: FastifyRequest<{ Body: { retentionDays: number } }>,
  reply: FastifyReply
) {
  const { retentionDays } = request.body;

  if (typeof retentionDays !== "number") {
    return reply.status(400).send({
      error: "Invalid retention days",
      message: "Retention days must be a number",
    });
  }

  if (!isValidRetentionDays(retentionDays)) {
    return reply.status(400).send({
      error: "Invalid retention days",
      message: "Retention days must be 7, 30, or 90",
    });
  }
}
