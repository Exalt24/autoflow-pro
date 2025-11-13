import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/environment.js";

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

await fastify.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: "15 minutes",
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
    status: "running",
  };
});

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  const statusCode = (error as any).statusCode || 500;
  const message = (error as any).message || "Internal Server Error";
  reply.status(statusCode).send({
    error: message,
    statusCode: statusCode,
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`
╔═══════════════════════════════════════╗
║   AutoFlow Pro Backend Started       ║
║   Port: ${env.PORT}                        ║
║   Environment: ${env.NODE_ENV}           ║
║   Health: http://localhost:${env.PORT}/health  ║
╚═══════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server");
  await fastify.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT signal received: closing HTTP server");
  await fastify.close();
  process.exit(0);
});

start();
