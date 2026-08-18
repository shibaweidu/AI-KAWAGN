import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { CandidateReviewStatus, CollectionMode, DataSourceKind, ManagedListingType, Prisma, ShopStatus, SideAdSlot, SyncStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { ZodError } from "zod";
import { announcementSegmentSchema, authorizedShopSyncSchema, candidateDecisionSchema, importRowSchema, managedListingInputSchema, searchAdInputSchema, type AnnouncementSegment, type ImportRow } from "@ai-card/contracts";
import { CardnavCatalogClient, TaokayouDirectoryClient, normalizeTitle, productFingerprint, type PublicCatalogOffer, type PublicCatalogShop } from "@ai-card/crawler";
import { ObjectStoreService } from "./object-store.service";
import { PrismaService } from "./prisma.service";

const DISCOVERY_211B_ORIGIN = normalize211bOrigin(process.env.SOURCE_211B_ORIGIN);
const SOURCE_DEFINITIONS = [
  {
    key: "ldxp", name: "链动小店", kind: DataSourceKind.PUBLIC_DIRECTORY,
    baseUrl: "https://pay.ldxp.cn", attributionUrl: `${DISCOVERY_211B_ORIGIN}/shops`,
    robotsUrl: null, termsUrl: null, pollIntervalSeconds: 6 * 60 * 60,
  },
  {
    key: "cardnav", name: "Cardnav 卡网大全", kind: DataSourceKind.PUBLIC_FEED,
    baseUrl: "https://cardnav.xyz", attributionUrl: "https://cardnav.xyz/shops",
    robotsUrl: "https://cardnav.xyz/robots.txt", termsUrl: null, pollIntervalSeconds: 6 * 60 * 60,
  },
] as const;
const SUPPORTED_SCHEDULE_SOURCE_KEYS = new Set<string>(SOURCE_DEFINITIONS.map((definition) => definition.key));

const DEFAULT_HOT_SEARCHES = ["plus", "team", "pro", "k12", "cursor", "codex", "Claude", "kiro", "gemini", "邮箱", "接码"];
const LDXP_MISSING_CONFIRMATIONS = 2;
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
  private readonly cardnav = new CardnavCatalogClient();
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
    const items = await this.prisma.managedListing.findMany({
      where: { type },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    return items.map((item) => this.toManagedListing(item));
  }

  async addManagedListing(input: unknown, thumbnail?: Express.Multer.File) {
    const data = parseManagedListingInput(input);
    const type = listingType(data.type);
    const placement = await this.validateManagedListingPlacement(type, data);
    const latest = await this.prisma.managedListing.aggregate({ where: { type }, _max: { position: true } });
    const thumbnailObjectKey = thumbnail ? await this.storeManagedListingImage(thumbnail) : null;
    try {
      const item = await this.prisma.managedListing.create({
        data: {
          type, title: data.title, description: data.description, url: data.url,
          thumbnailUrl: thumbnailObjectKey ? null : data.thumbnailUrl, thumbnailObjectKey, badge: data.badge,
          modelTags: data.modelTags, pricingClaims: data.pricingClaims || null,
          gatewayPlacement: placement.gatewayPlacement,
          homeSideSlot: placement.homeSideSlot,
          homeBottomPlacement: placement.homeBottomPlacement,
          position: (latest._max.position ?? -1) + 1,
        },
      });
      return this.toManagedListing(item);
    } catch (error) {
      if (thumbnailObjectKey) await this.objects.remove(thumbnailObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async updateManagedListing(id: string, input: unknown, thumbnail?: Express.Multer.File) {
    const current = await this.prisma.managedListing.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("展示项不存在");
    const data = parseManagedListingInput(input);
    if (listingType(data.type) !== current.type) throw new BadRequestException("展示类型不能修改");
    const placement = await this.validateManagedListingPlacement(current.type, data, id);

    let thumbnailUrl = current.thumbnailUrl;
    let thumbnailObjectKey = current.thumbnailObjectKey;
    let uploadedObjectKey: string | null = null;
    if (thumbnail) {
      uploadedObjectKey = await this.storeManagedListingImage(thumbnail);
      thumbnailObjectKey = uploadedObjectKey;
      thumbnailUrl = null;
    } else if (data.clearThumbnail) {
      thumbnailObjectKey = null;
      thumbnailUrl = null;
    } else if (data.thumbnailUrl) {
      thumbnailObjectKey = null;
      thumbnailUrl = data.thumbnailUrl;
    }

    let item;
    try {
      item = await this.prisma.managedListing.update({
        where: { id },
        data: {
          title: data.title, description: data.description, url: data.url, badge: data.badge,
          modelTags: data.modelTags, pricingClaims: data.pricingClaims || null, thumbnailUrl, thumbnailObjectKey,
          gatewayPlacement: placement.gatewayPlacement,
          homeSideSlot: placement.homeSideSlot,
          homeBottomPlacement: placement.homeBottomPlacement,
        },
      });
    } catch (error) {
      if (uploadedObjectKey) await this.objects.remove(uploadedObjectKey).catch(() => undefined);
      throw error;
    }
    if (current.thumbnailObjectKey && current.thumbnailObjectKey !== thumbnailObjectKey) {
      await this.objects.remove(current.thumbnailObjectKey).catch(() => undefined);
    }
    return this.toManagedListing(item);
  }

  async toggleManagedListing(id: string) {
    const item = await this.prisma.managedListing.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("展示项不存在");
    if (!item.active && item.homeSideSlot) {
      await this.ensureHomeSideSlotAvailable(item.homeSideSlot, id);
    }
    return this.toManagedListing(await this.prisma.managedListing.update({ where: { id }, data: { active: !item.active } }));
  }

  async reorderManagedListings(input: unknown) {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new BadRequestException("请选择有效的展示顺序");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.managedListing.update({ where: { id }, data: { position } })));
    const items = await this.prisma.managedListing.findMany({ where: { id: { in: ids } }, orderBy: { position: "asc" } });
    return items.map((item) => this.toManagedListing(item));
  }

  async getManagedListingAsset(id: string) {
    const item = await this.prisma.managedListing.findUnique({ where: { id }, select: { thumbnailObjectKey: true } });
    if (!item?.thumbnailObjectKey) throw new NotFoundException("Asset not found");
    try { return await this.objects.getBinary(item.thumbnailObjectKey); }
    catch { throw new NotFoundException("Asset not found"); }
  }

  private toManagedListing(item: Prisma.ManagedListingGetPayload<object>) {
    const { thumbnailObjectKey, ...listing } = item;
    return {
      ...listing,
      type: item.type === ManagedListingType.GATEWAY ? "gateway" as const : "project" as const,
      homeSideSlot: item.homeSideSlot === SideAdSlot.LEFT ? "left" as const : item.homeSideSlot === SideAdSlot.RIGHT ? "right" as const : null,
      thumbnailUrl: thumbnailObjectKey ? `/api/v1/assets/listings/${item.id}?v=${item.updatedAt.getTime()}` : item.thumbnailUrl,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async validateManagedListingPlacement(type: ManagedListingType, data: ReturnType<typeof parseManagedListingInput>, currentId?: string) {
    if (type !== ManagedListingType.GATEWAY && (data.gatewayPlacement || data.homeSideSlot || data.homeBottomPlacement)) {
      throw new BadRequestException("只有中转站赞助位可以投放到中转站目录或首页");
    }
    const homeSideSlot = type === ManagedListingType.GATEWAY ? toPrismaSideAdSlot(data.homeSideSlot) : null;
    if (homeSideSlot) await this.ensureHomeSideSlotAvailable(homeSideSlot, currentId);
    return {
      gatewayPlacement: type === ManagedListingType.GATEWAY && data.gatewayPlacement,
      homeSideSlot,
      homeBottomPlacement: type === ManagedListingType.GATEWAY && data.homeBottomPlacement,
    };
  }

  private async ensureHomeSideSlotAvailable(slot: SideAdSlot, currentId?: string) {
    const conflict = await this.prisma.managedListing.findFirst({
      where: { type: ManagedListingType.GATEWAY, active: true, homeSideSlot: slot, ...(currentId ? { id: { not: currentId } } : {}) },
      select: { title: true },
    });
    if (conflict) throw new BadRequestException(`首页${slot === SideAdSlot.LEFT ? "左侧" : "右侧"}赞助位已被“${conflict.title}”占用`);
  }

  private async storeManagedListingImage(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择图片文件");
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException("图片不能超过 5 MB");
    const extension = listingImageExtension(file.mimetype, file.buffer);
    if (!extension) throw new BadRequestException("仅支持 PNG、JPEG 或 WebP 图片");
    const key = `managed-listings/${Date.now()}-${randomUUID()}.${extension}`;
    await this.objects.put(key, file.buffer, file.mimetype);
    return key;
  }

  async listSearchAds() {
    const items = await this.prisma.searchAd.findMany({ orderBy: [{ position: "asc" }, { createdAt: "desc" }] });
    return items.map((item) => this.toSearchAd(item));
  }

  async addSearchAd(input: unknown, files: { backgroundImage?: Express.Multer.File[]; logo?: Express.Multer.File[] } = {}) {
    const data = searchAdInputSchema.parse(input);
    const latest = await this.prisma.searchAd.aggregate({ _max: { position: true } });
    const backgroundObjectKey = files.backgroundImage?.[0] ? await this.storeSearchAdImage("background", files.backgroundImage[0], 5 * 1024 * 1024) : null;
    let logoObjectKey: string | null = null;
    try {
      logoObjectKey = files.logo?.[0] ? await this.storeSearchAdImage("logo", files.logo[0], 2 * 1024 * 1024) : null;
      const content = normalizeSearchAdContent(data.content);
      const item = await this.prisma.searchAd.create({
        data: {
          title: data.title,
          description: plainSearchAdText(content, data.description),
          descriptionContent: content.length ? content : Prisma.JsonNull,
          url: data.url,
          imageUrl: backgroundObjectKey ? null : data.backgroundImageUrl || data.imageUrl || null,
          backgroundObjectKey,
          logoUrl: logoObjectKey ? null : data.logoUrl || null,
          logoObjectKey,
          label: data.label,
          keywords: data.keywords,
          global: data.global,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          active: data.active,
          position: (latest._max.position ?? -1) + 1,
        },
      });
      return this.toSearchAd(item);
    } catch (error) {
      if (backgroundObjectKey) await this.objects.remove(backgroundObjectKey).catch(() => undefined);
      if (logoObjectKey) await this.objects.remove(logoObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async updateSearchAd(id: string, input: unknown, files: { backgroundImage?: Express.Multer.File[]; logo?: Express.Multer.File[] } = {}) {
    const current = await this.prisma.searchAd.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("搜索广告不存在");
    const data = searchAdInputSchema.parse(input);
    let backgroundObjectKey = current.backgroundObjectKey;
    let imageUrl = current.imageUrl;
    let logoObjectKey = current.logoObjectKey;
    let logoUrl = current.logoUrl;
    let uploadedBackground: string | null = null;
    let uploadedLogo: string | null = null;
    try {
      if (files.backgroundImage?.[0]) {
        uploadedBackground = await this.storeSearchAdImage("background", files.backgroundImage[0], 5 * 1024 * 1024);
        backgroundObjectKey = uploadedBackground;
        imageUrl = null;
      } else if (data.clearBackgroundImage) {
        backgroundObjectKey = null;
        imageUrl = null;
      } else if (data.backgroundImageUrl || data.imageUrl) {
        backgroundObjectKey = null;
        imageUrl = data.backgroundImageUrl || data.imageUrl || null;
      }
      if (files.logo?.[0]) {
        uploadedLogo = await this.storeSearchAdImage("logo", files.logo[0], 2 * 1024 * 1024);
        logoObjectKey = uploadedLogo;
        logoUrl = null;
      } else if (data.clearLogo) {
        logoObjectKey = null;
        logoUrl = null;
      } else if (data.logoUrl) {
        logoObjectKey = null;
        logoUrl = data.logoUrl;
      }
      const content = normalizeSearchAdContent(data.content);
      const item = await this.prisma.searchAd.update({
        where: { id },
        data: {
          title: data.title,
          description: plainSearchAdText(content, data.description),
          descriptionContent: content.length ? content : Prisma.JsonNull,
          url: data.url,
          imageUrl,
          backgroundObjectKey,
          logoUrl,
          logoObjectKey,
          label: data.label,
          keywords: data.keywords,
          global: data.global,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          active: data.active,
        },
      });
      if (current.backgroundObjectKey && current.backgroundObjectKey !== backgroundObjectKey) await this.objects.remove(current.backgroundObjectKey).catch(() => undefined);
      if (current.logoObjectKey && current.logoObjectKey !== logoObjectKey) await this.objects.remove(current.logoObjectKey).catch(() => undefined);
      return this.toSearchAd(item);
    } catch (error) {
      if (uploadedBackground) await this.objects.remove(uploadedBackground).catch(() => undefined);
      if (uploadedLogo) await this.objects.remove(uploadedLogo).catch(() => undefined);
      throw error;
    }
  }

  async toggleSearchAd(id: string) {
    const item = await this.prisma.searchAd.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("搜索广告不存在");
    return this.toSearchAd(await this.prisma.searchAd.update({ where: { id }, data: { active: !item.active } }));
  }

  async reorderSearchAds(input: unknown) {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new BadRequestException("请选择有效的广告顺序");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.searchAd.update({ where: { id }, data: { position } })));
    return this.listSearchAds();
  }

  async getSearchAdAsset(id: string, kind: string) {
    if (kind !== "background" && kind !== "logo") throw new NotFoundException("Asset not found");
    const item = await this.prisma.searchAd.findUnique({ where: { id }, select: { backgroundObjectKey: true, logoObjectKey: true } });
    const objectKey = kind === "background" ? item?.backgroundObjectKey : item?.logoObjectKey;
    if (!objectKey) throw new NotFoundException("Asset not found");
    try { return await this.objects.getBinary(objectKey); }
    catch { throw new NotFoundException("Asset not found"); }
  }

  private toSearchAd(item: Prisma.SearchAdGetPayload<object>) {
    const { backgroundObjectKey, logoObjectKey, descriptionContent, ...ad } = item;
    const version = item.updatedAt.getTime();
    const backgroundImageUrl = backgroundObjectKey ? `/api/v1/assets/search-ads/${item.id}/background?v=${version}` : item.imageUrl;
    const logoUrl = logoObjectKey ? `/api/v1/assets/search-ads/${item.id}/logo?v=${version}` : item.logoUrl;
    return {
      ...ad,
      imageUrl: backgroundImageUrl,
      backgroundImageUrl,
      logoUrl,
      content: searchAdContent(descriptionContent, item.description),
      startsAt: item.startsAt?.toISOString() || null,
      endsAt: item.endsAt?.toISOString() || null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async storeSearchAdImage(kind: "background" | "logo", file: Express.Multer.File, maxSize: number) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择图片文件");
    if (file.size > maxSize) throw new BadRequestException(`图片不能超过 ${Math.round(maxSize / 1024 / 1024)} MB`);
    const extension = listingImageExtension(file.mimetype, file.buffer);
    if (!extension) throw new BadRequestException("仅支持 PNG、JPEG 或 WebP 图片");
    const key = `search-ads/${kind}/${Date.now()}-${randomUUID()}.${extension}`;
    await this.objects.put(key, file.buffer, file.mimetype);
    return key;
  }

  async ensureSources() {
    for (const definition of SOURCE_DEFINITIONS) {
      await this.prisma.dataSource.upsert({
        where: { key: definition.key },
        create: { ...definition, enabled: false, robotsReviewedAt: new Date() },
        update: { name: definition.name, kind: definition.kind, baseUrl: definition.baseUrl, attributionUrl: definition.attributionUrl, robotsUrl: definition.robotsUrl, termsUrl: definition.termsUrl },
      });
    }
    const sources = await this.prisma.dataSource.findMany({ where: { key: { in: SOURCE_DEFINITIONS.map((definition) => definition.key) } }, orderBy: { name: "asc" } });
    return sources.map(sourceScheduleView);
  }

  async setSourceSchedule(key: string, input: unknown) {
    if (!SUPPORTED_SCHEDULE_SOURCE_KEYS.has(key)) throw new BadRequestException("不支持设置该采集来源");
    const { enabled, intervalMinutes } = parseSourceSchedule(input, key === "ldxp" ? 10 : 60);
    const source = await this.prisma.dataSource.update({
      where: { key },
      data: { enabled, pollIntervalSeconds: intervalMinutes * 60 },
    });
    return sourceScheduleView(source);
  }

  async requestSourceSync(key: string) {
    if (!SUPPORTED_SCHEDULE_SOURCE_KEYS.has(key)) throw new BadRequestException("不支持同步该采集来源");
    const source = await this.source(key);
    const syncKind = `${key}-sync-request`;
    const existing = await this.prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: syncKind, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { accepted: true, queued: existing.status === SyncStatus.QUEUED, runId: existing.id };
    const run = await this.prisma.ingestionRun.create({
      data: { dataSourceId: source.id, kind: syncKind, status: SyncStatus.QUEUED },
    });
    return { accepted: true, queued: true, runId: run.id };
  }

  async syncPublicCatalog(key: string, requestedRunId?: string) {
    if (key !== "cardnav") throw new BadRequestException("仅支持 Cardnav 公开目录");
    const source = await this.source(key);
    const run = requestedRunId
      ? await this.prisma.ingestionRun.findFirst({ where: { id: requestedRunId, dataSourceId: source.id, kind: { in: [`${key}-sync-request`, `${key}-scheduled-sync`] } } })
      : null;
    const activeRun = run || await this.startRun(source.id, `${key}-catalog-sync`);
    if (activeRun.status === SyncStatus.SUCCEEDED || activeRun.status === SyncStatus.FAILED) return { runId: activeRun.id, status: activeRun.status, counts: activeRun.counts };
    await this.prisma.ingestionRun.update({ where: { id: activeRun.id }, data: { status: SyncStatus.RUNNING, startedAt: activeRun.startedAt || new Date(), finishedAt: null, errorCode: null, errorMessage: null } });
    try {
      const snapshot = await this.cardnav.fetchSnapshot({ etag: source.etag, lastModified: source.lastModified });
      if ("notModified" in snapshot) {
        const finishedAt = new Date();
        await this.prisma.$transaction([
          this.prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, etag: snapshot.etag || source.etag, lastModified: snapshot.lastModified || source.lastModified } }),
          this.prisma.ingestionRun.update({ where: { id: activeRun.id }, data: { status: SyncStatus.SUCCEEDED, counts: { noChange: true }, finishedAt } }),
        ]);
        return { runId: activeRun.id, noChange: true };
      }
      const rawSnapshotKey = await this.objects.put(`raw/${key}/catalog-${snapshot.snapshotId}.json`, snapshot.raw, "application/json");
      const result = await this.persistPublicCatalog(source, activeRun.id, snapshot);
      const finishedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, lastSnapshotId: snapshot.snapshotId, etag: snapshot.etag, lastModified: snapshot.lastModified } }),
        this.prisma.ingestionRun.update({ where: { id: activeRun.id }, data: { status: SyncStatus.SUCCEEDED, snapshotId: snapshot.snapshotId, checksum: sha256(snapshot.raw), rawSnapshotKey, counts: result, finishedAt } }),
      ]);
      return { runId: activeRun.id, ...result };
    } catch (error) {
      await this.failRun(activeRun.id, error);
      throw error;
    }
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
    const { batchSize, refreshAll, priorityTokens } = parseLdxpProductBackfillInput(input);
    const source = await this.source("ldxp");
    const existing = await this.prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: "ldxp-product-backfill", status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      if (priorityTokens.length) {
        const counts = isRecord(existing.counts) ? existing.counts : {};
        const currentPriorities = stringArray(counts.priorityTokens);
        await this.prisma.ingestionRun.update({
          where: { id: existing.id },
          data: { counts: { ...counts, batchSize, priorityTokens: [...new Set([...priorityTokens, ...currentPriorities])].slice(0, 50) } },
        });
      }
      return { accepted: true, queued: existing.status === SyncStatus.QUEUED, runId: existing.id, existing: true, priorityTokens };
    }
    const status = await this.ldxpProductBackfillStatus(key);
    if (!status.remainingShops && !refreshAll) return { accepted: true, queued: false, runId: null, existing: false, complete: true };
    const run = await this.prisma.ingestionRun.create({
      data: {
        dataSourceId: source.id,
        kind: "ldxp-product-backfill",
        status: SyncStatus.QUEUED,
        counts: {
          batchSize,
          refreshAll,
          priorityTokens,
          totalAtStart: status.totalShops,
          remainingAtStart: status.remainingShops,
          processedShops: 0,
          succeededShops: 0,
          failedShops: 0,
          productsUpserted: 0,
          offersPromoted: 0,
          offersDeactivated: 0,
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
    const { batchSize, refreshAll, priorityTokens } = parseLdxpProductBackfillInput({ batchSize: counts.batchSize, refreshAll: counts.refreshAll, priorityTokens: counts.priorityTokens });
    const pass = Math.max(1, numberValue(counts.pass));
    const lastCandidateId = typeof counts.lastCandidateId === "string" ? counts.lastCandidateId : null;
    const refreshStartedAt = run.startedAt || run.createdAt;
    const refreshAfterMs = run.dataSource.pollIntervalSeconds * 1000;
    const candidates = await this.ldxpBackfillCandidates(run.dataSourceId);
    const needsSync = (candidate: LdxpBackfillCandidate) => isLdxpProductSyncDue(candidate.rawMetadata, refreshAll, refreshStartedAt, refreshAfterMs);
    const pending = candidates.filter(needsSync);
    const prioritized = priorityTokens
      .map((token) => pending.find((candidate) => candidate.token === token))
      .filter((candidate): candidate is LdxpBackfillCandidate => Boolean(candidate));
    const priorityIds = new Set(prioritized.map((candidate) => candidate.id));
    const available = pending.filter((candidate) => !priorityIds.has(candidate.id) && (!lastCandidateId || candidate.id > lastCandidateId));
    const targets = [...prioritized, ...available].slice(0, batchSize);

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
      const remainingShops = (await this.ldxpBackfillCandidates(run.dataSourceId)).filter(needsSync).length;
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
    const remainingAfterBatch = (await this.ldxpBackfillCandidates(run.dataSourceId)).filter(needsSync).length;
    const hasMoreInThisPass = candidates.some((candidate) => candidate.id > lastProcessed && needsSync(candidate));
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
      offersDeactivated: numberValue(counts.offersDeactivated) + result.offersDeactivated,
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
              directoryUrl: shop.mirrorUrl,
              homepageUrl: shop.originalShopUrl,
              logoUrl: shop.logoUrl,
              sourceSyncedAt: observedAt,
              lastSeenAt: observedAt,
              rawMetadata: metadata,
            },
            update: {
              name: shop.name,
              directoryUrl: shop.mirrorUrl,
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
        : { productShopsRequested: 0, productShopsSucceeded: 0, productShopsFailed: 0, productsUpserted: 0, offersPromoted: 0, offersDeactivated: 0, categoriesSynced: 0, failures: [] as Array<{ token: string; error: string }> };
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
    let offersDeactivated = 0;
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
          const sourceAttributionUrl = `${DISCOVERY_211B_ORIGIN}/shops/${encodeURIComponent(target.token)}`;
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
                sourceAttributionUrl,
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
                sourceAttributionUrl,
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
          const missingCandidates = await tx.offerCandidate.findMany({
            where: { shopCandidateId: candidate.id, active: true, missingCount: { gte: LDXP_MISSING_CONFIRMATIONS } },
            select: { id: true, externalId: true, externalProductId: true },
          });
          if (missingCandidates.length) {
            await tx.offerCandidate.updateMany({
              where: { id: { in: missingCandidates.map((item) => item.id) } },
              data: { active: false },
            });
          }

          let promoted = 0;
          let deactivated = 0;
          if (candidate.approvedShopId && (candidate.reviewStatus === CandidateReviewStatus.APPROVED || candidate.reviewStatus === CandidateReviewStatus.MERGED)) {
            if (missingCandidates.length) {
              const publishedOffers = await tx.offer.findMany({
                where: {
                  shopId: candidate.approvedShopId,
                  dataSourceId: source.id,
                  externalId: { in: missingCandidates.map((item) => item.externalId) },
                  active: true,
                },
                select: { id: true, sourceProductId: true, canonicalProductId: true },
              });
              if (publishedOffers.length) {
                await tx.offer.updateMany({
                  where: { id: { in: publishedOffers.map((offer) => offer.id) } },
                  data: { active: false, syncedAt: snapshot.observedAt },
                });
                const sourceProductIds = [...new Set(publishedOffers.map((offer) => offer.sourceProductId))];
                await tx.sourceProduct.updateMany({
                  where: { id: { in: sourceProductIds }, offers: { none: { active: true } } },
                  data: { active: false },
                });
                await tx.outboxEvent.createMany({
                  data: publishedOffers.map((offer) => ({
                    topic: "offer.updated",
                    aggregateId: offer.id,
                    payload: { offerId: offer.id, productId: offer.canonicalProductId, active: false, reason: "missing_from_two_successful_snapshots" },
                  })),
                });
                deactivated = publishedOffers.length;
              }
            }
            const activeOffers = await tx.offerCandidate.findMany({ where: { shopCandidateId: candidate.id, active: true } });
            for (const offerCandidate of activeOffers) {
              await this.promoteOffer(tx, runId, candidate.approvedShopId, source, offerCandidate);
              promoted += 1;
            }
            await tx.shop.update({ where: { id: candidate.approvedShopId }, data: { lastSyncedAt: snapshot.observedAt } });
          }
          return { upserted, promoted, deactivated };
        }, { timeout: 120_000 });
        productShopsSucceeded += 1;
        productsUpserted += result.upserted;
        offersPromoted += result.promoted;
        offersDeactivated += result.deactivated;
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
      offersDeactivated,
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

  private async persistPublicCatalog(source: { id: string; key: string; name: string; attributionUrl: string }, runId: string, snapshot: { generatedAt: string; shops: PublicCatalogShop[]; offers: PublicCatalogOffer[]; rejectedShops: number; rejectedOffers: number }) {
    const shopUrls = [...new Set(snapshot.shops.map((shop) => normalizeCatalogUrl(shop.shopUrl)).filter(Boolean))];
    const publishedShops = await this.prisma.shop.findMany({ where: { homepageUrl: { in: shopUrls } }, select: { id: true, homepageUrl: true } });
    const publishedByUrl = new Map(publishedShops.map((shop) => [normalizeCatalogUrl(shop.homepageUrl), shop.id]));
    const existingCandidates = await this.prisma.shopCandidate.findMany({ where: { dataSourceId: source.id }, select: { id: true, externalId: true, homepageUrl: true, approvedShopId: true, reviewStatus: true } });
    const existingByExternalId = new Map(existingCandidates.map((candidate) => [candidate.externalId, candidate]));
    const offersByShop = new Map<string, PublicCatalogOffer[]>();
    for (const offer of snapshot.offers) offersByShop.set(offer.shopExternalId, [...(offersByShop.get(offer.shopExternalId) || []), offer]);
    const seenCandidateIds = new Set<string>();
    let createdShops = 0;
    let updatedShops = 0;
    let duplicateShops = 0;
    let productsUpserted = 0;
    let offersPromoted = 0;
    let duplicateOffers = 0;
    let offersDeactivated = 0;

    for (const shop of snapshot.shops) {
      const shopUrl = normalizeCatalogUrl(shop.shopUrl);
      if (!shopUrl) continue;
      const approvedShopId = publishedByUrl.get(shopUrl) || existingByExternalId.get(shop.externalId)?.approvedShopId || null;
      const previous = existingByExternalId.get(shop.externalId);
      const offers = offersByShop.get(shop.externalId) || [];
      const seenOfferIds = [...new Set(offers.map((offer) => offer.externalId))];
      const candidate = await this.prisma.$transaction(async (tx) => {
        const candidate = await tx.shopCandidate.upsert({
          where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: shop.externalId } },
          create: {
            dataSourceId: source.id, externalId: shop.externalId, name: shop.name, directoryUrl: source.attributionUrl,
            homepageUrl: shopUrl, sourceSyncedAt: new Date(shop.observedAt), lastSeenAt: new Date(shop.observedAt),
            approvedShopId, reviewStatus: approvedShopId ? CandidateReviewStatus.MERGED : CandidateReviewStatus.PENDING,
            rawMetadata: { ...shop.rawMetadata, catalogSource: source.key, normalizedShopUrl: shopUrl, observedAt: shop.observedAt },
          },
          update: {
            name: shop.name, directoryUrl: source.attributionUrl, homepageUrl: shopUrl, sourceSyncedAt: new Date(shop.observedAt),
            lastSeenAt: new Date(shop.observedAt), missingCount: 0, rawMetadata: { ...shop.rawMetadata, catalogSource: source.key, normalizedShopUrl: shopUrl, observedAt: shop.observedAt },
            ...(approvedShopId ? { approvedShopId, reviewStatus: CandidateReviewStatus.MERGED } : {}),
          },
        });
        if (approvedShopId) {
          await tx.shopSource.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: shop.externalId } },
            create: { shopId: approvedShopId, dataSourceId: source.id, externalId: shop.externalId, collectionMode: CollectionMode.PUBLIC_FEED, attributionLabel: source.name },
            update: { shopId: approvedShopId, collectionMode: CollectionMode.PUBLIC_FEED, attributionLabel: source.name },
          });
        }
        for (const offer of offers) {
          await tx.offerCandidate.upsert({
            where: { dataSourceId_externalId: { dataSourceId: source.id, externalId: offer.externalId } },
            create: {
              dataSourceId: source.id, externalId: offer.externalId, shopCandidateId: candidate.id,
              externalProductId: offer.externalProductId, productName: offer.productName, specification: offer.specification,
              category: offer.category, price: offer.price, currency: offer.currency, stock: offer.stock, stockStatus: offer.stockStatus,
              offerUrl: offer.offerUrl, sourceAttributionUrl: source.attributionUrl, observedAt: new Date(offer.observedAt), ingestionRunId: runId,
              rawMetadata: { ...offer.rawMetadata, catalogSource: source.key, shopUrl },
            },
            update: {
              shopCandidateId: candidate.id, externalProductId: offer.externalProductId, productName: offer.productName, specification: offer.specification,
              category: offer.category, price: offer.price, currency: offer.currency, stock: offer.stock, stockStatus: offer.stockStatus,
              offerUrl: offer.offerUrl, sourceAttributionUrl: source.attributionUrl, observedAt: new Date(offer.observedAt), ingestionRunId: runId,
              active: true, missingCount: 0, rawMetadata: { ...offer.rawMetadata, catalogSource: source.key, shopUrl },
            },
          });
        }
        await tx.offerCandidate.updateMany({ where: { shopCandidateId: candidate.id, active: true, externalId: { notIn: seenOfferIds } }, data: { missingCount: { increment: 1 } } });
        const staleOffers = await tx.offerCandidate.findMany({ where: { shopCandidateId: candidate.id, active: true, missingCount: { gte: 2 } }, select: { id: true, externalId: true } });
        if (staleOffers.length) await tx.offerCandidate.updateMany({ where: { id: { in: staleOffers.map((offer) => offer.id) } }, data: { active: false } });
        if (approvedShopId) {
          const activeCandidates = await tx.offerCandidate.findMany({ where: { shopCandidateId: candidate.id, active: true } });
          for (const offerCandidate of activeCandidates) await this.promoteOffer(tx, runId, approvedShopId, source, offerCandidate);
          if (staleOffers.length) {
            const stalePublished = await tx.offer.findMany({ where: { shopId: approvedShopId, dataSourceId: source.id, externalId: { in: staleOffers.map((offer) => offer.externalId) }, active: true }, select: { id: true, canonicalProductId: true } });
            if (stalePublished.length) {
              await tx.offer.updateMany({ where: { id: { in: stalePublished.map((offer) => offer.id) } }, data: { active: false, syncedAt: new Date(snapshot.generatedAt) } });
              for (const offer of stalePublished) await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: offer.id, payload: { offerId: offer.id, productId: offer.canonicalProductId, active: false, reason: "missing_from_two_public_catalog_snapshots" } } });
            }
            offersDeactivated += stalePublished.length;
          }
          await tx.shop.update({ where: { id: approvedShopId }, data: { lastSyncedAt: new Date(snapshot.generatedAt) } });
        }
        return candidate;
      }, { timeout: 60_000 });
      existingByExternalId.set(shop.externalId, { ...candidate, homepageUrl: shopUrl, approvedShopId: candidate.approvedShopId, reviewStatus: candidate.reviewStatus });
      seenCandidateIds.add(candidate.id);
      if (previous) updatedShops += 1; else createdShops += 1;
      if (publishedByUrl.has(shopUrl) && previous?.approvedShopId !== approvedShopId) duplicateShops += 1;
      if (approvedShopId) {
        offersPromoted += offers.length;
      }
      productsUpserted += offers.length;
    }

    const missingCandidates = await this.prisma.shopCandidate.findMany({ where: { dataSourceId: source.id, id: { notIn: [...seenCandidateIds] }, reviewStatus: CandidateReviewStatus.PENDING }, select: { id: true } });
    if (missingCandidates.length) await this.prisma.shopCandidate.updateMany({ where: { id: { in: missingCandidates.map((candidate) => candidate.id) } }, data: { missingCount: { increment: 1 } } });
    const dedupedOfferUrls = new Set(snapshot.offers.map((offer) => normalizeCatalogUrl(offer.offerUrl)));
    duplicateOffers = snapshot.offers.length - dedupedOfferUrls.size;
    return { shops: snapshot.shops.length, createdShops, updatedShops, duplicateShops, products: productsUpserted, offers: snapshot.offers.length, duplicateOffers, offersPromoted, offersDeactivated, rejectedShops: snapshot.rejectedShops, rejectedOffers: snapshot.rejectedOffers };
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
            homepageUrl,
            adapterKind: candidate.dataSource.key === "ldxp"
              ? "211b-public-directory"
              : candidate.dataSource.key === "cardnav"
                ? "public-catalog"
                : "authorized-direct",
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
          update: { shopId: shop.id, collectionMode: sourceCollectionMode(candidate.dataSource.key), attributionLabel: candidate.dataSource.name, authorizationEvidence: decision.authorizationEvidence },
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
    const isScheduledCatalogRun = ["taokayou-sitemap", "cardnav-sync-request", "cardnav-scheduled-sync", "cardnav-catalog-sync"].includes(run.kind);
    if (!run.dataSource.enabled || !isScheduledCatalogRun) return;
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

  private async promoteOffer(tx: Prisma.TransactionClient, runId: string, shopId: string, source: { id: string; key: string; name: string }, candidate: { id: string; externalId: string; externalProductId: string; productName: string; specification: string; category: string; price: Prisma.Decimal; currency: string; stock: number | null; offerUrl: string; sourceAttributionUrl?: string | null; observedAt: Date; rawMetadata?: Prisma.JsonValue | null }) {
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
    const sameUrlOffer = await tx.offer.findFirst({ where: { shopId, sourceUrl: normalizeCatalogUrl(candidate.offerUrl), NOT: { dataSourceId: source.id } }, orderBy: { syncedAt: "desc" } });
    if (sameUrlOffer) {
      const changed = !sameUrlOffer.price.equals(candidate.price) || sameUrlOffer.stock !== candidate.stock || !sameUrlOffer.active;
      const updated = await tx.offer.update({ where: { id: sameUrlOffer.id }, data: { canonicalProductId: canonical.id, price: candidate.price, stock: candidate.stock, active: true, sourceObservedAt: candidate.observedAt, syncedAt: new Date() } });
      if (changed) await tx.priceHistory.create({ data: { offerId: updated.id, price: candidate.price, stock: candidate.stock, capturedAt: candidate.observedAt } });
      await tx.outboxEvent.create({ data: { topic: "offer.updated", aggregateId: updated.id, payload: { offerId: updated.id, productId: canonical.id, deduplicatedSource: source.key } } });
      return updated;
    }
    const existing = await tx.offer.findUnique({ where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: candidate.externalId } } });
    const offer = await tx.offer.upsert({
      where: { shopId_dataSourceId_externalId: { shopId, dataSourceId: source.id, externalId: candidate.externalId } },
      create: { shopId, sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, dataSourceId: source.id, externalId: candidate.externalId, collectionMode: sourceCollectionMode(source.key), price: candidate.price, stock: candidate.stock, currency: candidate.currency, active: true, sourceUrl: candidate.offerUrl, sourceAttributionUrl: candidate.sourceAttributionUrl, sourceObservedAt: candidate.observedAt, syncedAt: new Date() },
      update: { sourceProductId: sourceProduct.id, canonicalProductId: canonical.id, collectionMode: sourceCollectionMode(source.key), price: candidate.price, stock: candidate.stock, currency: candidate.currency, active: true, sourceUrl: candidate.offerUrl, sourceAttributionUrl: candidate.sourceAttributionUrl, sourceObservedAt: candidate.observedAt, syncedAt: new Date() },
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
  return parseSourceSchedule(input, 10);
}

export function parseSourceSchedule(input: unknown, minimumMinutes = 30) {
  const body = input as { enabled?: unknown; intervalMinutes?: unknown };
  const enabled = body?.enabled;
  const intervalMinutes = Number(body?.intervalMinutes);
  if (typeof enabled !== "boolean") throw new BadRequestException("enabled 必须为布尔值");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < minimumMinutes || intervalMinutes > 1440) {
    throw new BadRequestException(`采集间隔必须为 ${minimumMinutes}-1440 分钟的整数`);
  }
  return { enabled, intervalMinutes };
}

