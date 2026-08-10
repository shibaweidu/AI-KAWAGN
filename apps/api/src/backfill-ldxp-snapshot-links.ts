import "./load-env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CandidateReviewStatus, CollectionMode, Prisma, PrismaClient, SyncStatus } from "@prisma/client";
import { normalizeTitle, productFingerprint } from "@ai-card/crawler";

type SnapshotItem = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  price?: unknown;
  stock?: unknown;
  status?: unknown;
  shop?: unknown;
  shop_link?: unknown;
  link?: unknown;
  last_seen_at?: unknown;
  last_available_at?: unknown;
  image?: unknown;
  image_url?: unknown;
  thumbnail?: unknown;
  cover?: unknown;
};

type Snapshot = { items?: unknown[]; updated_at?: unknown; published_at?: unknown };

type ValidItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number | null;
  active: boolean;
  token: string;
  link: string;
  observedAt: Date;
  thumbnailUrl: string | null;
};

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function dateValue(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeImage(...values: unknown[]) {
  for (const value of values) {
    const candidate = stringValue(value);
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch { /* Optional image URL. */ }
  }
  return null;
}

function parseSnapshotItem(value: unknown): ValidItem | null {
  const item = value as SnapshotItem;
  const id = stringValue(item.id);
  const name = stringValue(item.name);
  const category = stringValue(item.category) || "其他";
  const shopLink = stringValue(item.shop_link);
  const link = stringValue(item.link);
  const price = numberValue(item.price);
  const observedAt = dateValue(item.last_seen_at) || dateValue(item.last_available_at);
  let token = "";
  try {
    const url = new URL(shopLink);
    if (url.protocol !== "https:" || url.hostname !== "pay.ldxp.cn" || !url.pathname.startsWith("/shop/")) return null;
    token = decodeURIComponent(url.pathname.slice("/shop/".length).replace(/\/$/, ""));
  } catch { return null; }
  if (!/^ldxp:[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[A-Za-z0-9._-]{1,100}$/.test(token) || !name || !/^https:\/\/pay\.ldxp\.cn\/item\/[A-Za-z0-9_-]+\/?$/.test(link) || price === null || price < 0 || price > 1_000_000 || !observedAt) return null;
  const stock = numberValue(item.stock);
  return {
    id, name, category, price, token, link, observedAt,
    stock: stock === null ? null : Math.max(0, Math.trunc(stock)),
    active: Number(item.status) !== 0,
    thumbnailUrl: safeImage(item.image, item.image_url, item.thumbnail, item.cover),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const filePath = resolve(process.argv.find((value) => value.startsWith("--file="))?.slice(7) || resolve(process.cwd(), "../../ldxp-shop-directory/data.public.json"));
  const raw = await readFile(filePath, "utf8");
  const snapshot = JSON.parse(raw) as Snapshot;
  const checksum = createHash("sha256").update(raw).digest("hex");
  const parsed = (snapshot.items || []).map(parseSnapshotItem).filter((item): item is ValidItem => Boolean(item));
  const grouped = new Map<string, Map<string, ValidItem>>();
  for (const item of parsed) {
    const products = grouped.get(item.token) || new Map<string, ValidItem>();
    products.set(item.id, item);
    grouped.set(item.token, products);
  }

  const prisma = new PrismaClient();
  let runId: string | null = null;
  try {
    const source = await prisma.dataSource.findUnique({ where: { key: "ldxp" } });
    if (!source) throw new Error("LDXP data source does not exist");
    const allCandidates = await prisma.shopCandidate.findMany({
      where: { dataSourceId: source.id },
      select: { id: true, externalId: true, reviewStatus: true, approvedShopId: true, rawMetadata: true },
      orderBy: { id: "asc" },
    });
    const matched = allCandidates.filter((candidate) => isRecord(candidate.rawMetadata)
      && candidate.rawMetadata.discoverySource === "211b.site"
      && grouped.has(candidate.externalId));
    const pending = matched.filter((candidate) => force || !isRecord(candidate.rawMetadata) || candidate.rawMetadata.offlineSnapshotChecksum !== checksum);
    const matchedProductIds = new Set(matched.flatMap((candidate) => [...(grouped.get(candidate.externalId)?.keys() || [])]));
    const existingCandidates = matched.length ? await prisma.offerCandidate.count({ where: { shopCandidateId: { in: matched.map((candidate) => candidate.id) }, externalId: { in: [...matchedProductIds] } } }) : 0;
    const approvedShopIds = matched.flatMap((candidate) => candidate.approvedShopId ? [candidate.approvedShopId] : []);
    const existingPublishedOffers = approvedShopIds.length ? await prisma.offer.count({
      where: { dataSourceId: source.id, shopId: { in: approvedShopIds }, externalId: { in: [...matchedProductIds] } },
    }) : 0;
    const matchedProducts = matched.reduce((sum, candidate) => sum + (grouped.get(candidate.externalId)?.size || 0), 0);
    const preview = {
      mode: apply ? "apply" : "dry-run",
      filePath,
      checksum,
      sourceItems: (snapshot.items || []).length,
      validItems: parsed.length,
      snapshotShops: grouped.size,
      exactMatchedShops: matched.length,
      pendingShops: pending.length,
      matchedProducts,
      existingCandidateLinks: existingCandidates,
      candidateLinksToCreate: Math.max(0, matchedProducts - existingCandidates),
      existingPublishedOffers,
      publishedOffersToCreate: Math.max(0, matchedProducts - existingPublishedOffers),
      caseVariantsMerged: 0,
    };
    if (!apply || !pending.length) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }

    const run = await prisma.ingestionRun.create({
      data: {
        dataSourceId: source.id,
        kind: "ldxp-snapshot-link-backfill",
        status: SyncStatus.RUNNING,
        checksum,
        rawSnapshotKey: filePath,
        startedAt: new Date(),
        counts: { ...preview, processedShops: 0, productsUpserted: 0, offersPromoted: 0 },
      },
    });
    runId = run.id;
    let processedShops = 0;
    let productsUpserted = 0;
    let offersPromoted = 0;

    for (const candidate of pending) {
      const items = [...(grouped.get(candidate.externalId)?.values() || [])];
      const snapshotObservedAt = items.reduce((latest, item) => item.observedAt > latest ? item.observedAt : latest, new Date(0));
      const result = await prisma.$transaction(async (tx) => {
        for (const item of items) {
          await tx.offerCandidate.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: item.id } },
            create: {
              dataSourceId: source.id, externalId: item.id, shopCandidateId: candidate.id, externalProductId: item.id,
              productName: item.name, category: item.category, price: item.price, currency: "CNY", stock: item.stock,
              stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock", offerUrl: item.link, observedAt: item.observedAt,
              ingestionRunId: run.id, active: item.active, rawMetadata: { sourceSite: "ldxp", importedSource: "local-snapshot", imageUrl: item.thumbnailUrl },
            },
            update: {
              shopCandidateId: candidate.id, externalProductId: item.id, productName: item.name, category: item.category,
              price: item.price, stock: item.stock, stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock",
              offerUrl: item.link, observedAt: item.observedAt, ingestionRunId: run.id, active: item.active, missingCount: 0,
              rawMetadata: { sourceSite: "ldxp", importedSource: "local-snapshot", imageUrl: item.thumbnailUrl },
            },
          });
          if (candidate.approvedShopId && (candidate.reviewStatus === CandidateReviewStatus.APPROVED || candidate.reviewStatus === CandidateReviewStatus.MERGED)) {
            const category = await tx.category.upsert({
              where: { slug: `ldxp-${productFingerprint(item.category, "category").slice(0, 16)}` },
              create: { slug: `ldxp-${productFingerprint(item.category, "category").slice(0, 16)}`, name: item.category },
              update: { name: item.category },
            });
            const fingerprint = productFingerprint(item.name, item.category);
            const canonical = await tx.canonicalProduct.upsert({
              where: { fingerprint },
              create: { slug: `product-${fingerprint}`, title: item.name, normalizedTitle: normalizeTitle(item.name), summary: "", thumbnailUrl: item.thumbnailUrl, categoryId: category.id, fingerprint },
              update: { title: item.name, normalizedTitle: normalizeTitle(item.name), thumbnailUrl: item.thumbnailUrl || undefined, categoryId: category.id },
            });
            const sourceProduct = await tx.sourceProduct.upsert({
              where: { shopId_dataSourceId_sourceId: { shopId: candidate.approvedShopId, dataSourceId: source.id, sourceId: item.id } },
              create: { shopId: candidate.approvedShopId, dataSourceId: source.id, sourceId: item.id, canonicalProductId: canonical.id, title: item.name, normalizedTitle: normalizeTitle(item.name), description: "", thumbnailUrl: item.thumbnailUrl, categoryHint: item.category, externalUrl: item.link, confidence: 1 },
              update: { canonicalProductId: canonical.id, title: item.name, normalizedTitle: normalizeTitle(item.name), thumbnailUrl: item.thumbnailUrl || undefined, categoryHint: item.category, externalUrl: item.link, active: true, confidence: 1 },
            });
            const existing = await tx.offer.findUnique({ where: { shopId_dataSourceId_externalId: { shopId: candidate.approvedShopId, dataSourceId: source.id, externalId: item.id } } });
            const offer = await tx.offer.upsert({
              where: { shopId_dataSourceId_externalId: { shopId: candidate.approvedShopId, dataSourceId: source.id, externalId: item.id } },
              create: { shopId: candidate.approvedShopId, sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, dataSourceId: source.id, externalId: item.id, collectionMode: CollectionMode.MANUAL, price: item.price, stock: item.stock, active: item.active, sourceUrl: item.link, sourceObservedAt: item.observedAt, syncedAt: new Date() },
              update: { sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, price: item.price, stock: item.stock, active: item.active, sourceUrl: item.link, sourceObservedAt: item.observedAt, syncedAt: new Date() },
            });
            const changed = !existing || !existing.price.equals(item.price) || existing.stock !== item.stock || existing.active !== item.active || existing.sourceUrl !== item.link;
            if (changed) {
              await tx.priceHistory.create({ data: { offerId: offer.id, price: item.price, stock: item.stock, capturedAt: item.observedAt } });
              await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: offer.id, payload: { offerId: offer.id, productId: canonical.id } } });
            }
          }
        }
        const currentMetadata = isRecord(candidate.rawMetadata) ? candidate.rawMetadata : {};
        const categories = [...new Set(items.map((item) => item.category))];
        await tx.shopCandidate.update({
          where: { id: candidate.id },
          data: {
            sourceSyncedAt: snapshotObservedAt,
            rawMetadata: {
              ...currentMetadata,
              productSyncStatus: "completed",
              productSyncSource: "local ldxp snapshot",
              productSyncedAt: snapshotObservedAt.toISOString(),
              productCount: items.length,
              categories,
              offlineSnapshotChecksum: checksum,
              offlineSnapshotBackfilledAt: new Date().toISOString(),
              offlineSnapshotPublishedAt: stringValue(snapshot.published_at) || stringValue(snapshot.updated_at) || null,
            },
          },
        });
        if (candidate.approvedShopId) await tx.shop.update({ where: { id: candidate.approvedShopId }, data: { lastSyncedAt: snapshotObservedAt } });
        return { products: items.length, promoted: candidate.approvedShopId ? items.length : 0 };
      }, { timeout: 120_000 });
      processedShops += 1;
      productsUpserted += result.products;
      offersPromoted += result.promoted;
      if (processedShops % 10 === 0 || processedShops === pending.length) {
        const counts = { ...preview, processedShops, productsUpserted, offersPromoted };
        await prisma.ingestionRun.update({ where: { id: run.id }, data: { counts } });
        process.stdout.write(`Snapshot shops ${processedShops}/${pending.length}, products ${productsUpserted}\n`);
      }
    }

    const finishedAt = new Date();
    const counts = { ...preview, processedShops, productsUpserted, offersPromoted };
    await prisma.$transaction([
      prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, counts, finishedAt } }),
      prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, lastSuccessAt: finishedAt } }),
    ]);
    process.stdout.write(`${JSON.stringify({ runId: run.id, ...counts }, null, 2)}\n`);
  } catch (error) {
    if (runId) await prisma.ingestionRun.update({
      where: { id: runId },
      data: { status: SyncStatus.FAILED, errorCode: error instanceof Error ? error.name : "UnknownError", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000), finishedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
