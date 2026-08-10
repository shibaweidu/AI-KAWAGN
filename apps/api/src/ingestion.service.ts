import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { CandidateReviewStatus, CollectionMode, DataSourceKind, ManagedListingType, Prisma, ShopStatus, SyncStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { authorizedShopSyncSchema, candidateDecisionSchema, importRowSchema, managedListingInputSchema, searchAdInputSchema, type ImportRow } from "@ai-card/contracts";
import { PriceAiFeedClient, TaokayouDirectoryClient, normalizeTitle, productFingerprint } from "@ai-card/crawler";
import { ObjectStoreService } from "./object-store.service";
import { PrismaService } from "./prisma.service";

const SOURCE_DEFINITIONS = [
  {
    key: "ldxp", name: "链动小店", kind: DataSourceKind.MANUAL_IMPORT,
    baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn",
    robotsUrl: null, termsUrl: null, pollIntervalSeconds: 6 * 60 * 60,
  },
] as const;

const DEFAULT_HOT_SEARCHES = ["plus", "team", "pro", "k12", "cursor", "codex", "Claude", "kiro", "gemini", "邮箱", "接码"];
const DISCOVERY_211B_ORIGIN = "https://211b.site";
let shop211bRequestGate = Promise.resolve();
let next211bRequestAt = 0;

type Discovered211bShop = {
  token: string;
  name: string;
  mirrorUrl: string;
  originalShopUrl: string;
  productCount: number | null;
  minPrice: number | null;
  logoUrl: string | null;
};

type HydrateTarget = { id: string; token: string; expectedProductCount?: number | null };
type LdxpBackfillCandidate = HydrateTarget & { rawMetadata: Prisma.JsonValue | null };
type LdxpProductItem = {
  externalId: string;
  productName: string;
  category: string;
  price: number;
  stock: number | null;
  stockStatus: string;
  offerUrl: string;
  imageUrl: string | null;
  goodsType: string;
  categoryId: number | null;
};

class SourceRateLimitError extends Error {
  constructor(message: string, readonly retryAfterAt: Date | null) {
    super(message);
    this.name = "SourceRateLimitError";
  }
}

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly priceAi = new PriceAiFeedClient();
  private readonly taokayou = new TaokayouDirectoryClient();
  constructor(private readonly prisma: PrismaService, private readonly objects: ObjectStoreService) {}
  async onModuleInit() { await this.ensureSources(); await this.ensureHotSearches(); }

  private async ensureHotSearches() {
    const count = await this.prisma.hotSearchTerm.count();
    if (count > 0) return;
    await this.prisma.hotSearchTerm.createMany({ data: DEFAULT_HOT_SEARCHES.map((term, position) => ({ term, position, active: true })) });
  }

  async listHotSearches() { await this.ensureHotSearches(); return this.prisma.hotSearchTerm.findMany({ orderBy: [{ position: "asc" }, { term: "asc" }] }); }

  async addHotSearch(input: unknown) {
    const body = input as { term?: unknown };
    const term = typeof body.term === "string" ? body.term.trim() : "";
    if (!term || term.length > 40) throw new BadRequestException("热门搜索词需为 1-40 个字符");
    const existing = await this.prisma.hotSearchTerm.findFirst({ where: { term: { equals: term, mode: "insensitive" } } });
    if (existing) return existing;
    const latest = await this.prisma.hotSearchTerm.aggregate({ _max: { position: true } });
    return this.prisma.hotSearchTerm.create({ data: { term, position: (latest._max.position ?? -1) + 1, active: true } });
  }

  async toggleHotSearch(id: string) {
    const item = await this.prisma.hotSearchTerm.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("热门搜索词不存在");
    return this.prisma.hotSearchTerm.update({ where: { id }, data: { active: !item.active } });
  }

  async reorderHotSearches(input: unknown) {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new BadRequestException("请选择有效的搜索词顺序");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.hotSearchTerm.update({ where: { id }, data: { position } })));
    return this.listHotSearches();
  }

  async listManagedListings(raw: Record<string, unknown> = {}) {
    const type = listingType(raw.type);
    return this.prisma.managedListing.findMany({
      where: { type },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
  }

  async addManagedListing(input: unknown) {
    const data = managedListingInputSchema.parse(input);
    const type = listingType(data.type);
    const latest = await this.prisma.managedListing.aggregate({ where: { type }, _max: { position: true } });
    return this.prisma.managedListing.create({
      data: {
        type, title: data.title, description: data.description, url: data.url,
        thumbnailUrl: data.thumbnailUrl, badge: data.badge,
        position: (latest._max.position ?? -1) + 1,
      },
    });
  }

  async toggleManagedListing(id: string) {
    const item = await this.prisma.managedListing.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("展示项不存在");
    return this.prisma.managedListing.update({ where: { id }, data: { active: !item.active } });
  }

  async reorderManagedListings(input: unknown) {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new BadRequestException("请选择有效的展示顺序");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.managedListing.update({ where: { id }, data: { position } })));
    return this.prisma.managedListing.findMany({ where: { id: { in: ids } }, orderBy: { position: "asc" } });
  }

  async listSearchAds() {
    return this.prisma.searchAd.findMany({ orderBy: [{ position: "asc" }, { createdAt: "desc" }] });
  }

  async addSearchAd(input: unknown) {
    const data = searchAdInputSchema.parse(input);
    const latest = await this.prisma.searchAd.aggregate({ _max: { position: true } });
    return this.prisma.searchAd.create({
      data: {
        title: data.title,
        description: data.description,
        url: data.url,
        imageUrl: data.imageUrl,
        label: data.label,
        keywords: data.keywords,
        global: data.global,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        active: data.active,
        position: (latest._max.position ?? -1) + 1,
      },
    });
  }

  async toggleSearchAd(id: string) {
    const item = await this.prisma.searchAd.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("搜索广告不存在");
    return this.prisma.searchAd.update({ where: { id }, data: { active: !item.active } });
  }

  async reorderSearchAds(input: unknown) {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new BadRequestException("请选择有效的广告顺序");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.searchAd.update({ where: { id }, data: { position } })));
    return this.listSearchAds();
  }

  async ensureSources() {
    for (const definition of SOURCE_DEFINITIONS) {
      await this.prisma.dataSource.upsert({
        where: { key: definition.key },
        create: { ...definition, enabled: false, robotsReviewedAt: new Date() },
        update: { name: definition.name, kind: definition.kind, baseUrl: definition.baseUrl, attributionUrl: definition.attributionUrl, robotsUrl: definition.robotsUrl, termsUrl: definition.termsUrl },
      });
    }
    const sources = await this.prisma.dataSource.findMany({ where: { key: "ldxp" }, orderBy: { name: "asc" } });
    return sources.map(sourceScheduleView);
  }

  async setSourceSchedule(key: string, input: unknown) {
    if (key !== "ldxp") throw new BadRequestException("仅支持设置链动小店采集计划");
    const { enabled, intervalMinutes } = parseLdxpSchedule(input);
    const source = await this.prisma.dataSource.update({
      where: { key },
      data: { enabled, pollIntervalSeconds: intervalMinutes * 60 },
    });
    return sourceScheduleView(source);
  }

  async requestSourceSync(key: string) {
    if (key !== "ldxp") throw new BadRequestException("仅支持同步链动小店数据");
    const source = await this.source(key);
    const existing = await this.prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: "ldxp-sync-request", status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { accepted: true, queued: existing.status === SyncStatus.QUEUED, runId: existing.id };
    const run = await this.prisma.ingestionRun.create({
      data: { dataSourceId: source.id, kind: "ldxp-sync-request", status: SyncStatus.QUEUED },
    });
    return { accepted: true, queued: true, runId: run.id };
  }

  async ldxpProductBackfillStatus(key: string) {
    if (key !== "ldxp") throw new BadRequestException("仅支持链动小店商品补全");
    const source = await this.source("ldxp");
    const candidates = await this.ldxpBackfillCandidates(source.id);
    const remainingShops = candidates.filter((candidate) => isLdxpProductSyncPending(candidate.rawMetadata)).length;
    const activeRun = await this.prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: "ldxp-product-backfill", status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      orderBy: { createdAt: "asc" },
    });
    return {
      totalShops: candidates.length,
      syncedShops: candidates.length - remainingShops,
      remainingShops,
      activeRun: activeRun ? { id: activeRun.id, status: activeRun.status, counts: activeRun.counts, createdAt: activeRun.createdAt } : null,
    };
  }

  async requestLdxpProductBackfill(key: string, input: unknown) {
    if (key !== "ldxp") throw new BadRequestException("仅支持链动小店商品补全");
    const { batchSize } = parseLdxpProductBackfillInput(input);
    const source = await this.source("ldxp");
    const existing = await this.prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: "ldxp-product-backfill", status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return { accepted: true, queued: existing.status === SyncStatus.QUEUED, runId: existing.id, existing: true };
    const status = await this.ldxpProductBackfillStatus(key);
    if (!status.remainingShops) return { accepted: true, queued: false, runId: null, existing: false, complete: true };
    const run = await this.prisma.ingestionRun.create({
      data: {
        dataSourceId: source.id,
        kind: "ldxp-product-backfill",
        status: SyncStatus.QUEUED,
        counts: {
          batchSize,
          totalAtStart: status.totalShops,
          remainingAtStart: status.remainingShops,
          processedShops: 0,
          succeededShops: 0,
          failedShops: 0,
          productsUpserted: 0,
          offersPromoted: 0,
          categoriesSynced: 0,
          pass: 1,
        },
      },
    });
    return { accepted: true, queued: true, runId: run.id, existing: false, remainingShops: status.remainingShops };
  }

  async processLdxpProductBackfill(runId: string) {
    const run = await this.prisma.ingestionRun.findUnique({ where: { id: runId }, include: { dataSource: true } });
    if (!run || run.kind !== "ldxp-product-backfill" || run.dataSource.key !== "ldxp") throw new NotFoundException("商品补全任务不存在");
    if (run.status === SyncStatus.SUCCEEDED || run.status === SyncStatus.FAILED) return { runId, status: run.status, counts: run.counts };
    const counts = isRecord(run.counts) ? run.counts : {};
    const batchSize = parseLdxpProductBackfillInput({ batchSize: counts.batchSize }).batchSize;
    const pass = Math.max(1, numberValue(counts.pass));
    const lastCandidateId = typeof counts.lastCandidateId === "string" ? counts.lastCandidateId : null;
    const candidates = await this.ldxpBackfillCandidates(run.dataSourceId);
    const pending = candidates.filter((candidate) => isLdxpProductSyncPending(candidate.rawMetadata));
    const available = pending.filter((candidate) => !lastCandidateId || candidate.id > lastCandidateId);
    const targets = available.slice(0, batchSize);

    if (!targets.length) {
      const retry = pending.length > 0 && pass < 3;
      const finalCounts = {
        ...counts,
        pass: retry ? pass + 1 : pass,
        lastCandidateId: retry ? null : counts.lastCandidateId,
        remainingShops: pending.length,
        ...(retry ? {} : { completedAt: new Date().toISOString() }),
      };
      const status = retry ? SyncStatus.QUEUED : SyncStatus.SUCCEEDED;
      await this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status, counts: finalCounts, finishedAt: retry ? null : new Date() } });
      return { runId, status, counts: finalCounts };
    }

    await this.prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: SyncStatus.RUNNING, startedAt: run.startedAt || new Date(), errorCode: null, errorMessage: null },
    });
    let result;
    try {
      result = await this.hydrateLdxpProductsForCandidates(run.dataSource, run.id, targets);
    } catch (error) {
      if (!(error instanceof SourceRateLimitError)) throw error;
      const remainingShops = (await this.ldxpBackfillCandidates(run.dataSourceId))
        .filter((candidate) => isLdxpProductSyncPending(candidate.rawMetadata)).length;
      const finalCounts = {
        ...counts,
        batchSize,
        pass,
        remainingShops,
        pausedAt: new Date().toISOString(),
        retryAfterAt: error.retryAfterAt?.toISOString() || null,
      };
      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.FAILED,
          counts: finalCounts,
          errorCode: error.name,
          errorMessage: error.message.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
      return { runId, status: SyncStatus.FAILED, counts: finalCounts };
    }
    const lastProcessed = targets[targets.length - 1].id;
    const remainingAfterBatch = (await this.ldxpBackfillCandidates(run.dataSourceId))
      .filter((candidate) => isLdxpProductSyncPending(candidate.rawMetadata)).length;
    const hasMoreInThisPass = candidates.some((candidate) => candidate.id > lastProcessed && isLdxpProductSyncPending(candidate.rawMetadata));
    const retry = !hasMoreInThisPass && remainingAfterBatch > 0 && pass < 3;
    const finalCounts = {
      ...counts,
      batchSize,
      pass: retry ? pass + 1 : pass,
      lastCandidateId: retry ? null : lastProcessed,
      processedShops: numberValue(counts.processedShops) + result.productShopsRequested,
      succeededShops: numberValue(counts.succeededShops) + result.productShopsSucceeded,
      failedShops: numberValue(counts.failedShops) + result.productShopsFailed,
      productsUpserted: numberValue(counts.productsUpserted) + result.productsUpserted,
      offersPromoted: numberValue(counts.offersPromoted) + result.offersPromoted,
      categoriesSynced: numberValue(counts.categoriesSynced) + result.categoriesSynced,
      remainingShops: remainingAfterBatch,
      failures: [...jsonFailures(counts.failures), ...result.failures].slice(-100),
    };
    const status = hasMoreInThisPass || retry ? SyncStatus.QUEUED : SyncStatus.SUCCEEDED;
    await this.prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status, counts: finalCounts, finishedAt: status === SyncStatus.SUCCEEDED ? new Date() : null },
    });
    return { runId, status, counts: finalCounts };
  }

  private async ldxpBackfillCandidates(dataSourceId: string): Promise<LdxpBackfillCandidate[]> {
    return this.prisma.shopCandidate.findMany({
      where: { dataSourceId, reviewStatus: { not: CandidateReviewStatus.REJECTED } },
      select: { id: true, externalId: true, rawMetadata: true },
      orderBy: { id: "asc" },
    }).then((candidates) => candidates
      .filter((candidate) => isLdxp211bCandidate(candidate.rawMetadata))
      .map((candidate) => ({
        id: candidate.id,
        token: candidate.externalId,
        expectedProductCount: metadataProductCount(candidate.rawMetadata),
        rawMetadata: candidate.rawMetadata,
      })));
  }

  async discoverLdxpFrom211b(key: string, input: unknown) {
    if (key !== "ldxp") throw new BadRequestException("仅支持发现链动小店目录");
    const { maxPages, syncProducts, maxProductShops } = parse211bDiscoveryInput(input);
    const source = await this.source("ldxp");
    const run = await this.startRun(source.id, "ldxp-211b-discovery");
    const observedAt = new Date();
    try {
      const pages: Array<{ page: number; url: string; html: string }> = [];
      const first = await fetch211bDirectoryPage(1);
      pages.push(first);
      const firstParsed = parse211bShopDirectory(first.html);
      const totalPages = Math.max(1, firstParsed.totalPages || 1);
      const pagesToFetch = Math.min(totalPages, maxPages);
      const discovered = new Map<string, Discovered211bShop>();
      const pageDuplicateKeys = new Set<string>();
      let caseVariantSkipped = 0;

      for (const shop of firstParsed.shops) addDiscovered211bShop(discovered, pageDuplicateKeys, shop);
      for (let page = 2; page <= pagesToFetch; page++) {
        const fetched = await fetch211bDirectoryPage(page);
        pages.push(fetched);
        for (const shop of parse211bShopDirectory(fetched.html).shops) addDiscovered211bShop(discovered, pageDuplicateKeys, shop);
      }

      const rawSnapshot = {
        discoverySource: "211b.site",
        observedAt: observedAt.toISOString(),
        requestedPages: pagesToFetch,
        totalPages,
        totalShops: firstParsed.totalShops,
        shops: [...discovered.values()],
      };
      const raw = JSON.stringify(rawSnapshot);
      const checksum = sha256(raw);
      const stamp = observedAt.toISOString().replace(/[:.]/g, "-");
      const rawSnapshotKey = await this.objects.put(`imports/ldxp-211b-discovery-${stamp}.json`, raw, "application/json; charset=utf-8");
      const existing = await this.prisma.shopCandidate.findMany({
        where: { dataSourceId: source.id },
        select: { id: true, externalId: true, name: true, logoUrl: true, rawMetadata: true },
      });
      const existingByExternalId = new Map(existing.map((candidate) => [candidate.externalId, candidate]));
      const existingByFoldedToken = new Map<string, typeof existing[number]>();
      for (const candidate of existing) existingByFoldedToken.set(candidate.externalId.toLowerCase(), candidate);

      const result = await this.prisma.$transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        const sampleCreated: Array<{ token: string; name: string }> = [];
        const hydrateTargets: HydrateTarget[] = [];

        for (const shop of discovered.values()) {
          const existingExact = existingByExternalId.get(shop.token);
          const caseVariant = existingByFoldedToken.get(shop.token.toLowerCase());
          if (!existingExact && caseVariant && candidateLooksLike211bDuplicate(caseVariant, shop)) {
            caseVariantSkipped += 1;
            continue;
          }
          const existingMetadata = isRecord(existingExact?.rawMetadata) ? existingExact.rawMetadata : {};
          const alreadyProductSynced = typeof existingMetadata.productSyncedAt === "string";
          const metadata = {
            ...existingMetadata,
            discoverySource: "211b.site",
            mirrorUrl: shop.mirrorUrl,
            originalShopUrl: shop.originalShopUrl,
            tokenFold: shop.token.toLowerCase(),
            directoryProductCount: shop.productCount,
            ...(!alreadyProductSynced ? { productCount: shop.productCount } : {}),
            minPrice: shop.minPrice,
            observedAt: observedAt.toISOString(),
          };
          const candidate = await tx.shopCandidate.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: shop.token } },
            create: {
              dataSourceId: source.id,
              externalId: shop.token,
              name: shop.name,
              directoryUrl: shop.originalShopUrl,
              homepageUrl: shop.originalShopUrl,
              logoUrl: shop.logoUrl,
              sourceSyncedAt: observedAt,
              lastSeenAt: observedAt,
              rawMetadata: metadata,
            },
            update: {
              name: shop.name,
              directoryUrl: shop.originalShopUrl,
              homepageUrl: shop.originalShopUrl,
              logoUrl: shop.logoUrl,
              sourceSyncedAt: observedAt,
              lastSeenAt: observedAt,
              missingCount: 0,
              rawMetadata: metadata,
            },
          });
          if (syncProducts && hydrateTargets.length < maxProductShops) hydrateTargets.push({ id: candidate.id, token: shop.token, expectedProductCount: shop.productCount });
          if (existingExact) {
            if (candidateChangedFrom211b(existingExact, shop)) updated += 1;
            else unchanged += 1;
          } else {
            created += 1;
            if (sampleCreated.length < 8) sampleCreated.push({ token: shop.token, name: shop.name });
          }
          await tx.importChange.create({
            data: {
              ingestionRunId: run.id,
              entityType: "SHOP_CANDIDATE",
              entityId: candidate.id,
              action: existingExact ? "UPDATE" : "CREATE",
              before: existingExact ? { name: existingExact.name, logoUrl: existingExact.logoUrl, rawMetadata: existingExact.rawMetadata } : Prisma.JsonNull,
              after: { name: shop.name, logoUrl: shop.logoUrl, rawMetadata: metadata },
            },
          });
          existingByExternalId.set(shop.token, candidate);
          existingByFoldedToken.set(shop.token.toLowerCase(), candidate);
        }

        const finishedAt = new Date();
        const counts = {
          pages: pagesToFetch,
          totalPages,
          totalShops: firstParsed.totalShops,
          shopsSeen: discovered.size + pageDuplicateKeys.size,
          uniqueShops: discovered.size,
          created,
          updated,
          unchanged,
          pageDuplicates: pageDuplicateKeys.size,
          caseVariantSkipped,
          productSyncRequested: syncProducts,
          productSyncLimit: maxProductShops,
        };
        await tx.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, lastSnapshotId: checksum } });
        await tx.ingestionRun.update({ where: { id: run.id }, data: { snapshotId: checksum, checksum, rawSnapshotKey, counts } });
        return { runId: run.id, rawSnapshotKey, sampleCreated, hydrateTargets, ...counts };
      }, { timeout: 120_000 });
      const productSync = syncProducts && result.hydrateTargets.length
        ? await this.hydrateLdxpProductsForCandidates(source, run.id, result.hydrateTargets)
        : { productShopsRequested: 0, productShopsSucceeded: 0, productShopsFailed: 0, productsUpserted: 0, offersPromoted: 0, categoriesSynced: 0, failures: [] as Array<{ token: string; error: string }> };
      const { hydrateTargets, ...publicResult } = result;
      const finalCounts = { ...publicResult, ...productSync };
      await this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, counts: finalCounts, finishedAt: new Date() } });
      return finalCounts;
    } catch (error) {
      await this.failRun(run.id, error);
      throw error;
    }
  }

  private async hydrateLdxpProductsForCandidates(source: { id: string; key: string; name: string }, runId: string, targets: HydrateTarget[]) {
    let productShopsSucceeded = 0;
    let productsUpserted = 0;
    let offersPromoted = 0;
    let categoriesSynced = 0;
    const failures: Array<{ token: string; error: string }> = [];

    for (const target of targets) {
      try {
        await this.markLdxpProductSyncState(target.id, "running");
        const snapshot = await fetch211bShopSnapshot(target.token, target.expectedProductCount);
        categoriesSynced += snapshot.categories.length;
        const result = await this.prisma.$transaction(async (tx) => {
          const candidate = await tx.shopCandidate.findUnique({
            where: { id: target.id },
            include: { dataSource: true },
          });
          if (!candidate) throw new NotFoundException("候选店铺不存在");
          const metadata = {
            ...(isRecord(candidate.rawMetadata) ? candidate.rawMetadata : {}),
            sourceSite: "ldxp",
            productSyncSource: "211b.site public shop page",
            directoryProductCount: metadataProductCount(candidate.rawMetadata),
            productCount: snapshot.items.length,
            stock: snapshot.stock,
            minPrice: snapshot.minPrice,
            maxPrice: snapshot.maxPrice,
            categories: snapshot.categories.map((category) => category.name),
            categoryStats: snapshot.categories,
            productSyncStatus: "completed",
            productSyncedAt: snapshot.observedAt.toISOString(),
          };
          await tx.shopCandidate.update({
            where: { id: candidate.id },
            data: {
              name: snapshot.name || candidate.name,
              logoUrl: snapshot.logoUrl || candidate.logoUrl,
              sourceSyncedAt: snapshot.observedAt,
              lastSeenAt: snapshot.observedAt,
              rawMetadata: metadata,
            },
          });

          const seenOfferIds: string[] = [];
          let upserted = 0;
          for (const item of snapshot.items) {
            seenOfferIds.push(item.externalId);
            await tx.offerCandidate.upsert({
              where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: item.externalId } },
              create: {
                dataSourceId: source.id,
                externalId: item.externalId,
                shopCandidateId: candidate.id,
                externalProductId: item.externalId,
                productName: item.productName,
                category: item.category,
                price: item.price,
                currency: "CNY",
                stock: item.stock,
                stockStatus: item.stockStatus,
                offerUrl: item.offerUrl,
                observedAt: snapshot.observedAt,
                ingestionRunId: runId,
                active: true,
                rawMetadata: { sourceSite: "ldxp", goodsType: item.goodsType, categoryId: item.categoryId, imageUrl: item.imageUrl },
              },
              update: {
                shopCandidateId: candidate.id,
                productName: item.productName,
                category: item.category,
                price: item.price,
                stock: item.stock,
                stockStatus: item.stockStatus,
                offerUrl: item.offerUrl,
                observedAt: snapshot.observedAt,
                ingestionRunId: runId,
                active: true,
                missingCount: 0,
                rawMetadata: { sourceSite: "ldxp", goodsType: item.goodsType, categoryId: item.categoryId, imageUrl: item.imageUrl },
              },
            });
            upserted += 1;
          }
          await tx.offerCandidate.updateMany({
            where: { shopCandidateId: candidate.id, active: true, externalId: { notIn: seenOfferIds } },
            data: { missingCount: { increment: 1 } },
          });
          await tx.offerCandidate.updateMany({ where: { shopCandidateId: candidate.id, missingCount: { gte: 2 } }, data: { active: false } });

          let promoted = 0;
          if (candidate.approvedShopId && (candidate.reviewStatus === CandidateReviewStatus.APPROVED || candidate.reviewStatus === CandidateReviewStatus.MERGED)) {
            const activeOffers = await tx.offerCandidate.findMany({ where: { shopCandidateId: candidate.id, active: true } });
            for (const offerCandidate of activeOffers) {
              await this.promoteOffer(tx, runId, candidate.approvedShopId, source, offerCandidate);
              promoted += 1;
            }
            await tx.shop.update({ where: { id: candidate.approvedShopId }, data: { lastSyncedAt: snapshot.observedAt } });
          }
          return { upserted, promoted };
        }, { timeout: 120_000 });
        productShopsSucceeded += 1;
        productsUpserted += result.upserted;
        offersPromoted += result.promoted;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.markLdxpProductSyncState(target.id, "failed", message).catch(() => undefined);
        failures.push({ token: target.token, error: message });
        if (error instanceof SourceRateLimitError) throw error;
      }
    }

    return {
      productShopsRequested: targets.length,
      productShopsSucceeded,
      productShopsFailed: failures.length,
      productsUpserted,
      offersPromoted,
      categoriesSynced,
      failures: failures.slice(0, 20),
    };
  }

  private async markLdxpProductSyncState(candidateId: string, status: "running" | "failed", error?: string) {
    const candidate = await this.prisma.shopCandidate.findUnique({ where: { id: candidateId }, select: { rawMetadata: true } });
    if (!candidate) return;
    const metadata = isRecord(candidate.rawMetadata) ? candidate.rawMetadata : {};
    await this.prisma.shopCandidate.update({
      where: { id: candidateId },
      data: {
        rawMetadata: {
          ...metadata,
          productSyncStatus: status,
          productSyncAttemptedAt: new Date().toISOString(),
          productSyncError: error ? error.slice(0, 1000) : null,
        },
      },
    });
  }

  async syncPriceAi() {
    const source = await this.source("priceai");
    const run = await this.startRun(source.id, "priceai-feed");
    try {
      const pointerResult = await this.priceAi.fetchPointer({ etag: source.etag, lastModified: source.lastModified });
      if (pointerResult.notModified || pointerResult.pointer?.snapshot_id === source.lastSnapshotId) {
        await this.prisma.$transaction([
          this.prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: new Date(), etag: pointerResult.etag || source.etag, lastModified: pointerResult.lastModified || source.lastModified } }),
          this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, counts: { noChange: true }, finishedAt: new Date() } }),
        ]);
        return { runId: run.id, noChange: true };
      }
      const pointer = pointerResult.pointer!;
      const { snapshot, raw } = await this.priceAi.fetchSnapshot(pointer);
      const checksum = sha256(raw);
      const rawSnapshotKey = await this.objects.put(`raw/priceai/${snapshot.snapshot_id}.json`, raw, "application/json");
      const seenOfferIds: string[] = [];
      const seenShopIds = new Set<string>();
      let skippedInsecureOffers = 0;

      for (const product of snapshot.products) {
        for (const offer of product.top_offers) {
          if (!offer.url.startsWith("https://")) {
            skippedInsecureOffers += 1;
            continue;
          }
          const externalShopId = offer.source_id || `name-${sha256(offer.source_name).slice(0, 16)}`;
          const name = offer.source_store_name || offer.source_name;
          const offerUrl = new URL(offer.url);
          const candidate = await this.prisma.shopCandidate.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: externalShopId } },
            create: {
              dataSourceId: source.id, externalId: externalShopId, name,
              directoryUrl: source.attributionUrl, homepageUrl: offerUrl.origin,
              lastSeenAt: new Date(), rawMetadata: { sourceName: offer.source_name },
            },
            update: { name, homepageUrl: offerUrl.origin, lastSeenAt: new Date(), missingCount: 0, rawMetadata: { sourceName: offer.source_name } },
          });
          seenShopIds.add(candidate.id);
          seenOfferIds.push(offer.id);
          await this.prisma.offerCandidate.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: offer.id } },
            create: {
              dataSourceId: source.id, externalId: offer.id, shopCandidateId: candidate.id,
              externalProductId: product.id, productName: product.name, specification: product.spec || product.product_type,
              category: product.platform || product.product_type, price: offer.price, currency: offer.currency.toUpperCase(),
              stock: normalizeFeedStatus(offer.status) === "out_of_stock" ? 0 : null, stockStatus: normalizeFeedStatus(offer.status), offerUrl: offer.url,
              observedAt: new Date(product.snapshot_generated_at), ingestionRunId: run.id,
              rawMetadata: { productSlug: product.slug, originalTitle: offer.title },
            },
            update: {
              shopCandidateId: candidate.id, productName: product.name, specification: product.spec || product.product_type,
              category: product.platform || product.product_type, price: offer.price, currency: offer.currency.toUpperCase(),
              stock: normalizeFeedStatus(offer.status) === "out_of_stock" ? 0 : null,
              stockStatus: normalizeFeedStatus(offer.status), offerUrl: offer.url, observedAt: new Date(product.snapshot_generated_at),
              ingestionRunId: run.id, active: true, missingCount: 0,
              rawMetadata: { productSlug: product.slug, originalTitle: offer.title },
            },
          });
        }
      }

      await this.prisma.offerCandidate.updateMany({
        where: { dataSourceId: source.id, externalId: { notIn: seenOfferIds }, active: true },
        data: { missingCount: { increment: 1 } },
      });
      await this.prisma.offerCandidate.updateMany({ where: { dataSourceId: source.id, missingCount: { gte: 2 } }, data: { active: false } });
      const counts = { products: snapshot.products.length, offers: seenOfferIds.length, shops: seenShopIds.size, skippedInsecureOffers, stale: snapshot.stale };
      await this.prisma.$transaction([
        this.prisma.dataSource.update({ where: { id: source.id }, data: { etag: pointerResult.etag, lastModified: pointerResult.lastModified, lastSnapshotId: snapshot.snapshot_id, lastCheckedAt: new Date(), lastSuccessAt: new Date() } }),
        this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, snapshotId: snapshot.snapshot_id, checksum, rawSnapshotKey, counts, finishedAt: new Date() } }),
      ]);
      return { runId: run.id, ...counts };
    } catch (error) {
      await this.failRun(run.id, error);
      throw error;
    }
  }

  async discoverTaokayou() {
    const source = await this.source("taokayou");
    const run = await this.startRun(source.id, "taokayou-sitemap");
    try {
      const result = await this.taokayou.fetchSitemap({ etag: source.etag, lastModified: source.lastModified });
      if (result.notModified) {
        await this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, counts: { noChange: true }, finishedAt: new Date() } });
        return { runId: run.id, noChange: true, newCandidateIds: [] as string[] };
      }
      const rawSnapshotKey = await this.objects.put(`raw/taokayou/sitemap-${Date.now()}.xml`, result.raw!, "application/xml");
      const existing = await this.prisma.shopCandidate.findMany({ where: { dataSourceId: source.id }, select: { id: true, externalId: true } });
      const existingIds = new Set(existing.map((candidate) => candidate.externalId));
      const seenIds = result.shops.map((shop) => shop.externalId);
      const newCandidateIds: string[] = [];
      for (const shop of result.shops) {
        const candidate = await this.prisma.shopCandidate.upsert({
          where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: shop.externalId } },
          create: {
            dataSourceId: source.id, externalId: shop.externalId, name: `淘卡优店铺 #${shop.externalId}`,
            directoryUrl: shop.directoryUrl, lastSeenAt: new Date(), rawMetadata: { sitemapLastModified: shop.lastModified },
          },
          update: { directoryUrl: shop.directoryUrl, lastSeenAt: new Date(), missingCount: 0, rawMetadata: { sitemapLastModified: shop.lastModified } },
        });
        if (!existingIds.has(shop.externalId)) newCandidateIds.push(candidate.id);
      }
      await this.prisma.shopCandidate.updateMany({
        where: { dataSourceId: source.id, externalId: { notIn: seenIds }, reviewStatus: CandidateReviewStatus.PENDING },
        data: { missingCount: { increment: 1 } },
      });
      await this.prisma.shopCandidate.updateMany({
        where: { dataSourceId: source.id, missingCount: { gte: 3 }, reviewStatus: CandidateReviewStatus.PENDING },
        data: { reviewStatus: CandidateReviewStatus.SOURCE_REMOVED },
      });
      const counts = { shops: result.shops.length, newShops: newCandidateIds.length };
      await this.prisma.$transaction([
        this.prisma.dataSource.update({ where: { id: source.id }, data: { etag: result.etag, lastModified: result.lastModified, lastCheckedAt: new Date(), lastSuccessAt: new Date() } }),
        this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, checksum: sha256(result.raw!), rawSnapshotKey, counts, finishedAt: new Date() } }),
      ]);
      return { runId: run.id, ...counts, newCandidateIds };
    } catch (error) {
      await this.failRun(run.id, error);
      throw error;
    }
  }

  async hydrateTaokayouCandidate(candidateId: string) {
    const candidate = await this.prisma.shopCandidate.findUnique({ where: { id: candidateId }, include: { dataSource: true } });
    if (!candidate || candidate.dataSource.key !== "taokayou") throw new NotFoundException("Taokayou candidate not found");
    const { metadata, raw } = await this.taokayou.fetchShop({ externalId: candidate.externalId, directoryUrl: candidate.directoryUrl, lastModified: null });
    const rawSnapshotKey = await this.objects.put(`raw/taokayou/shops/${candidate.externalId}-${Date.now()}.html`, raw, "text/html");
    return this.prisma.shopCandidate.update({
      where: { id: candidate.id },
      data: {
        name: metadata.name, logoUrl: metadata.logoUrl,
        sourceListedAt: metadata.sourceListedAt ? new Date(metadata.sourceListedAt) : null,
        sourceSyncedAt: metadata.sourceSyncedAt ? new Date(metadata.sourceSyncedAt) : null,
        rawMetadata: { rawSnapshotKey },
      },
    });
  }

  async persistAuthorizedShopSync(shopId: string, input: unknown) {
    const data = authorizedShopSyncSchema.parse(input);
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, status: ShopStatus.ACTIVE, publishedAt: { not: null } },
      include: { sourceMappings: true },
    });
    if (!shop) throw new NotFoundException("Published shop not found");
    if (!shop.verifiedAt && !shop.sourceMappings.some((mapping) => Boolean(mapping.authorizationEvidence))) {
      throw new BadRequestException("Authorized shop sync requires verified ownership or authorization evidence");
    }
    const approvedOrigin = new URL(shop.homepageUrl).origin;
    const products = Array.from(new Map(data.products.map((product) => [product.sourceId, product])).values());
    for (const product of products) {
      const productUrl = new URL(product.url);
      if (productUrl.origin !== approvedOrigin || productUrl.username || productUrl.password) {
        throw new BadRequestException("Offer URLs must use the approved shop HTTPS origin");
      }
    }

    const syncRun = await this.prisma.syncRun.create({ data: { shopId, status: SyncStatus.RUNNING, startedAt: new Date() } });
    try {
      const snapshotKey = await this.objects.put(
        `raw/authorized/${shopId}/${data.observedAt.toISOString().replace(/[:.]/g, "-")}.json`,
        JSON.stringify({ adapterKind: data.adapterKind, observedAt: data.observedAt, products }),
        "application/json",
      );
      const result = await this.prisma.$transaction(async (tx) => {
        const source = await tx.dataSource.upsert({
          where: { key: `authorized-${shop.id}` },
          create: {
            key: `authorized-${shop.id}`, name: `${shop.name} 授权直采`, kind: DataSourceKind.AUTHORIZED_SHOP,
            baseUrl: approvedOrigin, attributionUrl: approvedOrigin, enabled: true, pollIntervalSeconds: shop.syncIntervalMinutes * 60,
            robotsReviewedAt: new Date(), lastCheckedAt: new Date(), lastSuccessAt: new Date(),
          },
          update: {
            name: `${shop.name} 授权直采`, baseUrl: approvedOrigin, attributionUrl: approvedOrigin, enabled: true,
            pollIntervalSeconds: shop.syncIntervalMinutes * 60, lastCheckedAt: new Date(), lastSuccessAt: new Date(),
          },
        });
        await tx.shopSource.upsert({
          where: { shopId_dataSourceId: { shopId: shop.id, dataSourceId: source.id } },
          create: {
            shopId: shop.id, dataSourceId: source.id, externalId: shop.id, collectionMode: CollectionMode.AUTHORIZED_DIRECT,
            attributionLabel: `${shop.name} 授权直采`, authorizationEvidence: "inherited-from-approved-shop",
          },
          update: { collectionMode: CollectionMode.AUTHORIZED_DIRECT, attributionLabel: `${shop.name} 授权直采` },
        });

        const seenProductIds: string[] = [];
        const seenOfferIds: string[] = [];
        for (const product of products) {
          const categorySlug = slugPart(product.category) || `category-${sha256(product.category).slice(0, 8)}`;
          const category = await tx.category.upsert({ where: { slug: categorySlug }, create: { slug: categorySlug, name: product.category }, update: { name: product.category } });
          const fingerprint = productFingerprint(product.title, product.category);
          const canonical = await tx.canonicalProduct.upsert({
            where: { fingerprint },
            create: { slug: `product-${fingerprint}`, title: product.title, normalizedTitle: normalizeTitle(product.title), summary: product.description, categoryId: category.id, fingerprint },
            update: { title: product.title, summary: product.description, categoryId: category.id },
          });
          const sourceProduct = await tx.sourceProduct.upsert({
            where: { shopId_dataSourceId_sourceId: { shopId: shop.id, dataSourceId: source.id, sourceId: product.sourceId } },
            create: {
              shopId: shop.id, dataSourceId: source.id, sourceId: product.sourceId, canonicalProductId: canonical.id,
              title: product.title, normalizedTitle: normalizeTitle(product.title), description: product.description,
              categoryHint: product.category, externalUrl: product.url, rawSnapshotKey: snapshotKey, confidence: 1,
            },
            update: {
              canonicalProductId: canonical.id, title: product.title, normalizedTitle: normalizeTitle(product.title),
              description: product.description, categoryHint: product.category, externalUrl: product.url,
              rawSnapshotKey: snapshotKey, active: true,
            },
          });
          const existing = await tx.offer.findUnique({ where: { shopId_dataSourceId_externalId: { shopId: shop.id, dataSourceId: source.id, externalId: product.sourceId } } });
          const offer = await tx.offer.upsert({
            where: { shopId_dataSourceId_externalId: { shopId: shop.id, dataSourceId: source.id, externalId: product.sourceId } },
            create: {
              shopId: shop.id, sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, dataSourceId: source.id,
              externalId: product.sourceId, collectionMode: CollectionMode.AUTHORIZED_DIRECT, price: product.price,
              stock: product.stock, active: true, sourceUrl: product.url, sourceObservedAt: data.observedAt, syncedAt: new Date(),
            },
            update: {
              sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, price: product.price, stock: product.stock,
              active: true, sourceUrl: product.url, sourceObservedAt: data.observedAt, syncedAt: new Date(),
            },
          });
          if (!existing || !existing.price.equals(product.price) || existing.stock !== product.stock) {
            await tx.priceHistory.create({ data: { offerId: offer.id, price: product.price, stock: product.stock, capturedAt: data.observedAt } });
          }
          await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: offer.id, payload: { offerId: offer.id, productId: canonical.id } } });
          seenProductIds.push(sourceProduct.id);
          seenOfferIds.push(offer.id);
        }
        await tx.sourceProduct.updateMany({ where: { shopId: shop.id, dataSourceId: source.id, ...(seenProductIds.length ? { id: { notIn: seenProductIds } } : {}), active: true }, data: { active: false } });
        await tx.offer.updateMany({ where: { shopId: shop.id, dataSourceId: source.id, ...(seenOfferIds.length ? { id: { notIn: seenOfferIds } } : {}), active: true }, data: { active: false, syncedAt: new Date() } });
        await tx.shop.update({ where: { id: shop.id }, data: { adapterKind: data.adapterKind, lastSyncedAt: data.observedAt, failureCount: 0 } });
        return { count: products.length, deactivatedProducts: Math.max(0, await tx.sourceProduct.count({ where: { shopId: shop.id, dataSourceId: source.id, active: false } })) };
      });
      await this.prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: SyncStatus.SUCCEEDED, productCount: products.length, snapshotKey, finishedAt: new Date() } });
      return { syncRunId: syncRun.id, ...result };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.syncRun.update({ where: { id: syncRun.id }, data: { status: SyncStatus.FAILED, errorCode: error instanceof Error ? error.name : "UnknownError", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000), finishedAt: new Date() } });
        const failedShop = await tx.shop.update({ where: { id: shop.id }, data: { failureCount: { increment: 1 } } });
        if (failedShop.failureCount >= 3 && failedShop.status !== ShopStatus.PAUSED) {
          await tx.shop.update({ where: { id: shop.id }, data: { status: ShopStatus.PAUSED } });
          await tx.outboxEvent.create({ data: { topic: "shop.sync_paused", aggregateId: shop.id, payload: { shopId: shop.id, failureCount: failedShop.failureCount } } });
          const operators = await tx.user.findMany({ where: { role: { in: ["MODERATOR", "ADMIN"] } }, select: { id: true } });
          if (operators.length) await tx.notification.createMany({ data: operators.map((operator) => ({ userId: operator.id, type: "ingestion_alert", title: "授权店铺同步已暂停", body: `${shop.name} 连续同步失败，请检查适配器或来源状态。`, href: "/admin" })) });
        }
      });
      throw error;
    }
  }

  async previewImport(file: Express.Multer.File) {
    if (!file || file.size > 10 * 1024 * 1024) throw new BadRequestException("CSV/JSON file is required and must not exceed 10 MB");
    const format = file.originalname.toLowerCase().endsWith(".json") ? "json" : file.originalname.toLowerCase().endsWith(".csv") ? "csv" : null;
    if (!format) throw new BadRequestException("Only CSV and JSON files are accepted");
    const raw = file.buffer.toString("utf-8");
    const preview = parseImportRows(raw, format);
    if (preview.rows.some((row) => row.source !== "ldxp")) throw new BadRequestException("仅允许导入链动小店（ldxp）数据");
    const source = await this.source("ldxp");
    const run = await this.prisma.ingestionRun.create({
      data: {
        dataSourceId: source.id, kind: `ldxp-preview:${format}`, status: SyncStatus.QUEUED,
        checksum: sha256(raw), rawSnapshotKey: await this.objects.put(`previews/${randomUUID()}.${format}`, raw, file.mimetype || "text/plain"),
        counts: { format, total: preview.total, valid: preview.rows.length, invalid: preview.errors.length, errors: preview.errors.slice(0, 100) },
      },
    });
    return { token: run.id, expiresAt: new Date(run.createdAt.getTime() + 24 * 60 * 60_000).toISOString(), ...preview, rows: preview.rows.slice(0, 20) };
  }

  async stageImport(token: string) {
    const run = await this.prisma.ingestionRun.findUnique({ where: { id: token }, include: { dataSource: true } });
    if (!run || run.dataSource.key !== "ldxp" || !run.rawSnapshotKey || !run.kind.startsWith("ldxp-preview:")) throw new NotFoundException("Import preview not found");
    if (Date.now() - run.createdAt.getTime() > 24 * 60 * 60_000) throw new BadRequestException("Import preview has expired");
    const format = run.kind.endsWith(":json") ? "json" : "csv";
    const parsed = parseImportRows(await this.objects.getText(run.rawSnapshotKey), format);
    if (parsed.errors.length) throw new BadRequestException({ message: "Import contains invalid rows", errors: parsed.errors.slice(0, 100) });
    for (const row of parsed.rows) await this.stageManualRow(run.id, run.dataSourceId, row);
    await this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, startedAt: new Date(), finishedAt: new Date(), counts: { total: parsed.rows.length, staged: parsed.rows.length } } });
    return { runId: run.id, staged: parsed.rows.length };
  }

  async listCandidates(raw: Record<string, unknown>) {
    const page = Math.max(1, Number(raw.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(raw.pageSize) || 20));
    const status = typeof raw.status === "string" && raw.status.toUpperCase() in CandidateReviewStatus ? raw.status.toUpperCase() as CandidateReviewStatus : undefined;
    const sourceKey = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : undefined;
    const where: Prisma.ShopCandidateWhereInput = { reviewStatus: status, dataSource: sourceKey ? { key: sourceKey } : undefined };
    const [items, total, offerTotal] = await this.prisma.$transaction([
      this.prisma.shopCandidate.findMany({ where, include: { dataSource: true, _count: { select: { offerCandidates: true } } }, orderBy: [{ sourceListedAt: "desc" }, { firstSeenAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.shopCandidate.count({ where }),
      this.prisma.offerCandidate.count({ where: { active: true, shopCandidate: where } }),
    ]);
    return { items, total, offerTotal, page, pageSize, totalPages: total ? Math.ceil(total / pageSize) : 0 };
  }

  async decideCandidate(candidateId: string, input: unknown) {
    const decision = candidateDecisionSchema.parse(input);
    const candidate = await this.prisma.shopCandidate.findUnique({ where: { id: candidateId }, include: { dataSource: true, offerCandidates: { where: { active: true } } } });
    if (!candidate) throw new NotFoundException("Candidate not found");
    if (candidate.reviewStatus !== CandidateReviewStatus.PENDING) throw new BadRequestException("Only pending candidates can be reviewed");
    if (decision.action === "reject") return this.prisma.shopCandidate.update({ where: { id: candidate.id }, data: { reviewStatus: CandidateReviewStatus.REJECTED, reviewNote: decision.note } });
    if (candidate.dataSource.key === "taokayou" && (!decision.homepageUrl || !decision.authorizationEvidence)) {
      throw new BadRequestException("Taokayou candidates require an original HTTPS homepage and authorization evidence");
    }
    const requestedHomepageUrl = decision.homepageUrl || candidate.homepageUrl;
    if (!requestedHomepageUrl) throw new BadRequestException("An original HTTPS homepage is required");
    const homepageUrl = normalizeApprovedHomepageUrl(requestedHomepageUrl);
    const run = await this.startRun(candidate.dataSourceId, "candidate-approval");
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingShop = decision.action === "merge" ? await tx.shop.findUnique({ where: { id: decision.mergeShopId! } }) : null;
        if (decision.action === "merge" && !existingShop) throw new NotFoundException("Merge target shop not found");
        const shop = existingShop || await tx.shop.create({
          data: {
            slug: await uniqueShopSlug(tx, candidate.dataSource.key, candidate.externalId), name: candidate.name,
            description: "数据来自已审核的公开来源，交易与交付由原店负责。", logoUrl: candidate.logoUrl,
            homepageUrl, adapterKind: candidate.dataSource.key === "priceai" ? "priceai-feed" : "authorized-direct",
            status: ShopStatus.ACTIVE, verifiedAt: new Date(), publishedAt: new Date(), lastSyncedAt: candidate.sourceSyncedAt, trustScore: 50,
          },
        });
        if (existingShop) await tx.shop.update({ where: { id: shop.id }, data: { status: ShopStatus.ACTIVE, verifiedAt: shop.verifiedAt || new Date(), publishedAt: shop.publishedAt || new Date() } });
        await tx.shopSource.upsert({
          where: { dataSourceId_externalId: { dataSourceId: candidate.dataSourceId, externalId: candidate.externalId } },
          create: {
            shopId: shop.id, dataSourceId: candidate.dataSourceId, externalId: candidate.externalId,
            collectionMode: sourceCollectionMode(candidate.dataSource.key), attributionLabel: candidate.dataSource.name,
            authorizationEvidence: decision.authorizationEvidence,
          },
          update: { shopId: shop.id, authorizationEvidence: decision.authorizationEvidence },
        });
        await tx.importChange.create({ data: { ingestionRunId: run.id, entityType: "SHOP", entityId: shop.id, action: existingShop ? "UPDATE" : "CREATE", before: existingShop ? { status: existingShop.status, publishedAt: existingShop.publishedAt?.toISOString() || null } : Prisma.JsonNull, after: { status: "ACTIVE" } } });
        for (const offerCandidate of candidate.offerCandidates) await this.promoteOffer(tx, run.id, shop.id, candidate.dataSource, offerCandidate);
        await tx.importChange.create({
          data: {
            ingestionRunId: run.id,
            entityType: "CANDIDATE",
            entityId: candidate.id,
            action: "UPDATE",
            before: {
              reviewStatus: candidate.reviewStatus,
              approvedShopId: candidate.approvedShopId,
              reviewNote: candidate.reviewNote,
              homepageUrl: candidate.homepageUrl,
            },
            after: { reviewStatus: decision.action === "merge" ? "MERGED" : "APPROVED", approvedShopId: shop.id },
          },
        });
        await tx.shopCandidate.update({ where: { id: candidate.id }, data: { approvedShopId: shop.id, reviewStatus: decision.action === "merge" ? CandidateReviewStatus.MERGED : CandidateReviewStatus.APPROVED, reviewNote: decision.note, homepageUrl } });
        await tx.outboxEvent.create({ data: { topic: "shop.published", aggregateId: shop.id, payload: { shopId: shop.id } } });
        return shop;
      });
      await this.prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.SUCCEEDED, counts: { shops: 1, offers: candidate.offerCandidates.length }, finishedAt: new Date() } });
      return result;
    } catch (error) {
      await this.failRun(run.id, error);
      throw error;
    }
  }

  async decideCandidates(input: unknown) {
    const body = input as { ids?: unknown; action?: unknown; note?: unknown };
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || !body.ids.every((id) => typeof id === "string")) throw new BadRequestException("Select between 1 and 100 candidates");
    if (body.action !== "approve" && body.action !== "reject") throw new BadRequestException("Batch action must be approve or reject");
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of body.ids) {
      try {
        await this.decideCandidate(id, { action: body.action, note: typeof body.note === "string" ? body.note : undefined });
        results.push({ id, ok: true });
      } catch (error) { results.push({ id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
    return { results, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length };
  }

  async rollbackRun(runId: string) {
    const run = await this.prisma.ingestionRun.findUnique({ where: { id: runId }, include: { changes: { orderBy: { createdAt: "desc" } } } });
    if (!run || run.kind !== "candidate-approval") throw new NotFoundException("Rollbackable run not found");
    if (run.changes.some((change) => change.rolledBackAt)) throw new BadRequestException("Run has already been rolled back");
    await this.prisma.$transaction(async (tx) => {
      for (const change of run.changes) {
        const before = change.before ? change.before as Record<string, unknown> : null;
        if (change.entityType === "OFFER") {
          if (!before) await tx.offer.update({ where: { id: change.entityId }, data: { active: false } });
          else await tx.offer.update({ where: { id: change.entityId }, data: { price: Number(before.price), stock: before.stock === null ? null : Number(before.stock), active: Boolean(before.active), sourceObservedAt: new Date(String(before.sourceObservedAt)) } });
        }
        if (change.entityType === "SHOP") {
          await tx.shop.update({ where: { id: change.entityId }, data: before ? { status: before.status as ShopStatus, publishedAt: before.publishedAt ? new Date(String(before.publishedAt)) : null } : { status: ShopStatus.PENDING, publishedAt: null } });
          // Compatibility for approval runs created before candidate changes were audited.
          await tx.shopCandidate.updateMany({
            where: { approvedShopId: change.entityId, reviewStatus: { in: [CandidateReviewStatus.APPROVED, CandidateReviewStatus.MERGED] } },
            data: { approvedShopId: null, reviewStatus: CandidateReviewStatus.PENDING, reviewNote: null },
          });
        }
        if (change.entityType === "CANDIDATE" && before) {
          await tx.shopCandidate.update({
            where: { id: change.entityId },
            data: {
              reviewStatus: before.reviewStatus as CandidateReviewStatus,
              approvedShopId: typeof before.approvedShopId === "string" ? before.approvedShopId : null,
              reviewNote: typeof before.reviewNote === "string" ? before.reviewNote : null,
              homepageUrl: typeof before.homepageUrl === "string" ? before.homepageUrl : null,
            },
          });
        }
        await tx.importChange.update({ where: { id: change.id }, data: { rolledBackAt: new Date() } });
      }
      await tx.outboxEvent.create({ data: { topic: "ingestion.rolled_back", aggregateId: run.id, payload: { runId: run.id } } });
    });
    return { rolledBack: true };
  }

  async listRuns() { return this.prisma.ingestionRun.findMany({ include: { dataSource: true }, orderBy: { createdAt: "desc" }, take: 50 }); }

  private async source(key: string) {
    await this.ensureSources();
    const source = await this.prisma.dataSource.findUnique({ where: { key } });
    if (!source) throw new Error(`Data source ${key} is unavailable`);
    return source;
  }

  private startRun(dataSourceId: string, kind: string) {
    return this.prisma.ingestionRun.create({ data: { dataSourceId, kind, status: SyncStatus.RUNNING, startedAt: new Date() } });
  }

  private async failRun(id: string, error: unknown) {
    const run = await this.prisma.ingestionRun.update({ where: { id }, data: { status: SyncStatus.FAILED, errorCode: error instanceof Error ? error.name : "UnknownError", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000), finishedAt: new Date() }, include: { dataSource: true } });
    if (!run.dataSource.enabled || !["priceai-feed", "taokayou-sitemap"].includes(run.kind)) return;
    const recent = await this.prisma.ingestionRun.findMany({ where: { dataSourceId: run.dataSourceId, kind: run.kind }, orderBy: { createdAt: "desc" }, take: 3, select: { status: true } });
    if (recent.length < 3 || recent.some((item) => item.status !== SyncStatus.FAILED)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.dataSource.update({ where: { id: run.dataSourceId }, data: { enabled: false } });
      await tx.outboxEvent.create({ data: { topic: "source.sync_paused", aggregateId: run.dataSourceId, payload: { dataSourceId: run.dataSourceId, sourceKey: run.dataSource.key } } });
      const operators = await tx.user.findMany({ where: { role: { in: ["MODERATOR", "ADMIN"] } }, select: { id: true } });
      if (operators.length) await tx.notification.createMany({ data: operators.map((operator) => ({ userId: operator.id, type: "ingestion_alert", title: "外部数据源同步已暂停", body: `${run.dataSource.name} 连续同步失败，请检查来源状态后再启用。`, href: "/admin" })) });
    });
  }

  private async stageManualRow(runId: string, dataSourceId: string, row: ImportRow) {
    const externalShopId = `${row.source}:${row.externalShopId}`;
    const candidate = await this.prisma.shopCandidate.upsert({
      where: { dataSourceId_externalId: { dataSourceId, externalId: externalShopId } },
      create: { dataSourceId, externalId: externalShopId, name: row.shopName, directoryUrl: row.homepageUrl || "https://aikawang.local/manual-import", homepageUrl: row.homepageUrl, rawMetadata: { importedSource: row.source } },
      update: { name: row.shopName, homepageUrl: row.homepageUrl, lastSeenAt: new Date(), rawMetadata: { importedSource: row.source } },
    });
    await this.prisma.offerCandidate.upsert({
      where: { dataSourceId_externalId: { dataSourceId, externalId: `${row.source}:${row.externalOfferId}` } },
      create: {
        dataSourceId, externalId: `${row.source}:${row.externalOfferId}`, shopCandidateId: candidate.id,
        externalProductId: `${row.source}:${row.externalProductId}`, productName: row.productName, specification: row.specification,
        category: row.category, price: row.price, currency: row.currency.toUpperCase(), stock: row.stock ?? null,
        stockStatus: row.stock === 0 ? "out_of_stock" : "in_stock", offerUrl: row.offerUrl,
        observedAt: row.observedAt, ingestionRunId: runId, rawMetadata: { importedSource: row.source },
      },
      update: { price: row.price, stock: row.stock ?? null, stockStatus: row.stock === 0 ? "out_of_stock" : "in_stock", offerUrl: row.offerUrl, observedAt: row.observedAt, ingestionRunId: runId, active: true },
    });
  }

  private async promoteOffer(tx: Prisma.TransactionClient, runId: string, shopId: string, source: { id: string; key: string; name: string }, candidate: { id: string; externalId: string; externalProductId: string; productName: string; specification: string; category: string; price: Prisma.Decimal; currency: string; stock: number | null; offerUrl: string; observedAt: Date; rawMetadata?: Prisma.JsonValue | null }) {
    const categorySlug = slugPart(candidate.category) || `category-${sha256(candidate.category).slice(0, 8)}`;
    const category = await tx.category.upsert({ where: { slug: categorySlug }, create: { slug: categorySlug, name: candidate.category }, update: { name: candidate.category } });
    const fingerprint = productFingerprint(candidate.productName, candidate.category);
    const thumbnailUrl = safeHttpsUrl(typeof (isRecord(candidate.rawMetadata) ? candidate.rawMetadata.imageUrl : null) === "string" ? String((candidate.rawMetadata as Record<string, unknown>).imageUrl) : null);
    const canonical = await tx.canonicalProduct.upsert({
      where: { fingerprint },
      create: { slug: `product-${fingerprint}`, title: candidate.productName, normalizedTitle: normalizeTitle(candidate.productName), summary: candidate.specification, thumbnailUrl, categoryId: category.id, fingerprint },
      update: { title: candidate.productName, summary: candidate.specification, thumbnailUrl: thumbnailUrl || undefined, categoryId: category.id },
    });
    const sourceProduct = await tx.sourceProduct.upsert({
      where: { shopId_dataSourceId_sourceId: { shopId, dataSourceId: source.id, sourceId: candidate.externalProductId } },
      create: { shopId, dataSourceId: source.id, sourceId: candidate.externalProductId, canonicalProductId: canonical.id, title: candidate.productName, normalizedTitle: normalizeTitle(candidate.productName), description: candidate.specification, thumbnailUrl, categoryHint: candidate.category, externalUrl: candidate.offerUrl, confidence: 1 },
      update: { canonicalProductId: canonical.id, title: candidate.productName, normalizedTitle: normalizeTitle(candidate.productName), description: candidate.specification, thumbnailUrl: thumbnailUrl || undefined, categoryHint: candidate.category, externalUrl: candidate.offerUrl, active: true },
    });
    const existing = await tx.offer.findUnique({ where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: candidate.externalId } } });
    const offer = await tx.offer.upsert({
      where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: candidate.externalId } },
      create: { shopId, sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, dataSourceId: source.id, externalId: candidate.externalId, collectionMode: sourceCollectionMode(source.key), price: candidate.price, stock: candidate.stock, currency: candidate.currency, active: true, sourceUrl: candidate.offerUrl, sourceObservedAt: candidate.observedAt, syncedAt: new Date() },
      update: { sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, price: candidate.price, stock: candidate.stock, currency: candidate.currency, active: true, sourceUrl: candidate.offerUrl, sourceObservedAt: candidate.observedAt, syncedAt: new Date() },
    });
    if (!existing || !existing.price.equals(candidate.price) || existing.stock !== candidate.stock) await tx.priceHistory.create({ data: { offerId: offer.id, price: candidate.price, stock: candidate.stock, capturedAt: candidate.observedAt } });
    await tx.importChange.create({ data: { ingestionRunId: runId, entityType: "OFFER", entityId: offer.id, action: existing ? "UPDATE" : "CREATE", before: existing ? { price: existing.price.toNumber(), stock: existing.stock, active: existing.active, sourceObservedAt: existing.sourceObservedAt.toISOString() } : Prisma.JsonNull, after: { price: candidate.price.toNumber(), stock: candidate.stock, active: true } } });
    await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: offer.id, payload: { offerId: offer.id, productId: canonical.id } } });
  }
}

