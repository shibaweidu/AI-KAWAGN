import { Injectable } from "@nestjs/common";
import { CacheService } from "./cache.service";

type SearchResponse = { hits?: Array<Record<string, unknown>> };

@Injectable()
export class MeilisearchService {
  constructor(private readonly cache: CacheService) {}

  async searchIds(index: "offers" | "shops", query: string, field: "productId" | "id", limit = 1000): Promise<string[] | null> {
    const normalized = query.trim();
    if (!normalized) return null;
    const cacheKey = CacheService.key(`meili:${index}:${field}`, { query: normalized, limit });
    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached) return cached;
    try {
      const response = await fetch(`${process.env.MEILI_HOST || "http://localhost:7700"}/indexes/${index}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MEILI_MASTER_KEY || "change-me"}` },
        body: JSON.stringify({ q: normalized, limit, attributesToRetrieve: [field] }),
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) return null;
      const payload = await response.json() as SearchResponse;
      const ids = [...new Set((payload.hits || []).map((hit) => typeof hit[field] === "string" ? hit[field] as string : "").filter(Boolean))];
      await this.cache.set(cacheKey, ids, 30);
      return ids;
    } catch {
      return null;
    }
  }
}
