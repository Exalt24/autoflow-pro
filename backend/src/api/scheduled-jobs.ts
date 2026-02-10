import { FastifyInstance } from "fastify";
import validator from "validator";
import { authenticate } from "../middleware/authenticate.js";
import { scheduledJobService } from "../services/ScheduledJobService.js";
import { schedulerService } from "../services/SchedulerService.js";
import { getNextNRunTimes } from "../utils/cron.js";

export async function scheduledJobRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/scheduled-jobs/:id/stats",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }

        const scheduledJob = await scheduledJobService.getScheduledJobById(
          id,
          request.user!.id
        );

        if (!scheduledJob) {
          return reply.status(404).send({ error: "Scheduled job not found" });
        }

        const stats = await schedulerService.getJobFailureStats(id);

        return reply.send(stats);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch job stats",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/scheduled-jobs",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { page, limit, workflowId, isActive } = request.query as {
          page?: string;
          limit?: string;
          workflowId?: string;
          isActive?: string;
        };

        const result = await scheduledJobService.listScheduledJobs({
          userId: request.user!.id,
          page: page ? (parseInt(page) || 1) : 1,
          limit: limit ? (parseInt(limit) || 20) : 20,
          workflowId,
          isActive: isActive !== undefined ? isActive === "true" : undefined,
        });

        return reply.send(result);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch scheduled jobs",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/scheduled-jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const scheduledJob = await scheduledJobService.getScheduledJobById(
          id,
          request.user!.id
        );

        if (!scheduledJob) {
          return reply.status(404).send({ error: "Scheduled job not found" });
        }

        return reply.send(scheduledJob);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch scheduled job",
          message: error.message,
        });
      }
    }
  );

  fastify.post(
    "/scheduled-jobs",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { workflowId, cronSchedule, isActive } = request.body as {
          workflowId: string;
          cronSchedule: string;
          isActive?: boolean;
        };

        if (!workflowId || !cronSchedule) {
          return reply.status(400).send({
            error: "Missing required fields",
            message: "workflowId and cronSchedule are required",
          });
        }

        const scheduledJob = await scheduledJobService.createScheduledJob({
          userId: request.user!.id,
          workflowId,
          cronSchedule,
          isActive: isActive ?? true,
        });

        return reply.status(201).send(scheduledJob);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to create scheduled job",
          message: error.message,
        });
      }
    }
  );

  fastify.put(
    "/scheduled-jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const { cronSchedule, isActive } = request.body as {
          cronSchedule?: string;
          isActive?: boolean;
        };

        const existingJob = await scheduledJobService.getScheduledJobById(
          id,
          request.user!.id
        );

        if (!existingJob) {
          return reply.status(404).send({ error: "Scheduled job not found" });
        }

        const scheduledJob = await scheduledJobService.updateScheduledJob(
          id,
          request.user!.id,
          { cronSchedule, isActive }
        );

        return reply.send(scheduledJob);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to update scheduled job",
          message: error.message,
        });
      }
    }
  );

  fastify.delete(
    "/scheduled-jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }

        const existingJob = await scheduledJobService.getScheduledJobById(
          id,
          request.user!.id
        );

        if (!existingJob) {
          return reply.status(404).send({ error: "Scheduled job not found" });
        }

        await scheduledJobService.deleteScheduledJob(id, request.user!.id);

        return reply.send({ success: true });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to delete scheduled job",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/scheduled-jobs/:id/next-runs",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const { count } = request.query as { count?: string };

        const scheduledJob = await scheduledJobService.getScheduledJobById(
          id,
          request.user!.id
        );

        if (!scheduledJob) {
          return reply.status(404).send({ error: "Scheduled job not found" });
        }

        const nextRuns = getNextNRunTimes(
          scheduledJob.cron_schedule,
          count ? (parseInt(count) || 5) : 5
        );

        return reply.send({
          cronSchedule: scheduledJob.cron_schedule,
          nextRuns: nextRuns.map((date) => date.toISOString()),
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to calculate next runs",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/scheduled-jobs/:id/history",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const { limit } = request.query as { limit?: string };

        const executions = await scheduledJobService.getJobExecutionHistory(
          id,
          request.user!.id,
          limit ? (parseInt(limit) || 20) : 20
        );

        return reply.send({
          scheduledJobId: id,
          executions,
          total: executions.length,
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch execution history",
          message: error.message,
        });
      }
    }
  );
}
