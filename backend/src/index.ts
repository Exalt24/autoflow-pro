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
import { archivalRoutes } from "./api/archival.js";
import { healthRoutes } from "./api/health.js";
import { initializeWebSocket } from "./websocket/index.js";
import { archivalService } from "./services/ArchivalService.js";
import { registerSecurityHeaders } from "./middleware/securityHeaders.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import { logger, logError, logInfo, logArchival } from "./utils/logger.js";

const fastify = Fastify({
  logger: false,
  disableRequestLogging: true,
});

await registerSecurityHeaders(fastify);
fastify.addHook("onRequest", sanitizeRequest);

fastify.addHook("onRequest", async (request, reply) => {
  request.startTime = Date.now();
});

fastify.addHook("onResponse", async (request, reply) => {
  const duration = Date.now() - (request.startTime || Date.now());
  const userId = (request as any).user?.id;

  logger.info(
    {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      userId,
    },
    `${request.method} ${request.url}`
  );
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
  const err = error instanceof Error ? error : new Error(String(error));

  logError(err, {
    method: request.method,
    url: request.url,
    userId: (request as any).user?.id,
  });

  const statusCode = (error as any).statusCode || 500;
  reply.status(statusCode).send({
    error: err.name || "Internal Server Error",
    message: err.message,
    statusCode,
  });
});

fastify.get("/", async () => ({
  name: "AutoFlow Pro API",
  version: "1.0.0",
  status: "operational",
}));

await fastify.register(healthRoutes);
await fastify.register(workflowRoutes, { prefix: "/api" });
await fastify.register(executionRoutes, { prefix: "/api" });
await fastify.register(analyticsRoutes, { prefix: "/api" });
await fastify.register(scheduledJobRoutes, { prefix: "/api" });
await fastify.register(userRoutes, { prefix: "/api" });
await fastify.register(archivalRoutes, { prefix: "/api" });

function setupDailyArchival() {
  const runArchival = async () => {
    try {
      logInfo("Starting daily archival");
      const result = await archivalService.archiveBatch();
      logArchival(result.successful, result.failed, result.total);
    } catch (error: any) {
      logError(error, { context: "daily_archival" });
    }
  };

  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const msUntilNext = next.getTime() - now.getTime();

    setTimeout(() => {
      runArchival();
      setInterval(runArchival, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  };

  scheduleNextRun();
}

const start = async () => {
  try {
    logInfo("Starting AutoFlow Pro API");

    await testSupabaseConnection();
    logInfo("Supabase connection verified");

    queueService.setWorker(processWorkflowJob);
    logInfo("Queue worker initialized");

    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    logInfo(`Server listening on port ${env.PORT}`);

    initializeWebSocket(fastify.server, env.CORS_ORIGIN);
    logInfo("WebSocket server initialized");

    await schedulerService.initialize();
    logInfo("Scheduler service initialized");

    setupDailyArchival();
    logInfo("Daily archival scheduled");

    console.log(`
╔════════════════════════════════════════════════════╗
║  🤖 AutoFlow Pro API                               ║
║  Port: ${env.PORT} | Environment: ${env.NODE_ENV.padEnd(18)}║
║  WebSocket: ✅ | Queue: ✅ | Scheduler: ✅          ║
║  Archival: ✅ (Daily at 2:00 AM)                   ║
║  Security: ✅ | Monitoring: ✅                      ║
╚════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    logError(err as Error, { context: "startup" });
    process.exit(1);
  }
};

const shutdown = async () => {
  logInfo("Shutting down gracefully");
  try {
    const shutdownTimeout = setTimeout(() => {
      logger.warn("Shutdown timeout - forcing exit");
      process.exit(1);
    }, 10000);

    await schedulerService.shutdown();
    await queueService.close();
    await fastify.close();

    clearTimeout(shutdownTimeout);
    logInfo("Shutdown complete");
    process.exit(0);
  } catch (err) {
    logError(err as Error, { context: "shutdown" });
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("uncaughtException", (err) => {
  logError(err, { context: "uncaught_exception" });
  shutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  logError(new Error(String(reason)), {
    context: "unhandled_rejection",
    promise: String(promise),
  });
  shutdown();
});

declare module "fastify" {
  interface FastifyRequest {
    startTime?: number;
  }
}

start();
