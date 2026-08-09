import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_ORIGIN = "https://pay.ldxp.cn";
const ALLOWED_ENDPOINTS = new Set([
  "/shopApi/Shop/info",
  "/shopApi/Shop/categoryList",
  "/shopApi/Shop/goodsList",
]);
const GOODS_TYPES = new Set(["card", "article", "resource", "equity"]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function argument(name, fallback) {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  return value === undefined ? fallback : value;
}

const filePath = resolve(argument("file", process.env.LDXP_SNAPSHOT_PATH || resolve(scriptDirectory, "data.public.json")));
const concurrency = boundedInteger(argument("concurrency", "2"), 1, 4, "concurrency");
const delayMs = boundedInteger(argument("delay-ms", "350"), 200, 10_000, "delay-ms");
const maxShops = boundedInteger(argument("max-shops", "10000"), 1, 10_000, "max-shops");
const pageSize = 100;
let requestGate = Promise.resolve();
let nextRequestAt = 0;

function boundedInteger(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function safeHttpsImage(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function shopToken(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "pay.ldxp.cn" || !url.pathname.startsWith("/shop/")) return null;
  const token = decodeURIComponent(url.pathname.slice("/shop/".length).replace(/\/$/, ""));
  return /^[A-Za-z0-9._-]{1,100}$/.test(token) ? token : null;
}

async function waitForRequestSlot() {
  const previous = requestGate;
  let release;
  requestGate = new Promise((resolveGate) => { release = resolveGate; });
  await previous;
  const wait = Math.max(0, nextRequestAt - Date.now());
  if (wait) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
  nextRequestAt = Date.now() + delayMs;
  release();
}

async function post(endpoint, body) {
  if (!ALLOWED_ENDPOINTS.has(endpoint)) throw new Error(`Blocked LDXP endpoint: ${endpoint}`);
  await waitForRequestSlot();
  const response = await fetch(`${API_ORIGIN}${endpoint}`, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: API_ORIGIN,
      referer: `${API_ORIGIN}/`,
      "user-agent": process.env.CRAWLER_USER_AGENT || "AIKawangBot/0.1 (authorized local catalog refresh)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new Error(`${endpoint} returned ${contentType || "an unknown content type"}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`${endpoint} exceeded the 8 MB response limit`);
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || payload.code !== 1 || typeof payload.data !== "object") throw new Error(`${endpoint} rejected the request: ${payload?.msg || "unknown error"}`);
  return payload.data;
}

async function syncShop(token, existingItems, observedAt) {
  const info = await post("/shopApi/Shop/info", { token, category_key: null });
  const name = typeof info.nickname === "string" && info.nickname.trim() ? info.nickname.trim() : existingItems[0]?.shop || token;
  const shopLink = `${API_ORIGIN}/shop/${encodeURIComponent(token)}`;
  const shopLogo = safeHttpsImage(info.avatar);
  const declaredTypes = Array.isArray(info.goods_type_sort) ? info.goods_type_sort.filter((type) => GOODS_TYPES.has(type)) : [];
  const existingTypes = existingItems.map((item) => item.goods_type).filter((type) => GOODS_TYPES.has(type));
  const goodsTypes = [...new Set([...declaredTypes, ...existingTypes])];
  const items = [];

  for (const goodsType of goodsTypes) {
    let current = 1;
    let total = Number.POSITIVE_INFINITY;
    while ((current - 1) * pageSize < total && current <= 100) {
      const data = await post("/shopApi/Shop/goodsList", {
        token, keywords: "", category_id: 0, goods_type: goodsType, current, pageSize,
      });
      const list = Array.isArray(data.list) ? data.list : [];
      total = Number.isFinite(Number(data.total)) ? Math.max(0, Number(data.total)) : list.length;
      for (const product of list) {
        const key = typeof product.goods_key === "string" ? product.goods_key.trim() : "";
        const title = typeof product.name === "string" ? product.name.trim() : "";
        const category = typeof product.category?.name === "string" ? product.category.name.trim() : "其他";
        const price = Number(product.price);
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(key) || !title || !Number.isFinite(price) || price < 0 || price > 1_000_000) continue;
        const stockValue = Number(product.extend?.stock_count);
        items.push({
          id: `ldxp:${key}`,
          name: title,
          goods_type: goodsType,
          category: category || "其他",
          category_id: Number.isInteger(Number(product.category?.id)) ? Number(product.category.id) : undefined,
          price,
          stock: Number.isFinite(stockValue) ? Math.max(0, Math.trunc(stockValue)) : null,
          status: 1,
          verify: 1,
          shop: name,
          shop_link: shopLink,
          link: `${API_ORIGIN}/item/${key}`,
          source_site: "ldxp",
          image: safeHttpsImage(product.image),
          shop_logo: safeHttpsImage(product.user?.avatar) || shopLogo,
          last_available_at: observedAt,
          last_seen_at: observedAt,
          source_square_checked_at: observedAt,
          manual_source_checked_at: observedAt,
          public_stock_checked_at: observedAt,
        });
      }
      if (!list.length || current * pageSize >= total) break;
      current += 1;
    }
  }
  return { info, items };
}

async function main() {
  const raw = await readFile(filePath, "utf8");
  const snapshot = JSON.parse(raw);
  if (!snapshot || !Array.isArray(snapshot.items)) throw new Error("LDXP snapshot must contain an items array");
  const originalById = new Map(snapshot.items.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  const shopMap = new Map();
  for (const item of snapshot.items) {
    const token = typeof item?.shop_link === "string" ? shopToken(item.shop_link) : null;
    if (!token) continue;
    shopMap.set(token, [...(shopMap.get(token) || []), item]);
  }
  const shops = [...shopMap.entries()].slice(0, maxShops);
  const observedAt = new Date().toISOString();
  const updatedById = new Map(originalById);
  const failures = [];
  let cursor = 0;
  let succeeded = 0;
  let discovered = 0;

  async function worker() {
    while (cursor < shops.length) {
      const index = cursor++;
      const [token, existingItems] = shops[index];
      try {
        const result = await syncShop(token, existingItems, observedAt);
        const seen = new Set(result.items.map((item) => item.id));
        for (const existing of existingItems) {
          if (!seen.has(existing.id)) updatedById.set(existing.id, { ...existing, status: 0 });
        }
        for (const item of result.items) {
          if (!originalById.has(item.id)) discovered += 1;
          updatedById.set(item.id, { ...(originalById.get(item.id) || {}), ...item });
        }
        succeeded += 1;
      } catch (error) {
        failures.push({ token, error: error instanceof Error ? error.message : String(error) });
      }
      process.stdout.write(`\rLDXP shops ${index + 1}/${shops.length}, succeeded ${succeeded}, failed ${failures.length}`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");
  const nextSnapshot = {
    ...snapshot,
    published_at: observedAt,
    source_site: "ldxp",
    source_mode: "public-shop-api",
    items: [...updatedById.values()],
  };
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(nextSnapshot)}\n`, "utf8");
  await copyFile(temporaryPath, filePath);
  await unlink(temporaryPath);
  const result = { filePath, requestedShops: shops.length, succeeded, failed: failures.length, discovered, products: nextSnapshot.items.length, failures: failures.slice(0, 20) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length === shops.length && shops.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
