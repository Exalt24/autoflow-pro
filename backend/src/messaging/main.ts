// Entry point for the RabbitMQ worker: node dist/src/messaging/main.js
// It reads workflow run requests from a RabbitMQ queue and hands each one to the BullMQ queue the API worker already uses,
// so a producer that speaks AMQP can start a run without touching Redis or the API.
// It does not load the API's Supabase settings; it needs RABBITMQ_URL and REDIS_URL only.
import { createServer } from "node:http";
import amqp from "amqplib";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadRabbitConfig, redactUrl } from "./config.js";
import { consoleLogger, ReliableConsumer, type Handler } from "./consumer.js";
import { RedisIdempotencyStore } from "./idempotency.js";
import { validateRunRequest } from "./runRequest.js";

async function main(): Promise<void> {
  const cfg = loadRabbitConfig(process.env);
  const log = consoleLogger;

  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (err: Error) => log.error("redis error", { error: err.message }));

  // Same queue name and job defaults as backend/src/services/QueueService.ts.
  const workflowQueue = new Queue("workflow-executions", {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  const handler: Handler = async (payload) => {
    const run = validateRunRequest(payload);
    // The job id comes from the execution id, so BullMQ itself ignores a second add for the same run.
    await workflowQueue.add("execute-workflow", run, { jobId: `rmq-${run.executionId}` });
  };

  const connection = await amqp.connect(cfg.url);
  let ready = false;
  let shuttingDown = false;

  connection.on("error", (err: Error) => log.error("amqp connection error", { error: err.message }));
  connection.on("close", () => {
    if (shuttingDown) return;
    // Let Kubernetes restart the pod; a fresh process reconnects and re-declares everything.
    log.error("amqp connection closed unexpectedly, exiting");
    process.exit(1);
  });

  const consumer = new ReliableConsumer(connection, {
    queue: cfg.queue,
    policy: cfg.policy,
    store: new RedisIdempotencyStore(redis),
    handler,
    prefetch: cfg.prefetch,
    shutdownTimeoutMs: cfg.shutdownTimeoutMs,
    logger: log,
  });
  await consumer.start();
  ready = true;

  const health = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "alive" }));
    } else if (url === "/readyz") {
      const ok = ready && consumer.running;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ok ? "ready" : "not-ready" }));
    } else {
      res.writeHead(404).end();
    }
  });
  health.listen(cfg.healthPort, "0.0.0.0");

  log.info("rabbitmq worker started", { broker: redactUrl(cfg.url), queue: cfg.queue, healthPort: cfg.healthPort });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    log.info("shutting down", { signal });
    try {
      await consumer.stop();
      await connection.close();
      await workflowQueue.close();
      await redis.quit();
      health.close();
    } catch (err) {
      log.error("shutdown error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: "startup failed", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