export function parseImportRows(raw: string, format: "csv" | "json") {
  let values: unknown[];
  try {
    const parsed = format === "json" ? JSON.parse(raw) : parseCsv(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    values = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { rows?: unknown[] })?.rows) ? (parsed as { rows: unknown[] }).rows : [];
  } catch (error) { throw new BadRequestException(`Unable to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : error}`); }
  if (!values.length) throw new BadRequestException("Import file contains no rows");
  if (values.length > 10_000) throw new BadRequestException("Import file exceeds 10,000 rows");
  const rows: ImportRow[] = [];
  const errors: Array<{ row: number; issues: string[] }> = [];
  values.forEach((value, index) => {
    const parsed = importRowSchema.safeParse(value);
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ row: index + 2, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
  });
  return { total: values.length, valid: rows.length, invalid: errors.length, rows, errors };
}

export function normalizeApprovedHomepageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new BadRequestException("Only credential-free HTTPS homepages are accepted");
  url.hash = "";
  return url.href;
}

export function parseLdxpSchedule(input: unknown) {
  const body = input as { enabled?: unknown; intervalMinutes?: unknown };
  const enabled = body?.enabled;
  const intervalMinutes = Number(body?.intervalMinutes);
  if (typeof enabled !== "boolean") throw new BadRequestException("enabled 必须为布尔值");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440) {
    throw new BadRequestException("采集间隔必须为 30-1440 分钟的整数");
  }
  return { enabled, intervalMinutes };
}

