import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate.js";
import { archivalService } from "../services/ArchivalService.js";

export async function archivalRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/archival/stats",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const stats = await archivalService.getArchivalStats(request.user!.id);
        return reply.send(stats);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch archival stats",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/archival/eligible",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const executionIds = await archivalService.getExecutionsToArchive(
          request.user!.id
        );
        return reply.send({
          count: executionIds.length,
          executionIds,
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch eligible executions",
          message: error.message,
        });
      }
    }
  );

  fastify.post(
    "/archival/archive",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const result = await archivalService.archiveBatch(request.user!.id);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to archive executions",
          message: error.message,
        });
      }
    }
  );

  fastify.post(
    "/archival/restore/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        const { data: execution } = await (
          await import("../config/supabase.js")
        ).supabase
          .from("executions")
          .select("user_id")
          .eq("id", id)
          .single();

        if (!execution || execution.user_id !== request.user!.id) {
          return reply.status(404).send({
            error: "Execution not found",
          });
        }

        const restored = await archivalService.restoreExecution(id);

        if (!restored) {
          return reply.status(500).send({
            error: "Failed to restore execution",
          });
        }

        return reply.send({
          success: true,
          executionId: id,
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to restore execution",
          message: error.message,
        });
      }
    }
  );
}
