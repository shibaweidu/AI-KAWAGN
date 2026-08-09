import {
  homeResponseSchema,
  searchAdPageSchema,
  searchSuggestionsSchema,
  shopPageSchema,
  type HomeResponse,
  type OfferFeedback,
  type SearchAdPage,
  type Shop,
} from "@ai-card/contracts";

async function readJson(response: Response) {
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
}

export async function getHome(signal?: AbortSignal): Promise<HomeResponse> {
  const payload = await readJson(await fetch("/api/v1/home", { signal, cache: "no-store" }));
  return homeResponseSchema.parse(payload);
}

export async function getOffers(query: URLSearchParams, signal?: AbortSignal): Promise<SearchAdPage> {
  const payload = await readJson(await fetch(`/api/v1/offers?${query.toString()}`, { signal, cache: "no-store" }));
  return searchAdPageSchema.parse(payload);
}

export async function getSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const payload = await readJson(await fetch(`/api/v1/search/suggestions?q=${encodeURIComponent(query)}`, { signal, cache: "no-store" }));
  return searchSuggestionsSchema.parse(payload).suggestions;
}

export async function getDirectoryShops(query: string, signal?: AbortSignal): Promise<Shop[]> {
  if (!query.trim()) return [];
  const payload = await readJson(await fetch(`/api/v1/shops?q=${encodeURIComponent(query.trim())}&sort=products&page=1&pageSize=20`, { signal, cache: "no-store" }));
  return shopPageSchema.parse(payload).items.filter((shop) => shop.dataLevel === "directory");
}

export async function submitOfferFeedback(offerId: string, feedback: OfferFeedback) {
  const response = await fetch(`/api/v1/feedback/offers/${offerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "反馈提交失败，请稍后重试");
  }
  return response.json() as Promise<{ accepted: true; ticket: string }>;
}