export function parseLdxpProductBackfillInput(input: unknown) {
  const rawBatchSize = (input as { batchSize?: unknown })?.batchSize;
  const batchSize = rawBatchSize === undefined || rawBatchSize === "" ? 25 : Number(rawBatchSize);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new BadRequestException("每批店铺数必须为 1-100 家的整数");
  }
  return { batchSize };
}

export function isLdxpProductSyncPending(metadata: Prisma.JsonValue | null) {
  return typeof (isRecord(metadata) ? metadata.productSyncedAt : null) !== "string";
}

export function isLdxp211bCandidate(metadata: Prisma.JsonValue | null) {
  return isRecord(metadata) && metadata.discoverySource === "211b.site";
}

export function parse211bDiscoveryInput(input: unknown) {
  const body = input as { maxPages?: unknown; syncProducts?: unknown; maxProductShops?: unknown };
  const rawMaxPages = body?.maxPages === undefined || body.maxPages === "" ? 20 : Number(body.maxPages);
  if (!Number.isInteger(rawMaxPages) || rawMaxPages < 1 || rawMaxPages > 50) {
    throw new BadRequestException("扫描页数必须为 1-50 页的整数");
  }
  const syncProducts = body?.syncProducts !== false;
  const rawMaxProductShops = body?.maxProductShops === undefined || body.maxProductShops === "" ? 5 : Number(body.maxProductShops);
  if (!Number.isInteger(rawMaxProductShops) || rawMaxProductShops < 0 || rawMaxProductShops > 200) {
    throw new BadRequestException("同步商品店铺数必须为 0-200 家的整数");
  }
  return { maxPages: rawMaxPages, syncProducts, maxProductShops: rawMaxProductShops };
}

