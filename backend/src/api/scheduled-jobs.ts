import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate.js";

export async function scheduledJobRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/scheduled-jobs",
    { preHandler: authenticate },
    async (request, reply) => {
      return reply.send({
        message: "Scheduled jobs feature coming in Phase 5",
        jobs: [],
      });
    }
  );

  fastify.post(
    "/scheduled-jobs",
    { preHandler: authenticate },
    async (request, reply) => {
      return reply.status(501).send({
        error: "Not Implemented",
        message: "Scheduled jobs feature coming in Phase 5",
      });
    }
  );

  fastify.put(
    "/scheduled-jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      return reply.status(501).send({
        error: "Not Implemented",
        message: "Scheduled jobs feature coming in Phase 5",
      });
    }
  );

  fastify.delete(
    "/scheduled-jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      return reply.status(501).send({
        error: "Not Implemented",
        message: "Scheduled jobs feature coming in Phase 5",
      });
    }
  );
}
