import { FastifyInstance } from "fastify";
import validator from "validator";
import { authenticate } from "../middleware/authenticate.js";
import { executionService } from "../services/ExecutionService.js";
import { getSignedUrl, BUCKETS, getUserFilePath } from "../config/storage.js";

export async function executionRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/executions",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { page, limit, workflowId, status, startDate, endDate } =
          request.query as {
            page?: string;
            limit?: string;
            workflowId?: string;
            status?: string;
            startDate?: string;
            endDate?: string;
          };

        const executions = await executionService.listExecutions({
          userId: request.user!.id,
          page: page ? (parseInt(page) || 1) : 1,
          limit: limit ? (parseInt(limit) || 10) : 10,
          workflowId,
          status: status as
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | undefined,
          startDate,
          endDate,
        });

        return reply.send(executions);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch executions",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/executions/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const execution = await executionService.getExecutionById(
          id,
          request.user!.id
        );

        if (!execution) {
          return reply.status(404).send({ error: "Execution not found" });
        }

        return reply.send(execution);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch execution",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/executions/:id/logs",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const { page, limit } = request.query as {
          page?: string;
          limit?: string;
        };

        const execution = await executionService.getExecutionById(
          id,
          request.user!.id
        );

        if (!execution) {
          return reply.status(404).send({ error: "Execution not found" });
        }

        const logs = await executionService.getLogs(id, request.user!.id, {
          page: page ? (parseInt(page) || 1) : 1,
          limit: limit ? (parseInt(limit) || 100) : 100,
        });

        return reply.send(logs);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch execution logs",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/executions/:id/screenshots",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }

        const userId = request.user!.id;
        const execution = await executionService.getExecutionById(id, userId);

        if (!execution) {
          return reply.status(404).send({ error: "Execution not found" });
        }

        // Fetch all logs for this execution and filter for screenshot entries
        const logsResult = await executionService.getLogs(id, userId, {
          limit: 5000,
        });

        const screenshotLogs = logsResult.logs.filter(
          (log) =>
            log.level === "info" &&
            log.message.startsWith("Screenshot saved: ")
        );

        // Generate signed URLs for each screenshot
        const screenshots = await Promise.all(
          screenshotLogs.map(async (log) => {
            const filename = log.message.replace("Screenshot saved: ", "");
            const storagePath = getUserFilePath(userId, filename);

            const { data, error } = await getSignedUrl(
              BUCKETS.EXECUTION_SCREENSHOTS,
              storagePath,
              3600 // 1 hour expiry
            );

            if (error || !data) {
              return null;
            }

            return {
              url: data.signedUrl,
              stepId: log.step_id || "unknown",
              timestamp: log.timestamp,
            };
          })
        );

        // Filter out any screenshots that failed to generate URLs
        const validScreenshots = screenshots.filter(
          (s): s is NonNullable<typeof s> => s !== null
        );

        return reply.send({ screenshots: validScreenshots });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch screenshots",
          message: error.message,
        });
      }
    }
  );

  fastify.delete(
    "/executions/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        await executionService.deleteExecution(id, request.user!.id);

        return reply.send({ success: true });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to delete execution",
          message: error.message,
        });
      }
    }
  );
}
