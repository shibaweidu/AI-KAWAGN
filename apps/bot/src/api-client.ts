import { searchAdPageSchema, type BotHeartbeat, type BotPlatform, type BotQueryMetricInput, type SearchAdPage } from "@ai-card/contracts";

export class BotApiClient {
  private readonly baseUrl: string;
  constructor(origin: string, private readonly internalSecret: string, private readonly platform: BotPlatform) {
    this.baseUrl = origin.replace(/\/+$/, "");
  }

  async search(query: string, page: number): Promise<SearchAdPage> {
    const parameters = new URLSearchParams({ q: query, sort: "price_asc", page: String(page), pageSize: "10" });
    const response = await fetch(`${this.baseUrl}/v1/offers?${parameters}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Search API returned ${response.status}`);
    return searchAdPageSchema.parse(await response.json());
  }

  config() { return this.internal<{ platform: BotPlatform; enabled: boolean }>(`/${this.platform}/config`); }
  chatAllowed(chatId: string) { return this.internal<{ allowed: boolean; label: string | null }>(`/${this.platform}/chats/${encodeURIComponent(chatId)}`); }
  heartbeat(body: BotHeartbeat) { return this.internal(`/${this.platform}/heartbeat`, { method: "POST", body: JSON.stringify(body) }); }
  metric(body: BotQueryMetricInput) { return this.internal(`/${this.platform}/metrics`, { method: "POST", body: JSON.stringify(body) }); }

  private async internal<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/internal/bots${path}`, {
      ...init, signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${this.internalSecret}`, "content-type": "application/json", ...init.headers },
    });
    if (!response.ok) throw new Error(`Internal bot API returned ${response.status}`);
    return response.json() as Promise<T>;
  }
}
