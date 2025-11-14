import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate.js";
import { executionService } from "../services/ExecutionService.js";

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
          page: page ? parseInt(page) : 1,
          limit: limit ? parseInt(limit) : 10,
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
          page: page ? parseInt(page) : 1,
          limit: limit ? parseInt(limit) : 100,
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

  fastify.delete(
    "/executions/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
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
