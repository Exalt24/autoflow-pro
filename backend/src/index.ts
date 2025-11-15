import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/environment.js";
import { testSupabaseConnection } from "./config/supabase.js";
import { queueService } from "./services/QueueService.js";
import { schedulerService } from "./services/SchedulerService.js";
import { processWorkflowJob } from "./services/WorkerProcessor.js";
import { workflowRoutes } from "./api/workflows.js";
import { executionRoutes } from "./api/executions.js";
import { analyticsRoutes } from "./api/analytics.js";
import { scheduledJobRoutes } from "./api/scheduled-jobs.js";
import { userRoutes } from "./api/user.js";
import { initializeWebSocket } from "./websocket/index.js";

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "development" ? "info" : "warn",
  },
});

await fastify.register(cors, {
  origin: env.CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: "15 minutes",
});

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  const statusCode = (error as any).statusCode || 500;
  reply.status(statusCode).send({
    error: (error as Error).name || "Internal Server Error",
    message: (error as Error).message,
    statusCode,
  });
});

fastify.get("/health", async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
  environment: env.NODE_ENV,
}));

fastify.get("/", async () => ({
  name: "AutoFlow Pro API",
  version: "1.0.0",
  status: "operational",
}));

await fastify.register(workflowRoutes, { prefix: "/api" });
await fastify.register(executionRoutes, { prefix: "/api" });
await fastify.register(analyticsRoutes, { prefix: "/api" });
await fastify.register(scheduledJobRoutes, { prefix: "/api" });
await fastify.register(userRoutes, { prefix: "/api" });

const start = async () => {
  try {
    console.log("\n🚀 Starting AutoFlow Pro API...\n");

    await testSupabaseConnection();
    queueService.setWorker(processWorkflowJob);
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    initializeWebSocket(fastify.server, env.CORS_ORIGIN);
    await schedulerService.initialize();

    console.log(`
╔════════════════════════════════════════════════════╗
║  🤖 AutoFlow Pro API                               ║
║  Port: ${env.PORT} | Environment: ${env.NODE_ENV.padEnd(18)}║
║  WebSocket: ✅ | Queue: ✅ | Scheduler: ✅          ║
╚════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log("\n🛑 Shutting down...");
  await schedulerService.shutdown();
  await queueService.close();
  await fastify.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
