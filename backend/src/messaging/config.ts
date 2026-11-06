import type { RetryPolicy } from "./retryPolicy.js";

export interface RabbitConfig {
  url: string;
  queue: string;
  prefetch: number;
  policy: RetryPolicy;
  redisUrl: string;
  healthPort: number;
  shutdownTimeoutMs: number;
}

const DEFAULT_DELAYS = "5000,30000,120000";
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

function intIn(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
  }
  return n;
}

export function parseDelays(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0 || parts.length > 10) {
    throw new Error("RABBITMQ_RETRY_DELAYS_MS needs 1 to 10 comma separated values");
  }
  return parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DELAY_MS) {
      throw new Error(`RABBITMQ_RETRY_DELAYS_MS entries must be whole milliseconds from 1 to ${MAX_DELAY_MS}, got "${p}"`);
    }
    return n;
  });
}

export function loadRabbitConfig(env: Record<string, string | undefined>): RabbitConfig {
  const url = env.RABBITMQ_URL;
  if (!url) throw new Error("Missing required environment variable: RABBITMQ_URL");
  if (!/^amqps?:\/\//.test(url)) throw new Error("RABBITMQ_URL must start with amqp:// or amqps://");
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) throw new Error("Missing required environment variable: REDIS_URL");

  const queue = (env.RABBITMQ_QUEUE ?? "autoflow.workflow.execute").trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(queue)) {
    throw new Error("RABBITMQ_QUEUE may only hold letters, digits, dot, dash and underscore (1 to 120 characters)");
  }

  return {
    url,
    queue,
    prefetch: intIn("RABBITMQ_PREFETCH", env.RABBITMQ_PREFETCH, 5, 1, 1000),
    policy: { delaysMs: parseDelays(env.RABBITMQ_RETRY_DELAYS_MS ?? DEFAULT_DELAYS) },
    redisUrl,
    healthPort: intIn("HEALTH_PORT", env.HEALTH_PORT, 8081, 1, 65535),
    shutdownTimeoutMs: intIn("SHUTDOWN_TIMEOUT_MS", env.SHUTDOWN_TIMEOUT_MS, 25000, 1, 600000),
  };
}

/** For logs: the URL without the user and password. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "(unparseable url)";
  }
}
