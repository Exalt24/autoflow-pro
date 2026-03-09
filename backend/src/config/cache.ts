import { createRedisClient } from "./redis.js";

interface CacheOptions {
  ttl?: number;
}

const redisClient = createRedisClient();

export class CacheService {
  private defaultTTL = 300;
  private readonly keyPrefix = "autoflow:";

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redisClient.get(this.prefixedKey(key));
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set(
    key: string,
    value: unknown,
    options?: CacheOptions
  ): Promise<void> {
    try {
      const ttl = options?.ttl || this.defaultTTL;
      await redisClient.setex(this.prefixedKey(key), ttl, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redisClient.del(this.prefixedKey(key));
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redisClient.scan(
          cursor,
          "MATCH",
          `${this.keyPrefix}*`,
          "COUNT",
          100
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } while (cursor !== "0");
    } catch (error) {
      console.error("Cache clear error:", error);
    }
  }

  getCacheKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join(":")}`;
  }
}

export const cacheService = new CacheService();