export function parse211bShopDirectory(html: string) {
  const totalPages = Number(/第\s*\d+\s*\/\s*(\d+)\s*页/.exec(html)?.[1] || 1);
  const totalShops = Number(/<span>\s*([\d,]+)\s*家\s*<\/span>/.exec(html)?.[1]?.replace(/,/g, "") || 0);
  const shops: Discovered211bShop[] = [];
  const cardPattern = /<a\s+class="directory-card"\s+href="\/shops\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html))) {
    const token = decodeHtml(match[1]).trim();
    const body = match[2];
    if (!isSafeLdxpToken(token)) continue;
    const title = textFromFirstTag(body, "h2");
    const visibleToken = textFromFirstTag(body, "p");
    if (visibleToken && visibleToken !== token) continue;
    const imageMatch = /<img\s+[^>]*src="([^"]+)"[^>]*>/i.exec(body);
    const logoUrl = safeHttpsUrl(imageMatch?.[1] || null);
    const productCountText = /<strong>\s*([\d,]+)\s*<\/strong>\s*<span>\s*在售商品\s*<\/span>/i.exec(body)?.[1];
    const minPriceText = /<strong>\s*¥\s*([\d,.]+)\s*<\/strong>\s*<span>\s*店内起价\s*<\/span>/i.exec(body)?.[1];
    shops.push({
      token,
      name: title || token,
      mirrorUrl: `${DISCOVERY_211B_ORIGIN}/shops/${encodeURIComponent(token)}`,
      originalShopUrl: `https://pay.ldxp.cn/shop/${encodeURIComponent(token)}`,
      productCount: productCountText ? Number(productCountText.replace(/,/g, "")) : null,
      minPrice: minPriceText ? Number(minPriceText.replace(/,/g, "")) : null,
      logoUrl,
    });
  }
  return { shops, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1, totalShops };
}

