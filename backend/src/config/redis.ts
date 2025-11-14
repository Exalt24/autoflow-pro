import Redis from "ioredis";

const REDIS_URL = process.env.UPSTASH_REDIS_URL;

let redisClient: Redis | null = null;

export function createRedisClient(): Redis {
  if (!REDIS_URL) {
    throw new Error("Redis credentials missing. UPSTASH_REDIS_URL required.");
  }

  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 1000, 15000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ["READONLY", "ETIMEDOUT", "ECONNRESET"];
      return targetErrors.some((target) => err.message.includes(target));
    },
  });

  redisClient.on("connect", () => {
    console.log("✓ Redis connected");
  });

  redisClient.on("error", (err) => {
    console.error("✗ Redis error:", err.message);
  });

  redisClient.on("reconnecting", () => {
    console.log("⟳ Redis reconnecting...");
  });

  return redisClient;
}

export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = createRedisClient();
    await client.ping();
    console.log("✓ Redis connection test passed");
    return true;
  } catch (error) {
    console.error("✗ Redis connection test failed:", error);
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("✓ Redis connection closed");
  }
}

export { redisClient };
