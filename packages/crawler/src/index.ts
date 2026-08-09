import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { XMLParser } from "fast-xml-parser";
import { priceAiPointerSchema, priceAiSnapshotSchema, type PriceAiPointer, type PriceAiSnapshot } from "@ai-card/contracts";

export type DiscoveredShop = { name: string; sourceId: string; homepage: string };
export type RawProduct = { id: string; title: string; description?: string; price: number | string; stock?: number; url: string; category?: string };
export type NormalizedProduct = { sourceId: string; title: string; normalizedTitle: string; description: string; price: number; stock: number | null; url: string; category: string; fingerprint: string };

export interface ShopAdapter {
  readonly kind: string;
  healthCheck(baseUrl: URL): Promise<boolean>;
  discoverShop(baseUrl: URL): Promise<DiscoveredShop>;
  fetchProducts(baseUrl: URL): Promise<RawProduct[]>;
  normalizeProduct(product: RawProduct): NormalizedProduct;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

type SafeFetchOptions = {
  accept: string;
  etag?: string | null;
  lastModified?: string | null;
  maxBytes?: number;
  timeoutMs?: number;
};

async function safeFetch(url: URL, options: SafeFetchOptions): Promise<Response> {
  await assertPublicHttps(url.href);
  const headers: Record<string, string> = {
    accept: options.accept,
    "user-agent": process.env.CRAWLER_USER_AGENT || "AIKawangBot/0.1 (+https://aikawang.example/contact)",
  };
  if (options.etag) headers["if-none-match"] = options.etag;
  if (options.lastModified) headers["if-modified-since"] = options.lastModified;
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs || 20_000),
  });
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > (options.maxBytes || DEFAULT_MAX_BYTES)) throw new Error("Source response exceeds size limit");
  return response;
}

async function readLimitedText(response: Response, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Source response exceeds size limit");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

export async function assertPublicHttps(input: string): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only credential-free HTTPS URLs are allowed");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error("Hostname did not resolve");
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throw new Error("Private network targets are blocked");
  }
  return url;
}

export function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedV4 = normalized.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedV4) {
    const parts = mappedV4.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113);
  }
  if (isIP(normalized) !== 6) return true;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

export function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[\s|｜_\-—]+/g, " ").replace(/[^\p{L}\p{N}\s+]/gu, "").trim();
}

export function parsePrice(value: string | number): number {
  const number = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error("Invalid product price");
  return Math.round(number * 100) / 100;
}

export function productFingerprint(title: string, category = "other"): string {
  return createHash("sha256").update(`${normalizeTitle(title)}|${category.toLowerCase()}`).digest("hex").slice(0, 24);
}

export class JsonApiAdapter implements ShopAdapter {
  readonly kind: string = "json-api";
  constructor(private readonly path = "/api/products") {}
  async healthCheck(baseUrl: URL) {
    const url = new URL(this.path, baseUrl);
    await assertPublicHttps(url.href);
    const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(8000) });
    return response.ok;
  }
  async discoverShop(baseUrl: URL) { return { name: baseUrl.hostname, sourceId: baseUrl.hostname, homepage: baseUrl.href }; }
  async fetchProducts(baseUrl: URL) {
    const response = await safeFetch(new URL(this.path, baseUrl), { accept: "application/json", maxBytes: DEFAULT_MAX_BYTES, timeoutMs: 15_000 });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Source returned an unexpected content type");
    const body = JSON.parse(await readLimitedText(response, DEFAULT_MAX_BYTES)) as unknown;
    const products = Array.isArray(body) ? body : (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : null);
    if (!products || products.length > 10_000) throw new Error("Unexpected product payload");
    return products as RawProduct[];
  }
  normalizeProduct(product: RawProduct): NormalizedProduct {
    const category = product.category || "other";
    return { sourceId: String(product.id), title: product.title.trim(), normalizedTitle: normalizeTitle(product.title), description: product.description?.trim() || "", price: parsePrice(product.price), stock: Number.isInteger(product.stock) ? product.stock! : null, url: product.url, category, fingerprint: productFingerprint(product.title, category) };
  }
}

export class DujiaokaAdapter extends JsonApiAdapter {
  readonly kind = "dujiaoka";
  constructor() { super("/api/v1/products"); }
}

export class PriceAiFeedClient {
  static readonly pointerUrl = new URL("https://data.priceai.cc/latest.json");