async function fetch211bDirectoryPage(page: number) {
  const url = new URL("/shops", DISCOVERY_211B_ORIGIN);
  url.searchParams.set("q", "");
  if (page > 1) url.searchParams.set("page", String(page));
  await waitFor211bRequestSlot();
  const response = await fetch(url, {
    redirect: "error",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": process.env.CRAWLER_USER_AGENT || "AIKawangBot/0.1 (public LDXP shop discovery; contact site admin)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  assert211bResponseAllowed(response, `211b 店铺目录第 ${page} 页`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("text/html")) throw new Error(`211b 店铺目录返回了非 HTML 内容: ${contentType}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("211b 店铺目录单页超过 4 MB，已停止扫描");
  return { page, url: url.href, html: new TextDecoder().decode(bytes) };
}

async function fetch211bShopSnapshot(token: string, expectedProductCount?: number | null) {
  if (!isSafeLdxpToken(token)) throw new Error("LDXP token 不合法");
  const observedAt = new Date();
  const firstHtml = await fetch211bShopProductPage(token, 1);
  const first = parse211bShopProducts(firstHtml, token);
  const pagesToFetch = Math.min(100, first.totalPages);
  if ((expectedProductCount || 0) > 0 && first.items.length === 0 && first.categories.length === 0) {
    throw new Error(`211b 店铺 ${token} 页面未解析到商品结构，未写入完成标记`);
  }
  const itemsById = new Map(first.items.map((item) => [item.externalId, item]));
  const categories = new Map(first.categories.map((category) => [category.name, category]));

  for (let page = 2; page <= pagesToFetch; page++) {
    const parsed = parse211bShopProducts(await fetch211bShopProductPage(token, page), token);
    for (const item of parsed.items) itemsById.set(item.externalId, item);
    for (const category of parsed.categories) {
      const existing = categories.get(category.name);
      categories.set(category.name, { id: null, name: category.name, goodsCount: Math.max(existing?.goodsCount || 0, category.goodsCount) });
    }
  }

  const items = [...itemsById.values()];
  const prices = items.map((item) => item.price);
  return {
    observedAt,
    name: first.name || token,
    logoUrl: first.logoUrl,
    items,
    categories: [...categories.values()].sort((a, b) => b.goodsCount - a.goodsCount || a.name.localeCompare(b.name, "zh-CN")),
    stock: items.reduce((sum, item) => sum + (item.stock || 0), 0),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
  };
}

async function fetch211bShopProductPage(token: string, page: number) {
  const url = new URL(`/shops/${encodeURIComponent(token)}`, DISCOVERY_211B_ORIGIN);
  if (page > 1) url.searchParams.set("page", String(page));
  await waitFor211bRequestSlot();
  const response = await fetch(url, {
    redirect: "error",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": process.env.CRAWLER_USER_AGENT || "AIKawangBot/0.1 (public 211b product backfill; contact site admin)",
    },
    signal: AbortSignal.timeout(25_000),
  });
  assert211bResponseAllowed(response, `211b 店铺 ${token} 第 ${page} 页`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("text/html")) throw new Error(`211b 店铺页返回了非 HTML 内容: ${contentType}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("211b 店铺商品页超过 4 MB，已停止采集");
  return new TextDecoder().decode(bytes);
}

async function waitFor211bRequestSlot() {
  const previous = shop211bRequestGate;
  let release!: () => void;
  shop211bRequestGate = new Promise((resolveGate) => { release = resolveGate; });
  await previous;
  const wait = Math.max(0, next211bRequestAt - Date.now());
  if (wait) await sleep(wait);
  next211bRequestAt = Date.now() + sourceRequestDelayMs();
  release();
}

function sourceRequestDelayMs() {
  const value = Number(process.env.SOURCE_211B_REQUEST_DELAY_MS || 3_000);
  return Number.isFinite(value) ? Math.min(60_000, Math.max(1_000, Math.round(value))) : 3_000;
}

function assert211bResponseAllowed(response: Response, label: string) {
  if (response.ok) return;
  if (response.status === 429 || response.status === 403) {
    const retryAfterAt = parseRetryAfter(response.headers.get("retry-after"));
    const retryHint = retryAfterAt ? `，建议 ${retryAfterAt.toISOString()} 后重试` : "，请等待 IP 限流解除后手动重试";
    throw new SourceRateLimitError(`${label}返回 HTTP ${response.status}${retryHint}`, retryAfterAt);
  }
  throw new Error(`${label}返回 HTTP ${response.status}`);
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function parse211bShopProducts(html: string, token: string) {
  if (!isSafeLdxpToken(token)) throw new Error("LDXP token 不合法");
  const name = textFromFirstTag(/<div class="shop-profile">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] || html, "h1") || token;
  const profile = /<div class="shop-profile">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] || "";
  const logoUrl = safeHttpsUrl(/<img\s+[^>]*src="([^"]+)"[^>]*>/i.exec(profile)?.[1] || null);
  const totalPages = Math.max(1, Number(/第\s*\d+\s*\/\s*(\d+)\s*页/.exec(html)?.[1] || 1));
  const items: LdxpProductItem[] = [];
  const categories: Array<{ id: null; name: string; goodsCount: number }> = [];
  const categoryPattern = /<div class="category-block">([\s\S]*?)(?=<div class="category-block">|<nav class="pagination"|<\/section>)/g;
  let categoryMatch: RegExpExecArray | null;
  while ((categoryMatch = categoryPattern.exec(html))) {
    const categoryBody = categoryMatch[1];
    const category = textFromFirstTag(categoryBody, "h2") || "其他";
    const declaredCount = Number(/<span>\s*([\d,]+)\s*件商品\s*<\/span>/.exec(categoryBody)?.[1]?.replace(/,/g, "") || 0);
    let parsedCount = 0;
    const productPattern = /<article class="product-card">([\s\S]*?)<\/article>/g;
    let productMatch: RegExpExecArray | null;
    while ((productMatch = productPattern.exec(categoryBody))) {
      const productBody = productMatch[1];
      const offerUrl = safeHttpsUrl(/href="(https:\/\/pay\.ldxp\.cn\/item\/[^"]+)"/i.exec(productBody)?.[1] || null);
      if (!offerUrl) continue;
      const key = decodeURIComponent(new URL(offerUrl).pathname.replace(/^\/item\//, "").replace(/\/$/, ""));
      const title = stripHtml(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i.exec(productBody)?.[1] || "");
      const price = Number(/<div class="product-footer">[\s\S]*?<strong>\s*<small>\s*¥\s*<\/small>\s*([\d,.]+)/i.exec(productBody)?.[1]?.replace(/,/g, ""));
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(key) || !title || !Number.isFinite(price) || price < 0 || price > 1_000_000) continue;
      const stockText = stripHtml(/<span class="stock[^"]*">([\s\S]*?)<\/span>/i.exec(productBody)?.[1] || "");
      const stockMatch = /库存\s*([\d,]+)/.exec(stockText);
      const stock = stockMatch ? Number(stockMatch[1].replace(/,/g, "")) : /缺货/.test(stockText) ? 0 : null;
      items.push({
        externalId: `ldxp:${key}`,
        productName: title,
        category,
        price,
        stock,
        stockStatus: stock === 0 ? "out_of_stock" : "in_stock",
        offerUrl,
        imageUrl: safeHttpsUrl(/<img\s+[^>]*src="([^"]+)"[^>]*>/i.exec(productBody)?.[1] || null),
        goodsType: "211b-mirror",
        categoryId: null,
      });
      parsedCount += 1;
    }
    categories.push({ id: null, name: category, goodsCount: declaredCount || parsedCount });
  }
  return { name, logoUrl, totalPages, items, categories };
}