export function parseLdxpProductBackfillInput(input: unknown) {
  const rawBatchSize = (input as { batchSize?: unknown })?.batchSize;
  const rawRefreshAll = (input as { refreshAll?: unknown })?.refreshAll;
  const rawPriorityTokens = (input as { priorityTokens?: unknown })?.priorityTokens;
  const batchSize = rawBatchSize === undefined || rawBatchSize === "" ? 25 : Number(rawBatchSize);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new BadRequestException("每批店铺数必须为 1-100 家的整数");
  }
  if (rawRefreshAll !== undefined && typeof rawRefreshAll !== "boolean") {
    throw new BadRequestException("refreshAll 必须为布尔值");
  }
  if (rawPriorityTokens !== undefined && (!Array.isArray(rawPriorityTokens) || rawPriorityTokens.length > 50 || rawPriorityTokens.some((token) => typeof token !== "string" || !isSafeLdxpToken(token)))) {
    throw new BadRequestException("priorityTokens 必须是最多 50 个合法店铺 Token");
  }
  return { batchSize, refreshAll: rawRefreshAll === true, priorityTokens: rawPriorityTokens as string[] | undefined || [] };
}

export function isLdxpProductSyncPending(metadata: Prisma.JsonValue | null) {
  if (!isRecord(metadata)) return true;
  return metadata.productSyncStatus === "failed" || typeof metadata.productSyncedAt !== "string";
}

