// Entry point for the telemetry worker: node dist/src/telemetry/main.js
// Reads telemetry batches from a RabbitMQ queue and writes them to the lake (a local folder, TELEMETRY_LAKE_DIR).
// Settings: RABBITMQ_URL (required), TELEMETRY_LAKE_DIR (default ./telemetry-lake), RABBITMQ_QUEUE (default
// autoflow.telemetry.readings), TELEMETRY_INTERVAL_MS (default 60000), TELEMETRY_LATENESS_MS (default 900000), REDIS_URL
// (optional: shares the claim store with other workers; without it each process remembers its own).
// Run one worker per lake folder: the watermarks and the duplicate check live in this process.
import amqp from "amqplib";
import { Redis } from "ioredis";
import { loadRabbitConfig, redactUrl } from "../messaging/config.js";
import { consoleLogger, ReliableConsumer } from "../messaging/consumer.js";
import { InMemoryIdempotencyStore, RedisIdempotencyStore } from "../messaging/idempotency.js";
import { FsLakeStore } from "./lake.js";
import { TelemetryPipeline } from "./pipeline.js";
import { DEFAULT_QUEUE, createTelemetryHandler } from "./worker.js";

async function main(): Promise<void> {
  const env = process.env;
  const cfg = loadRabbitConfig({ ...env, REDIS_URL: env.REDIS_URL ?? "redis://unused:6379", RABBITMQ_QUEUE: env.RABBITMQ_QUEUE ?? DEFAULT_QUEUE });
  const log = consoleLogger;
  const num = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a whole number of milliseconds, got "${raw}"`);
    return n;
  };

  const lake = new FsLakeStore(env.TELEMETRY_LAKE_DIR ?? "./telemetry-lake");
  const { pipeline, restored, rollupFilesRepaired } = await TelemetryPipeline.open(lake, {
    expectedIntervalMs: num("TELEMETRY_INTERVAL_MS", 60_000),
    allowedLatenessMs: num("TELEMETRY_LATENESS_MS", 900_000),
    maxFutureMs: 5 * 60_000,
  });
  log.info("lake opened", { restoredReadings: restored, rollupFilesRepaired });

  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null;
  redis?.on("error", (err: Error) => log.error("redis error", { error: err.message }));

  const connection = await amqp.connect(cfg.url);
  let shuttingDown = false;
  connection.on("error", (err: Error) => log.error("amqp connection error", { error: err.message }));
  connection.on("close", () => {
    if (shuttingDown) return;
    log.error("amqp connection closed unexpectedly, exiting");
    process.exit(1);
  });

  const consumer = new ReliableConsumer(connection, {
    queue: cfg.queue,
    policy: cfg.policy,
    store: redis ? new RedisIdempotencyStore(redis, "telemetry:") : new InMemoryIdempotencyStore(),
    handler: createTelemetryHandler(pipeline),
    prefetch: cfg.prefetch,
    shutdownTimeoutMs: cfg.shutdownTimeoutMs,
    logger: log,
  });
  await consumer.start();
  log.info("telemetry worker started", { broker: redactUrl(cfg.url), queue: cfg.queue });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    try {
      await consumer.stop();
      await connection.close();
      await redis?.quit();
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