function addDiscovered211bShop(target: Map<string, Discovered211bShop>, duplicates: Set<string>, shop: Discovered211bShop) {
  const foldedToken = shop.token.toLowerCase();
  const existing = [...target.values()].find((item) => item.token.toLowerCase() === foldedToken);
  if (existing && same211bShopSignature(existing, shop)) {
    duplicates.add(shop.token);
    return;
  }
  target.set(shop.token, shop);
}

function candidateLooksLike211bDuplicate(candidate: { name: string; logoUrl: string | null; rawMetadata: Prisma.JsonValue | null }, shop: Discovered211bShop) {
  const metadata = isRecord(candidate.rawMetadata) ? candidate.rawMetadata : {};
  const productCountValue = metadata.directoryProductCount ?? metadata.productCount;
  const productCount = typeof productCountValue === "number" ? productCountValue : null;
  const minPrice = typeof metadata.minPrice === "number" ? metadata.minPrice : null;
  return normalizedText(candidate.name) === normalizedText(shop.name)
    && (candidate.logoUrl || null) === (shop.logoUrl || null)
    && productCount === shop.productCount
    && minPrice === shop.minPrice;
}

function candidateChangedFrom211b(candidate: { name: string; logoUrl: string | null; rawMetadata: Prisma.JsonValue | null }, shop: Discovered211bShop) {
  return !candidateLooksLike211bDuplicate(candidate, shop);
}

