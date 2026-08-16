import { BadRequestException, Injectable } from "@nestjs/common";
import { BotPlatform, BotRuntimeStatus } from "@prisma/client";
import {
  botChatAllowlistInputSchema,
  botHeartbeatSchema,
  botIntegrationInputSchema,
  botPlatformSchema,
  botPreviewInputSchema,
  botQueryMetricInputSchema,
} from "@ai-card/contracts";
import { ZodError } from "zod";
import { PrismaService } from "./prisma.service";
import { MarketService } from "./market.service";

@Injectable()
export class BotService {
  constructor(private readonly prisma: PrismaService, private readonly market: MarketService) {}

  async overview() {
    const integrations = await this.ensureIntegrations();
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [queryCount24h, successful24h, duration, topKeywords] = await Promise.all([
      this.prisma.botQueryMetric.count({ where: { createdAt: { gte: since } } }),
      this.prisma.botQueryMetric.count({ where: { createdAt: { gte: since }, status: "success" } }),
      this.prisma.botQueryMetric.aggregate({ where: { createdAt: { gte: since } }, _avg: { durationMs: true } }),
      this.prisma.botQueryMetric.groupBy({
        by: ["keyword"], where: { createdAt: { gte: since } }, _count: { keyword: true },
        orderBy: { _count: { keyword: "desc" } }, take: 10,
      }),
    ]);
    return {
      integrations: integrations.map(toIntegration),
      metrics: {
        queryCount24h,
        successRate24h: queryCount24h ? Math.round(successful24h / queryCount24h * 1000) / 10 : 0,
        averageDurationMs24h: Math.round(duration._avg.durationMs || 0),
        topKeywords: topKeywords.map((item) => ({ keyword: item.keyword, count: item._count.keyword })),
      },
    };
  }

  async updateIntegration(rawPlatform: string, input: unknown) {
    const platform = parsePlatform(rawPlatform);
    const data = parse(() => botIntegrationInputSchema.parse(input));
    const integration = await this.prisma.botIntegration.upsert({
      where: { platform },
      create: { platform, enabled: data.enabled, runtimeStatus: data.enabled ? BotRuntimeStatus.WAITING_CONFIG : BotRuntimeStatus.DISABLED },
      update: { enabled: data.enabled, ...(!data.enabled ? { runtimeStatus: BotRuntimeStatus.DISABLED, lastError: null } : {}) },
    });
    return toIntegration(integration);
  }

  async chats(rawPlatform: string) {
    const platform = parsePlatform(rawPlatform);
    const records = await this.prisma.botChatAllowlist.findMany({ where: { platform }, orderBy: [{ active: "desc" }, { label: "asc" }] });
    return records.map(toChat);
  }

  async saveChat(rawPlatform: string, input: unknown) {
    const platform = parsePlatform(rawPlatform);
    const data = parse(() => botChatAllowlistInputSchema.parse(input));
    const record = await this.prisma.botChatAllowlist.upsert({
      where: { platform_externalChatId: { platform, externalChatId: data.externalChatId } },
      create: { platform, ...data }, update: { label: data.label, note: data.note, active: data.active },
    });
    return toChat(record);
  }

  async deleteChat(rawPlatform: string, id: string) {
    const platform = parsePlatform(rawPlatform);
    const result = await this.prisma.botChatAllowlist.deleteMany({ where: { id, platform } });
    return { deleted: result.count > 0 };
  }

  async preview(input: unknown) {
    const data = parse(() => botPreviewInputSchema.parse(input));
    const page = await this.market.offers({ q: data.q, page: data.page, pageSize: 10, sort: "price_asc" });
    return {
      query: data.q, total: page.total, page: page.page, totalPages: page.totalPages,
      items: page.items.map((item) => ({
        productSlug: item.productSlug, productName: item.productName, lowestPrice: item.lowestPrice,
        offerCount: item.offerCount, inStockOfferCount: item.inStockOfferCount,
      })),
    };
  }

  async internalConfig(rawPlatform: string) {
    const platform = parsePlatform(rawPlatform);
    const integration = await this.prisma.botIntegration.upsert({
      where: { platform }, create: { platform }, update: {},
    });
    return { platform: platform.toLowerCase(), enabled: integration.enabled };
  }

  async isChatAllowed(rawPlatform: string, externalChatId: string) {
    const platform = parsePlatform(rawPlatform);
    const chat = await this.prisma.botChatAllowlist.findUnique({ where: { platform_externalChatId: { platform, externalChatId } } });
    return { allowed: Boolean(chat?.active), label: chat?.label || null };
  }

  async heartbeat(rawPlatform: string, input: unknown) {
    const platform = parsePlatform(rawPlatform);
    const data = parse(() => botHeartbeatSchema.parse(input));
    const integration = await this.prisma.botIntegration.upsert({
      where: { platform },
      create: {
        platform, configured: data.configured, runtimeStatus: toRuntimeStatus(data.runtimeStatus),
        botUsername: data.botUsername ?? null, lastError: data.lastError ?? null, lastHeartbeatAt: new Date(),
      },
      update: {
        configured: data.configured, runtimeStatus: toRuntimeStatus(data.runtimeStatus),
        botUsername: data.botUsername ?? null, lastError: data.lastError ?? null, lastHeartbeatAt: new Date(),
      },
    });
    return toIntegration(integration);
  }

  async recordMetric(rawPlatform: string, input: unknown) {
    const platform = parsePlatform(rawPlatform);
    const data = parse(() => botQueryMetricInputSchema.parse(input));
    await this.prisma.botQueryMetric.create({ data: { platform, ...data } });
    return { accepted: true };
  }

  private ensureIntegrations() {
    return this.prisma.$transaction([
      this.prisma.botIntegration.upsert({ where: { platform: BotPlatform.TELEGRAM }, create: { platform: BotPlatform.TELEGRAM }, update: {} }),
      this.prisma.botIntegration.upsert({ where: { platform: BotPlatform.QQ }, create: { platform: BotPlatform.QQ }, update: {} }),
    ]);
  }
}

function parsePlatform(value: string) {
  const parsed = parse(() => botPlatformSchema.parse(value.toLowerCase()));
  return parsed === "telegram" ? BotPlatform.TELEGRAM : BotPlatform.QQ;
}

function toRuntimeStatus(value: string) {
  return BotRuntimeStatus[value.toUpperCase() as keyof typeof BotRuntimeStatus];
}

function toIntegration(record: { platform: BotPlatform; enabled: boolean; configured: boolean; runtimeStatus: BotRuntimeStatus; botUsername: string | null; lastHeartbeatAt: Date | null; lastError: string | null; updatedAt: Date }) {
  return {
    platform: record.platform.toLowerCase(), enabled: record.enabled, configured: record.configured,
    effectiveEnabled: record.enabled && record.configured && record.runtimeStatus === BotRuntimeStatus.RUNNING,
    runtimeStatus: record.runtimeStatus.toLowerCase(), botUsername: record.botUsername,
    lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() || null, lastError: record.lastError,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toChat(record: { id: string; platform: BotPlatform; externalChatId: string; label: string; note: string; active: boolean; createdAt: Date; updatedAt: Date }) {
  return { ...record, platform: record.platform.toLowerCase(), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function parse<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof ZodError) throw new BadRequestException(error.flatten());
    throw error;
  }
}
