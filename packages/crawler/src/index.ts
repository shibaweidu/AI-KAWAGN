import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { XMLParser } from "fast-xml-parser";

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

export type PublicCatalogShop = {
  externalId: string;
  name: string;
  shopUrl: string;
  observedAt: string;
  rawMetadata: Record<string, unknown>;
};

export type PublicCatalogOffer = {
  externalId: string;
  shopExternalId: string;
  shopName: string;
  shopUrl: string;
  externalProductId: string;
  productName: string;
  specification: string;
  category: string;
  price: number;
  currency: string;
  stock: number | null;
  stockStatus: string;
  offerUrl: string;
  observedAt: string;
  rawMetadata: Record<string, unknown>;
};

export type PublicCatalogSnapshot = {
  snapshotId: string;
  generatedAt: string;
  shops: PublicCatalogShop[];
  offers: PublicCatalogOffer[];
  rejectedShops: number;
  rejectedOffers: number;
  raw: string;
  etag: string | null;
  lastModified: string | null;
};

type CardnavPayload = { c?: unknown; p?: unknown; s?: unknown; pc?: unknown; sc?: unknown };

export function parseCardnavPayload(payload: unknown): Omit<PublicCatalogSnapshot, "snapshotId" | "raw" | "etag" | "lastModified"> {
  const body = isRecord(payload) ? payload as CardnavPayload : {};
  const categories = Array.isArray(body.c) ? body.c : [];
  const shopRows = Array.isArray(body.s) ? body.s : [];
  const productRows = Array.isArray(body.p) ? body.p : [];
  if (shopRows.length > 20_000 || productRows.length > 50_000) throw new Error("Cardnav payload exceeds catalog limits");

  const shopsByIndex = new Map<number, PublicCatalogShop>();
  let rejectedShops = 0;
  shopRows.forEach((value, index) => {
    if (!Array.isArray(value)) { rejectedShops += 1; return; }
    const externalId = textValue(value[0]);
    const name = textValue(value[1]);
    const shopUrl = catalogHttpsUrl(value[2]);
    if (!externalId || !name || !shopUrl) { rejectedShops += 1; return; }
    const observedAt = catalogDate(value[3]);
    shopsByIndex.set(index, {
      externalId,
      name,
      shopUrl,
      observedAt,
      rawMetadata: { score: finiteNumber(value[4]), featured: value[5] === 1 },
    });
  });

  const offers: PublicCatalogOffer[] = [];
  let rejectedOffers = 0;
  for (const value of productRows) {
    if (!Array.isArray(value)) { rejectedOffers += 1; continue; }
    const shop = shopsByIndex.get(Number(value[0]));
    const category = textValue(categories[Number(value[1])]) || "其他";
    const productName = textValue(value[2]);
    const price = finiteNumber(value[3]);
    const offerUrl = catalogHttpsUrl(value[5]);
    if (!shop || !productName || price === null || price < 0 || price > 1_000_000 || !offerUrl) { rejectedOffers += 1; continue; }
    const stock = nonNegativeInteger(value[6]);
    const observedAt = catalogDate(value[8]);
    offers.push({
      externalId: stableUrlId(offerUrl),
      shopExternalId: shop.externalId,
      shopName: shop.name,
      shopUrl: shop.shopUrl,
      externalProductId: stableUrlId(offerUrl),
      productName,
      specification: "",
      category,
      price,
      currency: "CNY",
      stock,
      stockStatus: value[7] === 0 || stock === 0 ? "out_of_stock" : "in_stock",
      offerUrl,
      observedAt,
      rawMetadata: { imageUrl: catalogHttpsUrl(value[4]), score: finiteNumber(value[9]), categoryIndex: Number(value[1]) },
    });
  }

  const generatedAt = offers.reduce((latest, offer) => offer.observedAt > latest ? offer.observedAt : latest, new Date(0).toISOString());
  return { generatedAt, shops: [...shopsByIndex.values()], offers, rejectedShops, rejectedOffers };
}

export class CardnavCatalogClient {
  static readonly catalogUrl = new URL("https://cardnav.xyz/api/shop-products.json");

  async fetchSnapshot(cache: { etag?: string | null; lastModified?: string | null } = {}): Promise<PublicCatalogSnapshot | { notModified: true; etag: string | null; lastModified: string | null }> {
    const response = await safeFetch(CardnavCatalogClient.catalogUrl, {
      accept: "application/json",
      etag: cache.etag,
      lastModified: cache.lastModified,
      maxBytes: 24 * 1024 * 1024,
      timeoutMs: 30_000,
    });
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    if (response.status === 304) return { notModified: true, etag, lastModified };
    if (!response.ok) throw new Error(`Cardnav catalog returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Cardnav catalog returned an unexpected content type");
    const raw = await readLimitedText(response, 24 * 1024 * 1024);
    const parsed = parseCardnavPayload(JSON.parse(raw));
    return { ...parsed, snapshotId: createHash("sha256").update(raw).digest("hex"), raw, etag, lastModified };
  }
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function textValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function finiteNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function nonNegativeInteger(value: unknown) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function boundedTotal(value: unknown) { const number = Number(value); if (!Number.isInteger(number) || number < 0 || number > 50_000) throw new Error("Catalog total is outside allowed limits"); return number; }
function catalogDate(value: unknown) { const timestamp = typeof value === "number" ? value : Date.parse(String(value || "")); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(); }
function catalogHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value.trim()); if (url.protocol !== "https:" || url.username || url.password) return null; url.hash = ""; return url.href; } catch { return null; }
}
function stableUrlId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function normalizePublicCatalogStatus(value: string) { return /out|sold|unavailable|expired/i.test(value) ? "out_of_stock" : /low/i.test(value) ? "low_stock" : "in_stock"; }

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
