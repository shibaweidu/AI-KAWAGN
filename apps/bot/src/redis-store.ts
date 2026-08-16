import { createHash, createHmac, randomBytes } from "node:crypto";
import Redis from "ioredis";
import { searchAdPageSchema, type SearchAdPage } from "@ai-card/contracts";
import type { PaginationState } from "./types";

export class BotRedisStore {
  readonly client: Redis;
  constructor(url: string, private readonly hashSecret: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  }

  async connect() { if (this.client.status === "wait") await this.client.connect(); }
  async close() { await this.client.quit(); }

  async allowRate(scope: "user" | "chat", identity: string, limit: number) {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `bot:rate:${scope}:${this.hash(identity)}:${bucket}`;
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, 70);
    return count <= limit;
  }

  async firstUpdate(updateId: number) {
    return (await this.client.set(`bot:update:${updateId}`, "1", "EX", 600, "NX")) === "OK";
  }

  async cachedSearch(query: string, page: number, load: () => Promise<SearchAdPage>) {
    const key = `bot:search:${createHash("sha256").update(`${query.toLocaleLowerCase("zh-CN")}:${page}`).digest("hex")}`;
    const cached = await this.client.get(key);
    if (cached) return searchAdPageSchema.parse(JSON.parse(cached));
    const result = await load();
    await this.client.set(key, JSON.stringify(result), "EX", 60);
    return result;
  }

  async paginationToken(state: PaginationState) {
    const token = randomBytes(8).toString("base64url");
    await this.client.set(`bot:page:${token}`, JSON.stringify(state), "EX", 600);
    return token;
  }

  async paginationState(token: string) {
    const value = await this.client.get(`bot:page:${token}`);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PaginationState>;
    return typeof parsed.query === "string" && typeof parsed.page === "number" && typeof parsed.chatId === "string" ? parsed as PaginationState : null;
  }

  acquirePollerLock(owner: string) { return this.client.set("bot:telegram:poller-lock", owner, "EX", 45, "NX"); }
  async refreshPollerLock(owner: string) {
    const result = await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end", 1, "bot:telegram:poller-lock", owner, "45");
    return result === 1;
  }
  releasePollerLock(owner: string) { return this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, "bot:telegram:poller-lock", owner); }

  private hash(value: string) { return createHmac("sha256", this.hashSecret).update(value).digest("hex"); }
}
