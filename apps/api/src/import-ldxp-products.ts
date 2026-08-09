import "./load-env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CandidateReviewStatus, CollectionMode, DataSourceKind, Prisma, PrismaClient, SyncStatus } from "@prisma/client";
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
  shop_logo?: unknown;
};

type Snapshot = { items?: unknown[]; published_at?: unknown };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
}

function date(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function httpsImage(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value);
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch { /* Ignore malformed optional image fields. */ }
  }
  return null;
}

function shopExternalId(value: string) {
  const url = new URL(value);
  return decodeURIComponent(url.pathname.replace(/^\/shop\//, "").replace(/\/$/, ""));
}

function validItem(value: unknown) {
  const item = value as SnapshotItem;
  const id = text(item.id);
  const name = text(item.name);
  const category = text(item.category) || "其他";
  const shop = text(item.shop);
  const shopLink = text(item.shop_link);
  const link = text(item.link);
  const price = number(item.price);
  const observedAt = date(item.last_seen_at) || date(item.last_available_at);
  if (!id || !name || !shop || !/^https:\/\/pay\.ldxp\.cn\/shop\//.test(shopLink) || !/^https:\/\/pay\.ldxp\.cn\/item\//.test(link) || price === null || price < 0 || price > 1_000_000 || !observedAt) return null;
  const stockValue = number(item.stock);
  return {
    id, name, category, shop, shopLink, link, price,
    stock: stockValue === null ? null : Math.max(0, Math.trunc(stockValue)),
    observedAt, active: Number(item.status) !== 0,
    thumbnailUrl: httpsImage(item.image, item.image_url, item.thumbnail, item.cover),
    shopLogoUrl: httpsImage(item.shop_logo),
  };
}

async function main() {
  const filePath = resolve(process.argv.find((value) => value.startsWith("--file="))?.slice(7) || resolve(process.cwd(), "../../ldxp-shop-directory/data.public.json"));
  const raw = await readFile(filePath, "utf8");
  const snapshot = JSON.parse(raw) as Snapshot;
  const items = (snapshot.items || []).map(validItem).filter((item): item is NonNullable<ReturnType<typeof validItem>> => Boolean(item));
  const checksum = createHash("sha256").update(raw).digest("hex");
  const prisma = new PrismaClient();
  let runId: string | null = null;
  try {
    const source = await prisma.dataSource.upsert({
      where: { key: "ldxp" },
      create: {
        key: "ldxp", name: "链动小店", kind: DataSourceKind.MANUAL_IMPORT,
        baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn", enabled: false,
        pollIntervalSeconds: 6 * 60 * 60, robotsReviewedAt: new Date(), lastSnapshotId: checksum,
      },
      update: { name: "链动小店", kind: DataSourceKind.MANUAL_IMPORT, baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn", lastSnapshotId: checksum },
    });
    const run = await prisma.ingestionRun.create({
      data: { dataSourceId: source.id, kind: "ldxp-products-import", status: SyncStatus.RUNNING, checksum, rawSnapshotKey: filePath, startedAt: new Date() },
    });
    runId = run.id;

    const candidates = await prisma.shopCandidate.findMany({
      where: { dataSource: { key: "ldxp" }, reviewStatus: { in: [CandidateReviewStatus.APPROVED, CandidateReviewStatus.MERGED] }, approvedShopId: { not: null } },
      select: { id: true, externalId: true, approvedShopId: true },
    });
    const shopIds = new Map(candidates.filter((item): item is typeof item & { approvedShopId: string } => Boolean(item.approvedShopId)).map((item) => [item.externalId, { shopId: item.approvedShopId, candidateId: item.id }]));
    const unmatched = new Set<string>();
    const refreshedShops = new Set<string>();
    const skipped = { invalid: (snapshot.items || []).length - items.length, unmatched: 0 };
    let imported = 0;
    let active = 0;
    let stagedOffers = 0;

    for (let offset = 0; offset < items.length; offset += 100) {
      const batch = items.slice(offset, offset + 100);
      await prisma.$transaction(async (tx) => {
        for (const item of batch) {
          const externalShopId = shopExternalId(item.shopLink);
          const shopMapping = shopIds.get(externalShopId);
          if (!shopMapping) {
            unmatched.add(externalShopId);
            const candidate = await tx.shopCandidate.upsert({
              where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: externalShopId } },
              create: { dataSourceId: source.id, externalId: externalShopId, name: item.shop, directoryUrl: item.shopLink, homepageUrl: item.shopLink, logoUrl: item.shopLogoUrl, sourceSyncedAt: item.observedAt, lastSeenAt: item.observedAt, rawMetadata: { sourceSite: "ldxp", importedSource: "ldxp-shop-directory" } },
              update: { name: item.shop, directoryUrl: item.shopLink, homepageUrl: item.shopLink, logoUrl: item.shopLogoUrl || undefined, sourceSyncedAt: item.observedAt, lastSeenAt: item.observedAt, missingCount: 0 },
            });
            await tx.offerCandidate.upsert({
              where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: item.id } },
              create: { dataSourceId: source.id, externalId: item.id, shopCandidateId: candidate.id, externalProductId: item.id, productName: item.name, category: item.category, price: item.price, currency: "CNY", stock: item.stock, stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock", offerUrl: item.link, observedAt: item.observedAt, ingestionRunId: run.id, active: item.active, rawMetadata: { sourceSite: "ldxp" } },
              update: { shopCandidateId: candidate.id, productName: item.name, category: item.category, price: item.price, stock: item.stock, stockStatus: item.stock === 0 ? "out_of_stock" : "in_stock", offerUrl: item.link, observedAt: item.observedAt, ingestionRunId: run.id, active: item.active },
            });
            stagedOffers++;
            continue;
          }
          const { shopId, candidateId } = shopMapping;
          if (!refreshedShops.has(shopId)) {
            await tx.shop.update({ where: { id: shopId }, data: { logoUrl: item.shopLogoUrl || undefined, lastSyncedAt: new Date() } });
            await tx.shopCandidate.update({ where: { id: candidateId }, data: { logoUrl: item.shopLogoUrl || undefined, sourceSyncedAt: item.observedAt, lastSeenAt: item.observedAt } });
            refreshedShops.add(shopId);
          }
          const category = await tx.category.upsert({ where: { slug: `ldxp-${productFingerprint(item.category, "category").slice(0, 16)}` }, create: { slug: `ldxp-${productFingerprint(item.category, "category").slice(0, 16)}`, name: item.category }, update: { name: item.category } });
          const fingerprint = productFingerprint(item.name, item.category);
          const canonical = await tx.canonicalProduct.upsert({
            where: { fingerprint },
            create: { slug: `product-${fingerprint}`, title: item.name, normalizedTitle: normalizeTitle(item.name), summary: "", thumbnailUrl: item.thumbnailUrl, categoryId: category.id, fingerprint },
            update: { title: item.name, normalizedTitle: normalizeTitle(item.name), thumbnailUrl: item.thumbnailUrl || undefined, categoryId: category.id },
          });
          const sourceProduct = await tx.sourceProduct.upsert({
            where: { shopId_dataSourceId_sourceId: { shopId, dataSourceId: source.id, sourceId: item.id } },
            create: { shopId, dataSourceId: source.id, sourceId: item.id, canonicalProductId: canonical.id, title: item.name, normalizedTitle: normalizeTitle(item.name), description: "", thumbnailUrl: item.thumbnailUrl, categoryHint: item.category, externalUrl: item.link, confidence: 1 },
            update: { canonicalProductId: canonical.id, title: item.name, normalizedTitle: normalizeTitle(item.name), thumbnailUrl: item.thumbnailUrl || undefined, categoryHint: item.category, externalUrl: item.link, active: true, confidence: 1 },
          });
          const existing = await tx.offer.findUnique({ where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: item.id } } });
          const offer = await tx.offer.upsert({
            where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: item.id } },
            create: { shopId, sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, dataSourceId: source.id, externalId: item.id, collectionMode: CollectionMode.MANUAL, price: item.price, stock: item.stock, active: item.active, sourceUrl: item.link, sourceObservedAt: item.observedAt, syncedAt: new Date() },
            update: { sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, price: item.price, stock: item.stock, active: item.active, sourceUrl: item.link, sourceObservedAt: item.observedAt, syncedAt: new Date() },
          });
          if (!existing || !existing.price.equals(item.price) || existing.stock !== item.stock || existing.active !== item.active) {
            await tx.priceHistory.create({ data: { offerId: offer.id, price: item.price, stock: item.stock, capturedAt: item.observedAt } });
          }
          await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: offer.id, payload: { offerId: offer.id, productId: canonical.id } } });
          imported++;
          if (item.active) active++;
        }
      }, { timeout: 120_000 });
    }
    skipped.unmatched = unmatched.size;
    const finishedAt = new Date();
    await prisma.$transaction([
      prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, lastSnapshotId: checksum } }),
      prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, finishedAt, counts: { sourceItems: (snapshot.items || []).length, validItems: items.length, imported, active, stagedOffers, skipped, unmatchedShops: [...unmatched].slice(0, 100) } } }),
    ]);
    process.stdout.write(`${JSON.stringify({ runId: run.id, filePath, sourceItems: (snapshot.items || []).length, validItems: items.length, imported, active, stagedOffers, unmatchedShops: unmatched.size, checksum }, null, 2)}\n`);
  } catch (error) {
    if (runId) await prisma.ingestionRun.update({ where: { id: runId }, data: { status: SyncStatus.FAILED, errorCode: error instanceof Error ? error.name : "UnknownError", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined);
    await prisma.dataSource.updateMany({ where: { key: "ldxp" }, data: { lastCheckedAt: new Date() } }).catch(() => undefined);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`); process.exitCode = 1; });