export function shouldDeactivateMissingLdxpOffer(missingCount: number) {
  return Number.isInteger(missingCount) && missingCount >= LDXP_MISSING_CONFIRMATIONS;
}

export function isLdxpProductSyncDue(metadata: Prisma.JsonValue | null, refreshAll: boolean, refreshStartedAt: Date, refreshAfterMs: number | null = null) {
  if (isLdxpProductSyncPending(metadata)) return true;
  const syncedAt = Date.parse(String((metadata as Record<string, unknown>).productSyncedAt));
  if (!Number.isFinite(syncedAt)) return true;
  if (refreshAll) return syncedAt < refreshStartedAt.getTime();
  return refreshAfterMs !== null && refreshAfterMs > 0 && refreshStartedAt.getTime() - syncedAt >= refreshAfterMs;
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

export function normalize211bOrigin(value?: string) {
  const url = new URL(value?.trim() || "https://2dou.org");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("SOURCE_211B_ORIGIN 必须是无路径、无账号信息的 HTTPS 域名");
  }
  return url.origin;
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
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
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
export function normalizeCatalogUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (/^(?:www\.|pay\.)?ldxp\.cn$/i.test(url.hostname)) url.hostname = "pay.ldxp.cn";
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
}
function sourceCollectionMode(sourceKey: string) {
  if (sourceKey === "cardnav") return CollectionMode.PUBLIC_FEED;
  if (sourceKey === "ldxp") return CollectionMode.PUBLIC_DIRECTORY;
  if (sourceKey === "taokayou") return CollectionMode.AUTHORIZED_DIRECT;
  return CollectionMode.MANUAL;
}
function listingType(value: unknown) {
  if (value === "gateway" || value === ManagedListingType.GATEWAY) return ManagedListingType.GATEWAY;
  if (value === "project" || value === ManagedListingType.PROJECT) return ManagedListingType.PROJECT;
  throw new BadRequestException("展示类型必须是 gateway 或 project");
}

