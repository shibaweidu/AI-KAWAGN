import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { createHash } from "node:crypto";

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 1_000,
      commandTimeout: 1_500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on("error", () => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) as T : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
    } catch {
      // Redis is an acceleration layer. A cache outage must not take down reads.
    }
  }

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number) {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, Math.max(1, windowSeconds));
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      // A Redis outage should not turn a read-only public endpoint into a 500.
      return { allowed: true, remaining: limit };
    }
  }

  static key(scope: string, value: unknown) {
    const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
    return `aicard:${scope}:${digest}`;
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
