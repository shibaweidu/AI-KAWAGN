import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DataSourceKind, GatewayReviewStatus, Prisma, SyncStatus } from "@prisma/client";
import { gatewayDecisionSchema, gatewayDirectoryQuerySchema } from "@ai-card/contracts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { PrismaService } from "./prisma.service";
import { CacheService } from "./cache.service";

const SOURCE_KEY = "zuiquanapi";
const MANUAL_SOURCE_KEY = "manual";
const SOURCE_ORIGIN = "https://www.zuiquanapi.com";
const DEFAULT_INTERVAL_MINUTES = 6 * 60;
const DEFAULT_DISPLAY_GROUPS = [
  { id: "gateway-group-stable", key: "stable", name: "稳定生产", position: 10 },
  { id: "gateway-group-value", key: "value", name: "高性价比", position: 20 },
  { id: "gateway-group-recent", key: "recent", name: "近期收录", position: 30 },
] as const;
const SOURCE_SECTION_GROUP_KEYS: Record<string, string> = {
  "premium-stable": "stable",
  "ultra-cheap": "value",
  new: "recent",
};
const SECTION_LABELS: Record<string, string> = {
  "premium-stable": "稳定企业向",
  "ultra-cheap": "便宜个人向",
  "special-featured": "小有特色",
  new: "新站",
  all: "其他中转站",
  fom: "FOM 专区",
};

type SourceGateway = {
  sourceSiteId: string;
  name: string;
  description: string;
  sourceSection: string;
  sourcePosition: number | null;
  sourceRedirectUrl: string;
  destinationUrl: string | null;
  destinationHost: string | null;
  providerType: string;
  logoUrl: string | null;
  sponsored: boolean;
  online: boolean | null;
  upVotes: number;
  downVotes: number;
  availability7d: number | null;
  averageResponseMs: number | null;
  modelTags: string[];
  pricingClaims: string | null;
  sourceUpdatedAt: Date | null;
  rawMetadata: Prisma.InputJsonValue;
};