function toPrismaSideAdSlot(value: "left" | "right" | undefined) {
  if (value === "left") return SideAdSlot.LEFT;
  if (value === "right") return SideAdSlot.RIGHT;
  return null;
}

function parseManagedListingInput(input: unknown) {
  try {
    return managedListingInputSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException(error.issues[0]?.message || "展示项字段无效");
    }
    throw error;
  }
}

function listingImageExtension(mime: string, body: Buffer) {
  if (mime === "image/png" && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if ((mime === "image/jpeg" || mime === "image/jpg") && body[0] === 0xff && body[1] === 0xd8 && body.at(-2) === 0xff && body.at(-1) === 0xd9) return "jpg";
  if (mime === "image/webp" && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function normalizeSearchAdContent(value: unknown): AnnouncementSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((segment) => {
    const parsed = announcementSegmentSchema.safeParse(segment);
    return parsed.success ? [parsed.data] : [];
  });
}

function searchAdContent(value: Prisma.JsonValue | null, description: string): AnnouncementSegment[] {
  const content = normalizeSearchAdContent(value);
  return content.length ? content : description.trim() ? [{ text: description.trim(), bold: false, italic: false, underline: false, color: "default", href: null }] : [];
}

function plainSearchAdText(content: AnnouncementSegment[], fallback: string) {
  const text = content.map((segment) => segment.text).join("").replace(/\s+/g, " ").trim();
  return (text || fallback.trim()).slice(0, 300);
}
