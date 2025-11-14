import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/environment.js";
import { testSupabaseConnection } from "./config/supabase.js";
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

fastify.get("/health", async (request, reply) => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  };
});

fastify.get("/", async (request, reply) => {
  return {
    name: "AutoFlow Pro API",
    version: "1.0.0",
    status: "operational",
  };
});

await fastify.register(workflowRoutes, { prefix: "/api" });
await fastify.register(executionRoutes, { prefix: "/api" });
await fastify.register(analyticsRoutes, { prefix: "/api" });
await fastify.register(scheduledJobRoutes, { prefix: "/api" });
await fastify.register(userRoutes, { prefix: "/api" });

const start = async () => {
  try {
    console.log("\n🚀 Starting AutoFlow Pro API Server...\n");

    await testSupabaseConnection();
    console.log("✅ Supabase connection verified\n");

    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });

    const wsServer = initializeWebSocket(fastify.server, env.CORS_ORIGIN);
    console.log("✅ WebSocket server initialized\n");

    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🤖 AutoFlow Pro API Server                     ║
║                                                   ║
║   Environment: ${env.NODE_ENV.padEnd(33)}║
║   Port: ${env.PORT.toString().padEnd(41)}║
║   CORS: ${env.CORS_ORIGIN.padEnd(41)}║
║                                                   ║
║   Status: 🟢 Running                              ║
║   All routes registered                           ║
║   WebSocket: ✅ Active                            ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);

    console.log("\n📋 Available API Routes:\n");
    console.log("   Health Check:");
    console.log("   GET  /health");
    console.log("   GET  /\n");
    console.log("   Workflows:");
    console.log("   GET    /api/workflows");
    console.log("   GET    /api/workflows/:id");
    console.log("   POST   /api/workflows");
    console.log("   PUT    /api/workflows/:id");
    console.log("   DELETE /api/workflows/:id");
    console.log("   POST   /api/workflows/:id/duplicate");
    console.log("   POST   /api/workflows/:id/execute\n");
    console.log("   Executions:");
    console.log("   GET    /api/executions");
    console.log("   GET    /api/executions/:id");
    console.log("   GET    /api/executions/:id/logs");
    console.log("   DELETE /api/executions/:id\n");
    console.log("   Analytics:");
    console.log("   GET    /api/analytics/stats");
    console.log("   GET    /api/analytics/trends");
    console.log("   GET    /api/analytics/top-workflows");
    console.log("   GET    /api/analytics/usage");
    console.log("   GET    /api/analytics/slowest-workflows");
    console.log("   GET    /api/analytics/failed-workflows\n");
    console.log("   User:");
    console.log("   GET    /api/user/profile\n");
    console.log("   Scheduled Jobs (Phase 5):");
    console.log("   GET    /api/scheduled-jobs\n");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log("\n\n🛑 Shutting down gracefully...");
  await fastify.close();
  console.log("✅ Server closed");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