@Injectable()
export class GatewayDirectoryService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly cache?: CacheService) {}

  private cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cache ? this.cache.getOrSet(key, ttlSeconds, loader) : loader();
  }

  async listPublic(raw: Record<string, unknown>) {
    const query = gatewayDirectoryQuerySchema.parse(raw);
    return this.cached(CacheService.key("gateway-directory:list", query), 60, async () => {
      const where: Prisma.GatewayDirectoryEntryWhereInput = {
      active: true,
      reviewStatus: GatewayReviewStatus.APPROVED,
      sourceSection: query.section || undefined,
      online: query.online,
      OR: query.q ? [
        { name: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { modelTags: { has: query.q.toLocaleLowerCase("zh-CN") } },
        { pricingClaims: { contains: query.q, mode: "insensitive" } },
      ] : undefined,
      };
      const orderBy = gatewayOrder(query.sort);
      const [items, total, sectionGroups] = await this.prisma.$transaction([
      this.prisma.gatewayDirectoryEntry.findMany({
        where,
        orderBy,
        include: { displayGroup: true },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.gatewayDirectoryEntry.count({ where }),
      this.prisma.gatewayDirectoryEntry.groupBy({
        by: ["sourceSection"],
        where: { active: true, reviewStatus: GatewayReviewStatus.APPROVED },
        orderBy: { sourceSection: "asc" },
        _count: { sourceSection: true },
      }),
      ]);
      return {
        items: items.map(publicGateway),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: total ? Math.ceil(total / query.pageSize) : 0,
        sections: sectionGroups
          .map((group) => ({ key: group.sourceSection, label: SECTION_LABELS[group.sourceSection] || group.sourceSection, count: groupedCount(group._count, "sourceSection") }))
          .sort((a, b) => sectionOrder(a.key) - sectionOrder(b.key)),
      };
    });
  }

  async listGroupedPublic(raw: Record<string, unknown>) {
    await this.ensureDisplayGroups();
    const query = gatewayDirectoryQuerySchema.parse({ ...raw, page: raw.otherPage || raw.page });
    return this.cached(CacheService.key("gateway-directory:grouped", query), 60, async () => {
      const where: Prisma.GatewayDirectoryEntryWhereInput = {
      active: true,
      reviewStatus: GatewayReviewStatus.APPROVED,
      online: query.online,
      OR: query.q ? [
        { name: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { modelTags: { has: query.q.toLocaleLowerCase("zh-CN") } },
        { pricingClaims: { contains: query.q, mode: "insensitive" } },
      ] : undefined,
      };
      const orderBy = gatewayOrder(query.sort);
      const [groups, otherItems, otherTotal, total] = await this.prisma.$transaction([
      this.prisma.gatewayDisplayGroup.findMany({
        where: { active: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          entries: {
            where,
            orderBy,
            include: { displayGroup: true },
          },
        },
      }),
      this.prisma.gatewayDirectoryEntry.findMany({
        where: { ...where, displayGroupId: null },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { displayGroup: true },
      }),
      this.prisma.gatewayDirectoryEntry.count({ where: { ...where, displayGroupId: null } }),
      this.prisma.gatewayDirectoryEntry.count({ where }),
      ]);
      return {
        groups: groups.map((group) => ({ id: group.id, key: group.key, name: group.name, position: group.position, items: group.entries.map(publicGateway) })),
        other: {
          items: otherItems.map(publicGateway),
          total: otherTotal,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: otherTotal ? Math.ceil(otherTotal / query.pageSize) : 0,
        },
        total,
      };
    });
  }

  async detail(slug: string) {
    const item = await this.prisma.gatewayDirectoryEntry.findFirst({
      where: { slug, active: true, reviewStatus: GatewayReviewStatus.APPROVED },
      include: { displayGroup: true },
    });
    if (!item) throw new NotFoundException("Gateway not found");
    return publicGateway(item);
  }

  async monitorHistory(slug: string) {
    const item = await this.prisma.gatewayDirectoryEntry.findFirst({
      where: { slug, sourceKey: SOURCE_KEY, active: true, reviewStatus: GatewayReviewStatus.APPROVED },
      select: { sourceSiteId: true },
    });
    if (!item) throw new NotFoundException("Gateway not found");
    const url = new URL("/api/site-checks", SOURCE_ORIGIN);
    url.searchParams.set("site_id", item.sourceSiteId);
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "AI-Card-Marketplace/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`来源监控请求失败：HTTP ${response.status}`);
    return hourlyMonitorBuckets(await response.json() as unknown);
  }

  async featured(take = 8) {
    const items = await this.prisma.gatewayDirectoryEntry.findMany({
      where: { active: true, featured: true, reviewStatus: GatewayReviewStatus.APPROVED },
      orderBy: [{ position: "asc" }, { availability7d: "desc" }, { upVotes: "desc" }],
      include: { displayGroup: true },
      take: Math.max(1, Math.min(take, 12)),
    });
    return items.map(publicGateway);
  }

  async listAdmin(raw: Record<string, unknown>) {
    const source = await this.ensureScheduleSource();
    const displayGroups = await this.ensureDisplayGroups();
    const page = positiveInt(raw.page, 1);
    const pageSize = Math.min(100, positiveInt(raw.pageSize, 30));
    const status = adminStatus(raw.status);
    const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : "";
    const group = typeof raw.group === "string" && raw.group.trim() ? raw.group.trim() : "all";
    if (group !== "all" && group !== "unassigned" && !displayGroups.some((item) => item.id === group)) {
      throw new BadRequestException("展示分组筛选无效");
    }
    const where: Prisma.GatewayDirectoryEntryWhereInput = {
      reviewStatus: status,
      displayGroupId: group === "all" ? undefined : group === "unassigned" ? null : group,
      OR: q ? [
        { name: { contains: q, mode: "insensitive" } },
        { destinationHost: { contains: q, mode: "insensitive" } },
        { sourceSiteId: { contains: q, mode: "insensitive" } },
      ] : undefined,
    };
    const [items, total, statusGroups, lastRun, filteredGroupCounts, unassignedCount] = await this.prisma.$transaction([
      this.prisma.gatewayDirectoryEntry.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        include: { displayGroup: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.gatewayDirectoryEntry.count({ where }),
      this.prisma.gatewayDirectoryEntry.groupBy({ by: ["reviewStatus"], orderBy: { reviewStatus: "asc" }, _count: { reviewStatus: true } }),
      this.prisma.gatewayDirectorySyncRun.findFirst({ where: { sourceKey: SOURCE_KEY }, orderBy: { createdAt: "desc" } }),
      this.prisma.gatewayDirectoryEntry.groupBy({
        by: ["displayGroupId"],
        where: { reviewStatus: status },
        orderBy: { displayGroupId: "asc" },
        _count: { _all: true },
      }),
      this.prisma.gatewayDirectoryEntry.count({ where: { displayGroupId: null } }),
    ]);
    const hosts = items.map((item) => item.destinationHost).filter((value): value is string => Boolean(value));
    const duplicateGroups = hosts.length ? await this.prisma.gatewayDirectoryEntry.groupBy({
      by: ["destinationHost"],
      where: { destinationHost: { in: hosts } },
      orderBy: { destinationHost: "asc" },
      _count: { destinationHost: true },
      having: { destinationHost: { _count: { gt: 1 } } },
    }) : [];
    const duplicateHosts = new Set(duplicateGroups.map((group) => group.destinationHost));
    const filteredCountByGroup = new Map(filteredGroupCounts.map((item) => [item.displayGroupId, groupedCount(item._count, "_all")]));
    return {
      items: items.map((item) => ({
        ...publicGateway(item),
        sourceSiteId: item.sourceSiteId,
        destinationHost: item.destinationHost,
        manual: item.sourceKey === MANUAL_SOURCE_KEY,
        reviewStatus: reviewStatusValue(item.reviewStatus),
        active: item.active,
        suspectedDuplicate: Boolean(item.destinationHost && duplicateHosts.has(item.destinationHost)),
      })),
      total,
      page,
      pageSize,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
      counts: Object.fromEntries(statusGroups.map((group) => [reviewStatusValue(group.reviewStatus), groupedCount(group._count, "reviewStatus")])),
      lastRun: lastRun ? serializeRun(lastRun) : null,
      schedule: gatewayScheduleView(source),
      group,
      unassignedCount,
      filteredUnassignedCount: filteredCountByGroup.get(null) || 0,
      displayGroups: displayGroups.map((item) => ({
        ...item,
        count: item._count.entries,
        filteredCount: filteredCountByGroup.get(item.id) || 0,
      })),
    };
  }

  async updateDisplayGroup(id: string, input: unknown) {
    const parsed = z.object({
      name: z.string().trim().min(1).max(30).optional(),
      active: z.boolean().optional(),
    }).refine((value) => value.name !== undefined || value.active !== undefined).safeParse(input);
    if (!parsed.success) throw new BadRequestException("请提供有效的分组名称或启用状态");
    const group = await this.prisma.gatewayDisplayGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException("展示分组不存在");
    return this.prisma.$transaction(async (transaction) => {
      let movedToUnassigned = 0;
      if (parsed.data.active === false) {
        const moved = await transaction.gatewayDirectoryEntry.updateMany({
          where: { displayGroupId: id },
          data: { displayGroupId: null },
        });
        movedToUnassigned = moved.count;
      }
      const updated = await transaction.gatewayDisplayGroup.update({
        where: { id },
        data: parsed.data,
      });
      return { ...updated, movedToUnassigned };
    });
  }

  async reorderDisplayGroups(input: unknown) {
    const parsed = z.object({
      ids: z.array(z.string().min(1)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
    }).safeParse(input);
    if (!parsed.success) throw new BadRequestException("请提供不重复的完整分组顺序");
    const groups = await this.prisma.gatewayDisplayGroup.findMany({ select: { id: true } });
    const existingIds = new Set(groups.map((group) => group.id));
    if (groups.length !== parsed.data.ids.length || parsed.data.ids.some((id) => !existingIds.has(id))) {
      throw new BadRequestException("分组顺序必须包含全部展示分组");
    }
    await this.prisma.$transaction(parsed.data.ids.map((id, index) => this.prisma.gatewayDisplayGroup.update({
      where: { id }, data: { position: (index + 1) * 10 },
    })));
    return { updated: parsed.data.ids.length };
  }

  async createDisplayGroup(input: unknown) {
    const parsed = z.object({ name: z.string().trim().min(1).max(30) }).safeParse(input);
    if (!parsed.success) throw new BadRequestException("分组名称长度必须为 1-30 个字符");
    const last = await this.prisma.gatewayDisplayGroup.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    return this.prisma.gatewayDisplayGroup.create({
      data: { key: `custom-${randomUUID()}`, name: parsed.data.name, position: (last?.position || 0) + 10, active: true },
    });
  }

  async createManualGateway(input: unknown) {
    const data = parseManualGateway(input);
    if (data.displayGroupId) {
      const group = await this.prisma.gatewayDisplayGroup.findFirst({ where: { id: data.displayGroupId, active: true } });
      if (!group) throw new NotFoundException("展示分组不存在");
    }
    const destination = new URL(data.url);
    const destinationHost = normalizedHost(destination.hostname, destination.href);
    const duplicate = await this.prisma.gatewayDirectoryEntry.findFirst({
      where: { destinationHost }, select: { name: true },
    });
    if (duplicate) throw new BadRequestException(`该域名已收录：${duplicate.name}`);
    const sourceSiteId = randomUUID();
    const now = new Date();
    const item = await this.prisma.gatewayDirectoryEntry.create({
      data: {
        sourceKey: MANUAL_SOURCE_KEY,
        sourceSiteId,
        slug: `manual-${sourceSiteId}`,
        name: data.name,
        description: data.description,
        sourceSection: "all",
        sourceRedirectUrl: destination.href,
        destinationUrl: destination.href,
        destinationHost,
        providerType: "手动收录",
        logoUrl: data.logoUrl || null,
        modelTags: data.modelTags,
        pricingClaims: data.pricingClaims || null,
        reviewStatus: GatewayReviewStatus.APPROVED,
        active: true,
        displayGroupId: data.displayGroupId || null,
        firstSeenAt: now,
        lastSeenAt: now,
        rawMetadata: { source: MANUAL_SOURCE_KEY, addedAt: now.toISOString() },
      },
      include: { displayGroup: true },
    });
    return publicGateway(item);
  }

  async updateManualGateway(id: string, input: unknown) {
    const data = parseManualGateway(input);
    if (data.displayGroupId) {
      const group = await this.prisma.gatewayDisplayGroup.findFirst({ where: { id: data.displayGroupId, active: true } });
      if (!group) throw new NotFoundException("展示分组不存在");
    }
    const current = await this.prisma.gatewayDirectoryEntry.findFirst({ where: { id, sourceKey: MANUAL_SOURCE_KEY } });
    if (!current) throw new NotFoundException("手动中转站不存在");
    const destination = new URL(data.url);
    const destinationHost = normalizedHost(destination.hostname, destination.href);
    const duplicate = await this.prisma.gatewayDirectoryEntry.findFirst({
      where: { destinationHost, id: { not: id } }, select: { name: true },
    });
    if (duplicate) throw new BadRequestException(`该域名已收录：${duplicate.name}`);
    return publicGateway(await this.prisma.gatewayDirectoryEntry.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        sourceRedirectUrl: destination.href,
        destinationUrl: destination.href,
        destinationHost,
        logoUrl: data.logoUrl || null,
        modelTags: data.modelTags,
        pricingClaims: data.pricingClaims || null,
        displayGroupId: data.displayGroupId || null,
        reviewStatus: GatewayReviewStatus.APPROVED,
        active: true,
        lastSeenAt: new Date(),
      },
      include: { displayGroup: true },
    }));
  }

  async rejectManualGateway(id: string) {
    const result = await this.prisma.gatewayDirectoryEntry.updateMany({
      where: { id, sourceKey: MANUAL_SOURCE_KEY },
      data: { reviewStatus: GatewayReviewStatus.REJECTED, active: false },
    });
    if (!result.count) throw new NotFoundException("手动中转站不存在");
    return { id, active: false };
  }

  async assignDisplayGroup(input: unknown) {
    const parsed = z.object({
      ids: z.array(z.string()).min(1).max(100),
      groupId: z.string().nullable(),
    }).safeParse(input);
    if (!parsed.success) throw new BadRequestException("请选择 1-100 个中转站并指定有效分组");
    const data = parsed.data;
    if (data.groupId) {
      const group = await this.prisma.gatewayDisplayGroup.findFirst({ where: { id: data.groupId, active: true } });
      if (!group) throw new NotFoundException("展示分组不存在");
    }
    const result = await this.prisma.gatewayDirectoryEntry.updateMany({
      where: { id: { in: data.ids } },
      data: { displayGroupId: data.groupId },
    });
    return { updated: result.count };
  }

  async setSchedule(input: unknown) {
    const current = await this.ensureScheduleSource();
    const { enabled, intervalMinutes } = parseGatewaySchedule(input);
    const source = await this.prisma.dataSource.update({
      where: { key: SOURCE_KEY },
      data: {
        enabled,
        pollIntervalSeconds: intervalMinutes * 60,
        lastCheckedAt: enabled && !current.lastCheckedAt ? new Date() : undefined,
      },
    });
    return gatewayScheduleView(source);
  }

  async decide(input: unknown) {
    const data = gatewayDecisionSchema.parse(input);
    const status = decisionStatus(data.action);
    const result = await this.prisma.gatewayDirectoryEntry.updateMany({
      where: { id: { in: data.ids } },
      data: {
        reviewStatus: status,
        active: status === GatewayReviewStatus.APPROVED,
      },
    });
    return { updated: result.count };
  }

  async toggleFeatured(id: string) {
    const item = await this.prisma.gatewayDirectoryEntry.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("中转站不存在");
    return this.prisma.gatewayDirectoryEntry.update({ where: { id }, data: { featured: !item.featured } });
  }

  async sync() {
    const source = await this.ensureScheduleSource();
    const running = await this.prisma.gatewayDirectorySyncRun.findFirst({
      where: { sourceKey: SOURCE_KEY, status: SyncStatus.RUNNING, startedAt: { gte: new Date(Date.now() - 2 * 60 * 60_000) } },
      orderBy: { startedAt: "desc" },
    });
    if (running) throw new BadRequestException("中转站目录正在同步，请稍后再试");
    const feedUrl = process.env.ZUIQUANAPI_FEED_URL?.trim();
    let mode = feedUrl ? "authorized-json-feed" : "public-next-flight";
    let completeFeed = Boolean(feedUrl);
    let sourceReportedTotal: number | null = null;
    const run = await this.prisma.gatewayDirectorySyncRun.create({ data: { sourceKey: SOURCE_KEY, mode, completeFeed: false } });
    try {
      const sourceResult = feedUrl
        ? { records: await this.fetchAuthorizedFeed(feedUrl), completeFeed: true, sourceReportedTotal: null }
        : await this.fetchHomepageDirectory();
      const records = sourceResult.records;
      completeFeed = sourceResult.completeFeed;
      sourceReportedTotal = sourceResult.sourceReportedTotal;
      if (!feedUrl && !completeFeed) mode = "public-homepage";
      if (!records.length) throw new BadRequestException("来源没有返回可同步的中转站");
      const displayGroups = await this.ensureDisplayGroups();
      const activeGroupIdsByKey = new Map(displayGroups.filter((group) => group.active).map((group) => [group.key, group.id]));
      const existing = await this.prisma.gatewayDirectoryEntry.findMany({
        where: { sourceKey: SOURCE_KEY, sourceSiteId: { in: records.map((record) => record.sourceSiteId) } },
        select: { sourceSiteId: true },
      });
      const existingIds = new Set(existing.map((item) => item.sourceSiteId));
      const now = new Date();
      let created = 0;
      let updated = 0;
      for (const batch of chunks(records, 100)) {
        await this.prisma.$transaction(batch.map((record) => {
          if (existingIds.has(record.sourceSiteId)) updated += 1;
          else created += 1;
          return this.prisma.gatewayDirectoryEntry.upsert({
            where: { sourceKey_sourceSiteId: { sourceKey: SOURCE_KEY, sourceSiteId: record.sourceSiteId } },
            create: {
              sourceKey: SOURCE_KEY,
              sourceSiteId: record.sourceSiteId,
              slug: `${SOURCE_KEY}-${record.sourceSiteId}`,
              ...entryData(record),
              displayGroupId: displayGroupIdForSourceSection(record.sourceSection, activeGroupIdsByKey),
              firstSeenAt: now,
              lastSeenAt: now,
            },
            update: {
              ...entryData(record),
              lastSeenAt: now,
              missingCount: 0,
            },
          });
        }));
      }
      let markedMissing = 0;
      if (completeFeed) {
        const missing = await this.prisma.gatewayDirectoryEntry.updateMany({
          where: { sourceKey: SOURCE_KEY, sourceSiteId: { notIn: records.map((record) => record.sourceSiteId) } },
          data: { missingCount: { increment: 1 } },
        });
        markedMissing = missing.count;
        await this.prisma.gatewayDirectoryEntry.updateMany({
          where: { sourceKey: SOURCE_KEY, missingCount: { gte: 3 } },
          data: { reviewStatus: GatewayReviewStatus.SOURCE_REMOVED, active: false },
        });
      }
      const counts = { fetched: records.length, sourceReportedTotal, created, updated, markedMissing };
      await this.prisma.gatewayDirectorySyncRun.update({
        where: { id: run.id },
        data: { status: SyncStatus.SUCCEEDED, mode, completeFeed, counts, finishedAt: new Date() },
      });
      await this.prisma.dataSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: new Date(), lastSuccessAt: new Date() },
      });
      return { runId: run.id, mode, completeFeed, ...counts };
    } catch (error) {
      await this.prisma.gatewayDirectorySyncRun.update({
        where: { id: run.id },
        data: { status: SyncStatus.FAILED, errorMessage: error instanceof Error ? error.message.slice(0, 2000) : String(error), finishedAt: new Date() },
      });
      await this.prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: new Date() } });
      throw error;
    }
  }

  async target(id: string) {
    const item = await this.prisma.gatewayDirectoryEntry.findFirst({
      where: { id, active: true, reviewStatus: GatewayReviewStatus.APPROVED },
    });
    if (!item) throw new NotFoundException("Gateway not found");
    const destination = new URL(item.sourceRedirectUrl);
    const trustedSource = item.sourceKey === SOURCE_KEY && destination.protocol === "https:" && ["zuiquanapi.com", "www.zuiquanapi.com"].includes(destination.hostname);
    const manualSource = item.sourceKey === MANUAL_SOURCE_KEY && isPublicGatewayUrl(destination.href);
    if (!trustedSource && !manualSource) {
      throw new NotFoundException("Unsafe gateway destination");
    }
    await this.prisma.outboundClick.create({
      data: { targetType: "gateway", targetId: item.id, destinationHost: destination.hostname },
    });
    return destination.href;
  }

  private ensureScheduleSource() {
    return this.prisma.dataSource.upsert({
      where: { key: SOURCE_KEY },
      create: {
        key: SOURCE_KEY,
        name: "中转站目录同步",
        kind: DataSourceKind.PUBLIC_DIRECTORY,
        baseUrl: SOURCE_ORIGIN,
        attributionUrl: SOURCE_ORIGIN,
        enabled: false,
        pollIntervalSeconds: DEFAULT_INTERVAL_MINUTES * 60,
        robotsReviewedAt: new Date(),
      },
      update: {
        name: "中转站目录同步",
        kind: DataSourceKind.PUBLIC_DIRECTORY,
        baseUrl: SOURCE_ORIGIN,
        attributionUrl: SOURCE_ORIGIN,
      },
    });
  }

  private async ensureDisplayGroups() {
    for (const group of DEFAULT_DISPLAY_GROUPS) {
      await this.prisma.gatewayDisplayGroup.upsert({
        where: { key: group.key },
        create: { ...group, active: true },
        update: {},
      });
    }
    return this.prisma.gatewayDisplayGroup.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { entries: true } } },
    });
  }

  private async fetchAuthorizedFeed(feedUrl: string) {
    const url = new URL(feedUrl);
    if (url.protocol !== "https:") throw new BadRequestException("ZUIQUANAPI_FEED_URL 必须使用 HTTPS");
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "AI-Card-Marketplace/1.0" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`授权 Feed 请求失败：HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    const rows = feedRows(payload);
    return dedupeSourceRows(rows.map((row) => normalizeFeedRow(row)).filter((row): row is SourceGateway => Boolean(row)));
  }

  private async fetchHomepageDirectory() {
    const [pageResponse, bootstrapResponse] = await Promise.all([
      fetch(SOURCE_ORIGIN, { headers: { accept: "text/html", "user-agent": "AI-Card-Marketplace/1.0" }, signal: AbortSignal.timeout(60_000) }),
      fetch(`${SOURCE_ORIGIN}/api/bootstrap`, { headers: { accept: "application/json", "user-agent": "AI-Card-Marketplace/1.0" }, signal: AbortSignal.timeout(60_000) }),
    ]);
    if (!pageResponse.ok) throw new Error(`来源首页请求失败：HTTP ${pageResponse.status}`);
    const html = await pageResponse.text();
    const bootstrap = bootstrapResponse.ok ? await bootstrapResponse.json() as BootstrapPayload : {};
    const featured = parseZuiquanHomepage(html, bootstrap);
    const flightSites = parseZuiquanFlightSites(html);
    const all = flightSites.map((site, index) => {
      if (!site || typeof site !== "object" || Array.isArray(site)) return null;
      const row = site as Record<string, unknown>;
      const sourceSiteId = stringValue(row.id);
      const vote = bootstrap.votes?.[sourceSiteId];
      const status = bootstrap.status?.[sourceSiteId];
      return normalizeFeedRow({
        ...row,
        sourceSection: "all",
        sourcePosition: index + 1,
        sourceRedirectUrl: `${SOURCE_ORIGIN}/go/${encodeURIComponent(sourceSiteId)}`,
        sponsored: row.has_active_sponsorship ?? row.is_promoted,
        online: status?.online,
        upVotes: vote?.up,
        downVotes: vote?.down,
        availability7d: status?.uptime,
        averageResponseMs: status?.avgMs,
        sourceUpdatedAt: status?.checkedAt,
      });
    }).filter((row): row is SourceGateway => Boolean(row));
    const records = mergeDirectoryRows(all, featured);
    const sourceReportedTotal = sourceDirectoryTotal(html);
    const completeFeed = flightSites.length >= 1000 && Boolean(!sourceReportedTotal || records.length >= sourceReportedTotal - 1);
    return { records, completeFeed, sourceReportedTotal };
  }
}

export function parseGatewaySchedule(input: unknown) {
  const body = input as { enabled?: unknown; intervalMinutes?: unknown };
  const enabled = body?.enabled;
  const intervalMinutes = Number(body?.intervalMinutes);
  if (typeof enabled !== "boolean") throw new BadRequestException("enabled 必须为布尔值");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440) {
    throw new BadRequestException("更新间隔必须为 30-1440 分钟的整数");
  }
  return { enabled, intervalMinutes };
}

function gatewayScheduleView<T extends { enabled: boolean; pollIntervalSeconds: number; lastCheckedAt: Date | null; lastSuccessAt: Date | null }>(source: T) {
  const nextRunAt = source.enabled
    ? new Date((source.lastCheckedAt?.getTime() || Date.now()) + source.pollIntervalSeconds * 1000)
    : null;
  return { enabled: source.enabled, intervalMinutes: Math.round(source.pollIntervalSeconds / 60), lastCheckedAt: source.lastCheckedAt, lastSuccessAt: source.lastSuccessAt, nextRunAt };
}

export function displayGroupKeyForSourceSection(sourceSection: string) {
  return SOURCE_SECTION_GROUP_KEYS[sourceSection] || null;
}

function displayGroupIdForSourceSection(sourceSection: string, activeGroupIdsByKey: ReadonlyMap<string, string>) {
  const key = displayGroupKeyForSourceSection(sourceSection);
  return key ? activeGroupIdsByKey.get(key) || null : null;
}

function entryData(record: SourceGateway) {
  return {
    name: record.name,
    description: record.description,
    sourceSection: record.sourceSection,
    sourcePosition: record.sourcePosition,
    sourceRedirectUrl: record.sourceRedirectUrl,
    destinationUrl: record.destinationUrl,
    destinationHost: record.destinationHost,
    providerType: record.providerType,
    logoUrl: record.logoUrl,
    sponsored: record.sponsored,
    online: record.online,
    upVotes: record.upVotes,
    downVotes: record.downVotes,
    availability7d: record.availability7d,
    averageResponseMs: record.averageResponseMs,
    modelTags: record.modelTags,
    pricingClaims: record.pricingClaims,
    sourceUpdatedAt: record.sourceUpdatedAt,
    rawMetadata: record.rawMetadata,
  };
}

type BootstrapPayload = {
  votes?: Record<string, { up?: number; down?: number }>;
  status?: Record<string, { online?: boolean; uptime?: number | null; avgMs?: number | null; checkedAt?: string }>;
};

export function parseZuiquanHomepage(html: string, bootstrap: BootstrapPayload): SourceGateway[] {
  const rows: SourceGateway[] = [];
  const pattern = /<a\b(?=[^>]*\bdata-site-id="([^"]+)")[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    const sourceSiteId = match[1];
    const body = match[2];
    const name = decodeHtml(firstMatch(body, /<p[^>]*class="[^"]*text-\[17px\][^"]*"[^>]*>([\s\S]*?)<\/p>/) || "");
    if (!name) continue;
    const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((item) => decodeHtml(stripTags(item[1]))).filter(Boolean);
    const sourceSection = attribute(opening, "data-analytics-section") || "all";
    const sourcePosition = nullableNumber(attribute(opening, "data-analytics-position"));
    const vote = bootstrap.votes?.[sourceSiteId];
    const status = bootstrap.status?.[sourceSiteId];
    const description = paragraphs.filter((value) => value !== name).at(-1) || "";
    rows.push({
      sourceSiteId,
      name,
      description,
      sourceSection,
      sourcePosition,
      sourceRedirectUrl: `${SOURCE_ORIGIN}/go/${encodeURIComponent(sourceSiteId)}`,
      destinationUrl: null,
      destinationHost: null,
      providerType: "第三方",
      logoUrl: safeHttpUrl(firstMatch(body, /<img[^>]+src="([^"]+)"/)),
      sponsored: body.includes(">赞助<"),
      online: typeof status?.online === "boolean" ? status.online : null,
      upVotes: integer(vote?.up),
      downVotes: integer(vote?.down),
      availability7d: nullableNumber(status?.uptime),
      averageResponseMs: nullableInteger(status?.avgMs),
      modelTags: inferModelTags(`${name} ${description}`),
      pricingClaims: inferPricingClaim(description),
      sourceUpdatedAt: safeDate(status?.checkedAt),
      rawMetadata: { source: "homepage", section: sourceSection },
    });
  }
  return dedupeSourceRows(rows);
}

export function parseZuiquanFlightSites(html: string): unknown[] {
  let flight = "";
  for (const match of html.matchAll(/<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const payload = JSON.parse(match[1]) as unknown;
      if (Array.isArray(payload) && payload[0] === 1 && typeof payload[1] === "string") flight += payload[1];
    } catch {
      continue;
    }
  }
  const candidates: unknown[][] = [];
  let cursor = 0;
  while ((cursor = flight.indexOf('"sites":[', cursor)) >= 0) {
    const start = flight.indexOf("[", cursor + 8);
    const json = start >= 0 ? balancedJsonArray(flight, start) : null;
    if (json) {
      try {
        const value = JSON.parse(json) as unknown;
        if (Array.isArray(value)) candidates.push(value);
      } catch {}
    }
    cursor += 9;
  }
  return candidates.sort((a, b) => b.length - a.length)[0] || [];
}

export function hourlyMonitorBuckets(payload: unknown, bucketCount = 48) {
  const rawChecks = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).checks
    : null;
  const checks = Array.isArray(rawChecks) ? rawChecks.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const checkedAt = safeDate(row.checkedAt);
    const online = nullableBoolean(row.online);
    if (!checkedAt || online === null) return null;
    return { checkedAt, online, responseMs: nullableInteger(row.ms) };
  }).filter((value): value is { checkedAt: Date; online: boolean; responseMs: number | null } => Boolean(value))
    .sort((left, right) => left.checkedAt.getTime() - right.checkedAt.getTime()) : [];
  const latestHour = new Date((checks.at(-1)?.checkedAt || new Date()).getTime());
  latestHour.setUTCMinutes(0, 0, 0);
  const byHour = new Map<number, (typeof checks)[number]>();
  for (const check of checks) {
    const hour = new Date(check.checkedAt);
    hour.setUTCMinutes(0, 0, 0);
    const current = byHour.get(hour.getTime());
    if (!current || current.checkedAt < check.checkedAt) byHour.set(hour.getTime(), check);
  }
  const count = Math.max(1, Math.min(Math.trunc(bucketCount), 168));
  const buckets = Array.from({ length: count }, (_, index) => {
    const startedAt = new Date(latestHour.getTime() - (count - index - 1) * 60 * 60_000);
    const check = byHour.get(startedAt.getTime());
    return {
      startedAt: startedAt.toISOString(),
      checkedAt: check?.checkedAt.toISOString() || null,
      online: check?.online ?? null,
      responseMs: check?.responseMs ?? null,
    };
  });
  return { source: SOURCE_KEY as "zuiquanapi", granularityMinutes: 60 as const, buckets };
}

function normalizeFeedRow(value: unknown): SourceGateway | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceSiteId = stringValue(row.sourceSiteId ?? row.siteId ?? row.id);
  const name = stringValue(row.name ?? row.title).slice(0, 200);
  if (!sourceSiteId || !name) return null;
  const destinationUrl = safeHttpUrl(stringValue(row.destinationUrl ?? row.url));
  const destinationHost = normalizedHost(stringValue(row.destinationHost ?? row.domain), destinationUrl);
  const description = stringValue(row.description ?? row.summary).slice(0, 4000);
  const sourceRedirectUrl = safeSourceRedirect(stringValue(row.sourceRedirectUrl ?? row.redirectUrl), sourceSiteId);
  const sourceSection = stringValue(row.sourceSection ?? row.section ?? row.subcategory_name) || "all";
  const sourceUpdatedAt = safeDate(row.sourceUpdatedAt ?? row.checked_at ?? row.checkedAt);
  return {
    sourceSiteId,
    name,
    description,
    sourceSection,
    sourcePosition: nullableInteger(row.sourcePosition ?? row.position),
    sourceRedirectUrl,
    destinationUrl,
    destinationHost,
    providerType: stringValue(row.providerType ?? row.tag) || "第三方",
    logoUrl: safeHttpUrl(stringValue(row.logoUrl ?? row.logo)),
    sponsored: booleanValue(row.sponsored ?? row.has_active_sponsorship ?? row.is_promoted),
    online: nullableBoolean(row.online),
    upVotes: integer(row.upVotes ?? row.up),
    downVotes: integer(row.downVotes ?? row.down),
    availability7d: nullableNumber(row.availability7d ?? row.uptime),
    averageResponseMs: nullableInteger(row.averageResponseMs ?? row.avg_ms ?? row.avgMs),
    modelTags: stringArray(row.modelTags ?? row.models).length ? stringArray(row.modelTags ?? row.models) : inferModelTags(`${name} ${description}`),
    pricingClaims: stringValue(row.pricingClaims) || inferPricingClaim(description),
    sourceUpdatedAt,
    rawMetadata: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
  };
}

function feedRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") throw new BadRequestException("授权 Feed 格式无效");
  const object = payload as Record<string, unknown>;
  for (const key of ["items", "results", "data", "gateways", "sites"]) if (Array.isArray(object[key])) return object[key] as unknown[];
  throw new BadRequestException("授权 Feed 未包含 items/results/data 数组");
}

function publicGateway(item: {
  id: string; sourceKey: string; slug: string; name: string; description: string; sourceSection: string; sourcePosition: number | null;
  sourceRedirectUrl: string; providerType: string; logoUrl: string | null; sponsored: boolean; online: boolean | null;
  upVotes: number; downVotes: number; availability7d: number | null; averageResponseMs: number | null; modelTags: string[];
  pricingClaims: string | null; featured: boolean; sourceUpdatedAt: Date | null; lastSeenAt: Date;
  displayGroup?: { id: string; key: string; name: string; position: number } | null;
}) {
  const { sourceKey, ...publicItem } = item;
  return {
    ...publicItem,
    monitoringAvailable: sourceKey === SOURCE_KEY,
    displayGroup: item.displayGroup || null,
    sourceUpdatedAt: item.sourceUpdatedAt?.toISOString() || null,
    lastSeenAt: item.lastSeenAt.toISOString(),
  };
}

export function parseManualGateway(input: unknown) {
  const parsed = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
    url: z.string().trim().url(),
    logoUrl: z.string().trim().url().or(z.literal("")).default(""),
    modelTags: z.union([z.array(z.string()), z.string()]).default([]),
    pricingClaims: z.string().trim().max(100).default(""),
    displayGroupId: z.string().trim().or(z.literal("")).nullable().default(null),
  }).safeParse(input);
  if (!parsed.success) throw new BadRequestException("请填写有效的中转站名称、HTTPS 官网和展示信息");
  if (!isPublicGatewayUrl(parsed.data.url)) throw new BadRequestException("中转站官网必须是公网 HTTPS 地址");
  if (parsed.data.logoUrl && !isPublicGatewayUrl(parsed.data.logoUrl)) throw new BadRequestException("Logo 必须是公网 HTTPS 地址");
  return {
    ...parsed.data,
    modelTags: stringArray(parsed.data.modelTags),
    displayGroupId: parsed.data.displayGroupId || null,
  };
}

export function isPublicGatewayUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (isIP(host) === 6) return false;
    if (isIP(host) === 4) {
      const [a, b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    }
    return true;
  } catch { return false; }
}

function gatewayOrder(sort: "featured" | "reputation" | "availability" | "newest"): Prisma.GatewayDirectoryEntryOrderByWithRelationInput[] {
  if (sort === "reputation") return [{ upVotes: "desc" }, { downVotes: "asc" }, { availability7d: "desc" }];
  if (sort === "availability") return [{ online: "desc" }, { availability7d: "desc" }, { averageResponseMs: "asc" }];
  if (sort === "newest") return [{ firstSeenAt: "desc" }];
  return [{ featured: "desc" }, { sponsored: "asc" }, { position: "asc" }, { availability7d: "desc" }, { upVotes: "desc" }];
}

function decisionStatus(action: "approve" | "reject" | "duplicate" | "source_removed") {
  if (action === "approve") return GatewayReviewStatus.APPROVED;
  if (action === "reject") return GatewayReviewStatus.REJECTED;
  if (action === "duplicate") return GatewayReviewStatus.DUPLICATE;
  return GatewayReviewStatus.SOURCE_REMOVED;
}
function adminStatus(value: unknown): GatewayReviewStatus | undefined {
  const key = typeof value === "string" ? value.toUpperCase() : "";
  return Object.values(GatewayReviewStatus).includes(key as GatewayReviewStatus) ? key as GatewayReviewStatus : undefined;
}
function reviewStatusValue(value: GatewayReviewStatus) { return value.toLocaleLowerCase("en-US"); }
function sectionOrder(value: string) { return ["premium-stable", "ultra-cheap", "special-featured", "new", "all", "fom"].indexOf(value) + 1 || 99; }
function positiveInt(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function mergeDirectoryRows(all: SourceGateway[], featured: SourceGateway[]) {
  const rows = new Map(all.map((row) => [row.sourceSiteId, row]));
  for (const row of featured) {
    const current = rows.get(row.sourceSiteId);
    rows.set(row.sourceSiteId, current ? {
      ...current,
      ...row,
      destinationUrl: current.destinationUrl,
      destinationHost: current.destinationHost,
      rawMetadata: current.rawMetadata,
    } : row);
  }
  return [...rows.values()];
}
function sourceDirectoryTotal(html: string) {
  const match = html.match(/>([\d,]+)<\/span><span[^>]*>个中转站已收录/);
  const total = Number(match?.[1].replace(/,/g, ""));
  return Number.isInteger(total) && total > 0 ? total : null;
}
function balancedJsonArray(value: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) return value.slice(start, index + 1);
  }
  return null;
}
function groupedCount(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const count = Number((value as Record<string, unknown>)[field]);
  return Number.isFinite(count) ? count : 0;
}
function chunks<T>(items: T[], size: number) { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function dedupeSourceRows(rows: SourceGateway[]) { return [...new Map(rows.map((row) => [row.sourceSiteId, row])).values()]; }
function attribute(html: string, name: string) { return decodeHtml(firstMatch(html, new RegExp(`${name}="([^"]*)"`)) || ""); }
function firstMatch(value: string, pattern: RegExp) { return pattern.exec(value)?.[1]; }
function stripTags(value: string) { return value.replace(/<[^>]+>/g, " "); }
function decodeHtml(value: string) {
  return value.replace(/<!--.*?-->/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, " ").trim();
}
function stringValue(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function integer(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0; }
function nullableInteger(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null; }
function nullableNumber(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function booleanValue(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
function nullableBoolean(value: unknown) { return value === null || value === undefined || value === "" ? null : booleanValue(value); }
function safeDate(value: unknown) { const date = new Date(stringValue(value)); return Number.isNaN(date.getTime()) ? null : date; }
function safeHttpUrl(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function safeSourceRedirect(value: string, sourceSiteId: string) {
  try {
    const url = new URL(value || `${SOURCE_ORIGIN}/go/${sourceSiteId}`, SOURCE_ORIGIN);
    if (url.protocol === "https:" && ["zuiquanapi.com", "www.zuiquanapi.com"].includes(url.hostname)) return url.href;
  } catch {}
  return `${SOURCE_ORIGIN}/go/${encodeURIComponent(sourceSiteId)}`;
}
function normalizedHost(rawHost: string, destinationUrl: string | null) {
  const clean = rawHost.toLocaleLowerCase("en-US").replace(/^www\./, "").replace(/\.$/, "");
  if (clean && /^[a-z0-9.-]+$/.test(clean)) return clean;
  if (!destinationUrl) return null;
  try { return new URL(destinationUrl).hostname.toLocaleLowerCase("en-US").replace(/^www\./, ""); } catch { return null; }
}
function stringArray(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，|/]/) : [];
  return [...new Set(values.map((item) => stringValue(item).toLocaleLowerCase("zh-CN")).filter(Boolean))].slice(0, 30);
}
function inferModelTags(value: string) {
  const models = ["gpt", "claude", "gemini", "deepseek", "qwen", "kimi", "grok", "codex", "sora", "midjourney"];
  const normalized = value.toLocaleLowerCase("zh-CN");
  return models.filter((model) => normalized.includes(model));
}
function inferPricingClaim(value: string) {
  const match = value.match(/(?:低至|最低|仅需|官方计费)?\s*\d+(?:\.\d+)?\s*(?:倍(?:率)?|折)/i);
  return match?.[0].replace(/\s+/g, "") || null;
}
function serializeRun(run: { id: string; status: SyncStatus; mode: string; completeFeed: boolean; counts: Prisma.JsonValue; errorMessage: string | null; startedAt: Date; finishedAt: Date | null }) {
  return { ...run, status: run.status.toLocaleLowerCase("en-US"), startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() || null };
}
