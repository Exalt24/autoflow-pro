import type { Redis } from "ioredis";

/**
 * RabbitMQ delivers at least once: a crash between "handler finished" and "ack" means the broker
 * sends the message again. The consumer claims a key per message id before it runs the handler,
 * so a repeat is acked without running the handler a second time.
 *
 * claim    -> "claimed" (go ahead), "done" (already handled, just ack) or "busy" (another consumer is on it right now)
 * complete -> mark handled for a long time
 * release  -> the handler failed, give the claim back so a retry can run
 */
export type ClaimResult = "claimed" | "done" | "busy";

export interface IdempotencyStore {
  claim(key: string, lockTtlMs: number): Promise<ClaimResult>;
  complete(key: string, doneTtlMs: number): Promise<void>;
  release(key: string): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private entries = new Map<string, { state: "processing" | "done"; expiresAt: number }>();

  constructor(private now: () => number = Date.now) {}

  async claim(key: string, lockTtlMs: number): Promise<ClaimResult> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > this.now()) {
      return existing.state === "done" ? "done" : "busy";
    }
    this.entries.set(key, { state: "processing", expiresAt: this.now() + lockTtlMs });
    return "claimed";
  }

  async complete(key: string, doneTtlMs: number): Promise<void> {
    this.entries.set(key, { state: "done", expiresAt: this.now() + doneTtlMs });
  }

  async release(key: string): Promise<void> {
    const existing = this.entries.get(key);
    if (existing?.state === "processing") this.entries.delete(key);
  }
}

// Delete the key only while it still says "processing", so a slow release never wipes a "done" written by someone else.
const RELEASE_LUA = 'if redis.call("GET", KEYS[1]) == "processing" then return redis.call("DEL", KEYS[1]) end return 0';

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private redis: Redis, private prefix = "idem:") {}

  async claim(key: string, lockTtlMs: number): Promise<ClaimResult> {
    const k = this.prefix + key;
    const set = await this.redis.set(k, "processing", "PX", lockTtlMs, "NX");
    if (set === "OK") return "claimed";
    const current = await this.redis.get(k);
    if (current === "done") return "done";
    if (current === null) return this.claim(key, lockTtlMs); // expired between the two calls
    return "busy";
  }

  async complete(key: string, doneTtlMs: number): Promise<void> {
    await this.redis.set(this.prefix + key, "done", "PX", doneTtlMs);
  }

  async release(key: string): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, this.prefix + key);
  }
}
