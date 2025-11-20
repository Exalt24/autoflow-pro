import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate.js";
import { analyticsService } from "../services/AnalyticsService.js";

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/analytics/stats",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const stats = await analyticsService.getUserStats(request.user!.id);
        return reply.send(stats);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch statistics",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/trends",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { days } = request.query as { days?: string };
        const trends = await analyticsService.getExecutionTrends(
          request.user!.id,
          days ? parseInt(days) : 30
        );
        return reply.send(trends);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch trends",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/top-workflows",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { limit } = request.query as { limit?: string };
        const workflows = await analyticsService.getTopWorkflows(
          request.user!.id,
          limit ? parseInt(limit) : 10
        );
        return reply.send(workflows);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch top workflows",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/usage",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const usage = await analyticsService.getUserQuota(request.user!.id);
        return reply.send(usage);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch usage data",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/slowest-workflows",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { limit } = request.query as { limit?: string };
        const workflows = await analyticsService.getSlowestWorkflows(
          request.user!.id,
          limit ? parseInt(limit) : 10
        );
        return reply.send(workflows);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch slowest workflows",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/failed-workflows",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { limit } = request.query as { limit?: string };
        const workflows = await analyticsService.getFailedWorkflows(
          request.user!.id,
          limit ? parseInt(limit) : 10
        );
        return reply.send(workflows);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch failed workflows",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/errors",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { limit } = request.query as { limit?: string };
        const errors = await analyticsService.getErrorAnalysis(
          request.user!.id,
          limit ? parseInt(limit) : 10
        );
        return reply.send(errors);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch error analysis",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/resources",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const resources = await analyticsService.getResourceUsage(
          request.user!.id
        );
        return reply.send(resources);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch resource usage",
          message: error.message,
        });
      }
    }
  );

  fastify.get(
    "/analytics/retention-policy",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { archivalService } = await import(
          "../services/ArchivalService.js"
        );
        const retentionDays = await archivalService.getUserRetentionDays(
          request.user!.id
        );
        return reply.send({ retentionDays });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch retention policy",
          message: error.message,
        });
      }
    }
  );

  fastify.put(
    "/analytics/retention-policy",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { retentionDays } = request.body as { retentionDays: number };

        if (![7, 30, 90].includes(retentionDays)) {
          return reply.status(400).send({
            error: "Invalid retention days",
            message: "Retention days must be 7, 30, or 90",
          });
        }

        const { archivalService } = await import(
          "../services/ArchivalService.js"
        );
        await archivalService.updateUserRetentionDays(
          request.user!.id,
          retentionDays
        );

        return reply.send({
          success: true,
          retentionDays,
          message: "Retention policy updated successfully",
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to update retention policy",
          message: error.message,
        });
      }
    }
  );
}
