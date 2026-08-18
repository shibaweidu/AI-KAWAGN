import "./load-env";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const host = process.env.MEILI_HOST || "http://localhost:7700";
const headers = { "content-type": "application/json", authorization: `Bearer ${process.env.MEILI_MASTER_KEY || "change-me"}` };
const batchSize = 500;

async function meili(path: string, init: RequestInit = {}) {
  const response = await fetch(`${host}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Meilisearch ${response.status}: ${await response.text()}`);
  return response.json().catch(() => null) as Promise<{ taskUid?: number; uid?: number } | null>;
}

async function waitForTask(task: { taskUid?: number; uid?: number } | null) {
  const id = task?.taskUid ?? task?.uid;
  if (id === undefined) return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${host}/tasks/${id}`, { headers, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Meilisearch task ${id} returned ${response.status}`);
    const result = await response.json() as { status: string; error?: { message?: string } };
    if (result.status === "succeeded") return;
    if (result.status === "failed" || result.status === "canceled") throw new Error(result.error?.message || `Meilisearch task ${id} ${result.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${id} timed out`);
}

async function rebuildOffers() {
  await ensureIndex("offers");
  await waitForTask(await meili("/indexes/offers/documents", { method: "DELETE" }));
  let cursor = 0;
  while (true) {
    const offers = await prisma.offer.findMany({
      where: { active: true, shop: { status: "ACTIVE", publishedAt: { not: null } } },
      orderBy: { id: "asc" }, skip: cursor, take: batchSize,
      include: { canonicalProduct: { include: { category: true } }, shop: true, dataSource: true },
    });
    if (!offers.length) break;
    await waitForTask(await meili("/indexes/offers/documents", { method: "POST", body: JSON.stringify(offers.map((offer) => ({
      id: offer.id, productId: offer.canonicalProductId, title: offer.canonicalProduct.title,
      normalizedTitle: offer.canonicalProduct.normalizedTitle, category: offer.canonicalProduct.category.name,
      thumbnailUrl: offer.canonicalProduct.thumbnailUrl, shopId: offer.shopId, shopName: offer.shop.name,
      price: offer.price.toNumber(), stock: offer.stock, active: true, sourceName: offer.dataSource.name,
      observedAt: offer.sourceObservedAt.toISOString(),
    }))) }));
    cursor += offers.length;
    console.log(`offers: ${cursor}`);
  }
}

async function configureSettings() {
  for (const [uid, settings] of [["offers", { searchableAttributes: ["title", "normalizedTitle", "category", "shopName"], filterableAttributes: ["productId", "shopId", "active", "category"], sortableAttributes: ["price", "observedAt"] }], ["shops", { searchableAttributes: ["name", "description"], filterableAttributes: ["active", "publishedAt"] }]] as const) {
    await meili(`/indexes/${uid}/settings`, { method: "PATCH", body: JSON.stringify(settings) });
  }
}

async function rebuildShops() {
  await ensureIndex("shops");
  await waitForTask(await meili("/indexes/shops/documents", { method: "DELETE" }));
  let cursor = 0;
  while (true) {
    const shops = await prisma.shop.findMany({ where: { status: "ACTIVE", publishedAt: { not: null } }, orderBy: { id: "asc" }, skip: cursor, take: batchSize });
    if (!shops.length) break;
    await waitForTask(await meili("/indexes/shops/documents", { method: "POST", body: JSON.stringify(shops.map((shop) => ({
      id: shop.id, slug: shop.slug, name: shop.name, logoUrl: shop.logoUrl, description: shop.description,
      verified: true, active: true, publishedAt: shop.publishedAt?.toISOString(),
    }))) }));
    cursor += shops.length;
    console.log(`shops: ${cursor}`);
  }
}

async function ensureIndex(uid: string) {
  const existing = await fetch(`${host}/indexes/${uid}`, { headers, signal: AbortSignal.timeout(5_000) });
  let exists = existing.ok;
  if (existing.ok && ((await existing.json()) as { primaryKey?: string | null }).primaryKey == null) {
    const stats = await fetch(`${host}/indexes/${uid}/stats`, { headers, signal: AbortSignal.timeout(5_000) });
    const count = stats.ok ? Number(((await stats.json()) as { numberOfDocuments?: number }).numberOfDocuments || 0) : 1;
    if (count > 0) throw new Error(`Index ${uid} has documents but no primary key; delete it manually before rebuilding`);
    await waitForTask(await meili(`/indexes/${uid}`, { method: "DELETE" }));
    exists = false;
  } else if (!existing.ok && existing.status !== 404) throw new Error(`Index lookup ${uid} returned ${existing.status}`);
  if (!exists) await waitForTask(await meili("/indexes", { method: "POST", body: JSON.stringify({ uid, primaryKey: "id" }) }));
}

Promise.all([ensureIndex("offers"), ensureIndex("shops")])
  .then(() => configureSettings())
  .then(() => Promise.all([rebuildOffers(), rebuildShops()]))
  .then(() => console.log("search indexes rebuilt"))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
