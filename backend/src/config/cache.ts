import { createRedisClient } from "./redis.js";

interface CacheOptions {
  ttl?: number;
}

const redisClient = createRedisClient();

export class CacheService {
  private defaultTTL = 300;

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redisClient.get(key);
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
      await redisClient.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  async del(pattern: string): Promise<void> {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (error) {
      console.error(`Cache delete error for pattern ${pattern}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await redisClient.flushdb();
    } catch (error) {
      console.error("Cache clear error:", error);
    }
  }

  getCacheKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join(":")}`;
  }
}

export const cacheService = new CacheService();