function same211bShopSignature(left: Discovered211bShop, right: Discovered211bShop) {
  return normalizedText(left.name) === normalizedText(right.name)
    && (left.logoUrl || null) === (right.logoUrl || null)
    && left.productCount === right.productCount
    && left.minPrice === right.minPrice;
}

function textFromFirstTag(html: string, tag: string) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return match ? stripHtml(match[1]) : "";
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeHttpsUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isSafeLdxpToken(value: string) { return /^[A-Za-z0-9._-]{1,100}$/.test(value); }
function normalizedText(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function metadataProductCount(metadata: Prisma.JsonValue | null) {
  if (!isRecord(metadata)) return null;
  const value = Number(metadata.directoryProductCount ?? metadata.productCount);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
function numberValue(value: unknown) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function jsonFailures(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ token: string; error: string }>;
  return value.flatMap((item) => isRecord(item) && typeof item.token === "string" && typeof item.error === "string" ? [{ token: item.token, error: item.error }] : []);
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function uniqueShopSlug(tx: Prisma.TransactionClient, sourceKey: string, externalId: string) {
  const base = `${slugPart(sourceKey)}-${slugPart(externalId) || sha256(externalId).slice(0, 10)}`;
  let slug = base;
  let suffix = 1;
  while (await tx.shop.findUnique({ where: { slug } })) slug = `${base}-${suffix++}`;
  return slug;
}

function slugPart(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function sourceScheduleView<T extends { enabled: boolean; pollIntervalSeconds: number; lastCheckedAt: Date | null }>(source: T) {
  const nextRunAt = source.enabled
    ? new Date((source.lastCheckedAt?.getTime() || Date.now()) + source.pollIntervalSeconds * 1000)
    : null;
  return { ...source, nextRunAt };
}
function normalizeFeedStatus(status: string) { return /out|sold|unavailable/i.test(status) ? "out_of_stock" : /low/i.test(status) ? "low_stock" : "in_stock"; }
function sourceCollectionMode(sourceKey: string) { return sourceKey === "priceai" ? CollectionMode.PUBLIC_FEED : sourceKey === "taokayou" ? CollectionMode.AUTHORIZED_DIRECT : CollectionMode.MANUAL; }
function listingType(value: unknown) {
  if (value === "gateway" || value === ManagedListingType.GATEWAY) return ManagedListingType.GATEWAY;
  if (value === "project" || value === ManagedListingType.PROJECT) return ManagedListingType.PROJECT;
  throw new BadRequestException("展示类型必须是 gateway 或 project");
}