  async fetchPointer(cache: { etag?: string | null; lastModified?: string | null } = {}): Promise<{
    notModified: boolean;
    etag: string | null;
    lastModified: string | null;
    pointer?: PriceAiPointer;
    raw?: string;
  }> {
    const response = await safeFetch(PriceAiFeedClient.pointerUrl, {
      accept: "application/json",
      etag: cache.etag,
      lastModified: cache.lastModified,
      maxBytes: 128 * 1024,
    });
    const metadata = { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    if (response.status === 304) return { notModified: true, ...metadata };
    if (!response.ok) throw new Error(`PriceAI pointer returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("PriceAI pointer returned an unexpected content type");
    const raw = await readLimitedText(response, 128 * 1024);
    return { notModified: false, ...metadata, pointer: priceAiPointerSchema.parse(JSON.parse(raw)), raw };
  }

  async fetchSnapshot(pointer: PriceAiPointer): Promise<{ snapshot: PriceAiSnapshot; raw: string }> {
    const snapshotUrl = new URL(pointer.snapshot_url);
    if (snapshotUrl.protocol !== "https:" || snapshotUrl.hostname !== "data.priceai.cc" || !snapshotUrl.pathname.startsWith("/v1/snapshots/")) {
      throw new Error("Unexpected PriceAI snapshot URL");
    }
    const response = await safeFetch(snapshotUrl, { accept: "application/json", maxBytes: 12 * 1024 * 1024, timeoutMs: 30_000 });
    if (!response.ok) throw new Error(`PriceAI snapshot returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("PriceAI snapshot returned an unexpected content type");
    const raw = await readLimitedText(response, 12 * 1024 * 1024);
    const snapshot = priceAiSnapshotSchema.parse(JSON.parse(raw));
    if (snapshot.snapshot_id !== pointer.snapshot_id) throw new Error("PriceAI snapshot ID mismatch");
    return { snapshot, raw };
  }
}

export type TaokayouShopReference = { externalId: string; directoryUrl: string; lastModified: string | null };
export type TaokayouShopMetadata = {
  externalId: string;
  name: string;
  directoryUrl: string;
  logoUrl: string | null;
  sourceListedAt: string | null;
  sourceSyncedAt: string | null;
};

export class TaokayouDirectoryClient {
  static readonly sitemapUrl = new URL("https://www.taokayou.com/sitemap.xml");

  async fetchSitemap(cache: { etag?: string | null; lastModified?: string | null } = {}): Promise<{
    notModified: boolean;
    etag: string | null;
    lastModified: string | null;
    shops: TaokayouShopReference[];
    raw?: string;
  }> {
    const response = await safeFetch(TaokayouDirectoryClient.sitemapUrl, {
      accept: "application/xml,text/xml",
      etag: cache.etag,
      lastModified: cache.lastModified,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 30_000,
    });
    const metadata = { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    if (response.status === 304) return { notModified: true, ...metadata, shops: [] };
    if (!response.ok) throw new Error(`Taokayou sitemap returned ${response.status}`);
    const raw = await readLimitedText(response, 8 * 1024 * 1024);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(raw) as { urlset?: { url?: Array<{ loc?: string; lastmod?: string }> | { loc?: string; lastmod?: string } } };
    const entries = parsed.urlset?.url ? (Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url]) : [];
    const shops = entries.flatMap((entry) => {
      if (!entry.loc) return [];
      const url = new URL(entry.loc);
      const match = url.hostname === "www.taokayou.com" ? url.pathname.match(/^\/shop\/(\d+)$/) : null;
      return match ? [{ externalId: match[1], directoryUrl: url.href, lastModified: entry.lastmod || null }] : [];
    });
    return { notModified: false, ...metadata, shops, raw };
  }

  async fetchShop(reference: TaokayouShopReference): Promise<{ metadata: TaokayouShopMetadata; raw: string }> {
    const url = new URL(reference.directoryUrl);
    if (url.hostname !== "www.taokayou.com" || url.pathname !== `/shop/${reference.externalId}`) throw new Error("Unexpected Taokayou shop URL");
    const response = await safeFetch(url, { accept: "text/html", maxBytes: 2 * 1024 * 1024, timeoutMs: 25_000 });
    if (!response.ok) throw new Error(`Taokayou shop page returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Taokayou shop page returned an unexpected content type");
    const raw = await readLimitedText(response, 2 * 1024 * 1024);
    return { metadata: parseTaokayouShopPage(reference, raw), raw };
  }
}

export function parseTaokayouShopPage(reference: TaokayouShopReference, html: string): TaokayouShopMetadata {
  const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
    || html.match(/<title>([^<]+?)(?:\s+-\s+店铺商品与价格)?\s*\|?[^<]*<\/title>/i)?.[1];
  if (!title?.trim()) throw new Error("Taokayou shop page is missing a name");
  const logo = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
  const sourceSyncedAt = html.match(/<strong>([^<]+)<\/strong>\s*<small>最近同步<\/small>/i)?.[1] || null;
  const sourceListedAt = html.match(/<strong>([^<]+)<\/strong>\s*<small>平台收录<\/small>/i)?.[1] || null;
  return {
    externalId: reference.externalId,
    name: decodeHtml(title.replace(/\s*\|\s*淘卡优\s*$/, "").trim()),
    directoryUrl: reference.directoryUrl,
    logoUrl: logo && logo !== "https://www.taokayou.com/" ? logo : null,
    sourceListedAt: normalizeSourceDate(sourceListedAt),
    sourceSyncedAt: normalizeSourceDate(sourceSyncedAt),
  };
}

function normalizeSourceDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}+08:00`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
