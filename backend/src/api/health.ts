import { FastifyInstance } from "fastify";
import {
  getHealthStatus,
  getSystemMetrics,
  formatUptime,
  formatBytes,
} from "../utils/metrics.js";
import { env } from "../config/environment.js";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply) => {
    const health = await getHealthStatus();

    const statusCode = health.status === "unhealthy" ? 503 : 200;

    return reply.status(statusCode).send({
      status: health.status,
      timestamp: health.timestamp,
      uptime: formatUptime(health.uptime),
      environment: env.NODE_ENV,
    });
  });

  fastify.get("/health/detailed", async (request, reply) => {
    const health = await getHealthStatus();

    const statusCode = health.status === "unhealthy" ? 503 : 200;

    return reply.status(statusCode).send(health);
  });

  fastify.get("/health/metrics", async (request, reply) => {
    const metrics = await getSystemMetrics();

    return reply.send({
      timestamp: new Date().toISOString(),
      uptime: formatUptime(metrics.uptime),
      memory: {
        used: formatBytes(metrics.memory.used),
        total: formatBytes(metrics.memory.total),
        percentage: `${Math.round(metrics.memory.percentage)}%`,
      },
      queue: {
        waiting: metrics.queue.waiting,
        active: metrics.queue.active,
        completed: metrics.queue.completed,
        failed: metrics.queue.failed,
        delayed: metrics.queue.delayed,
      },
      database: {
        connected: metrics.database.connected,
        responseTime: metrics.database.responseTime
          ? `${metrics.database.responseTime}ms`
          : "N/A",
      },
      redis: {
        connected: metrics.redis.connected,
        commandsPerMinute: metrics.redis.commandsPerMinute,
      },
    });
  });

  fastify.get("/health/ready", async (request, reply) => {
    const health = await getHealthStatus();

    const isReady =
      health.checks.database.status === "pass" &&
      health.checks.redis.status === "pass" &&
      health.checks.queue.status === "pass";

    if (isReady) {
      return reply.send({ ready: true });
    } else {
      return reply.status(503).send({ ready: false });
    }
  });

  fastify.get("/health/live", async (request, reply) => {
    return reply.send({ alive: true });
  });
}
