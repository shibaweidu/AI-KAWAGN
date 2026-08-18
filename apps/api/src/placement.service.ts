import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ManagedListingType, SponsorAdKind, SponsorPlacementCampaignStatus, SponsorPlacementOrderStatus, SponsorPlacementSlotKind, Prisma, SponsorAdStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { ObjectStoreService } from "./object-store.service";
import { decryptSecret, encryptSecret } from "./gateway-probe.service";

const GATEWAY_SLOT_KEYS = ["gateway", "home_left", "home_right", "home_bottom"] as const;
const slotKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, "投放位置 Key 格式无效");
const slotKindSchema = z.enum(["gateway", "shop"]);
const slotInput = z.object({ key: slotKeySchema, days: z.coerce.number().int().min(1).max(365) });
const quoteInput = z.object({ items: z.array(slotInput).min(1).max(20) });
const paymentConfigInput = z.object({
  apiUrl: z.string().trim().max(500).refine((value) => !value || (() => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } })(), "易支付接口地址必须是 HTTPS URL").default(""),
  pid: z.string().trim().max(100).default(""),
  key: z.string().trim().max(300).optional().default(""),
  type: z.string().trim().min(1).max(50).default("alipay"),
  orderTimeoutMinutes: z.coerce.number().int().min(5).max(1440).default(30),
  clearKey: z.boolean().optional().default(false),
});
type PaymentRuntimeConfig = { apiUrl: string | null; pid: string | null; key: string | null; type: string; orderTimeoutMinutes: number };
const adInput = z.object({
  title: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(5000),
  url: z.string().trim().url().refine((value) => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; }, "仅支持无账号密码的 HTTPS 落地页"),
  badge: z.string().trim().max(30).optional().default(""),
  modelTags: z.string().trim().max(500).optional().default(""), pricingClaims: z.string().trim().max(200).optional().default(""),
  imageUrl: z.string().trim().refine((value) => !value || (() => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } })(), "仅支持无账号密码的 HTTPS 图片 URL").optional().default(""),
});

const slotDefaults: Array<{ key: string; kind: SponsorPlacementSlotKind; name: string; description: string; dailyPrice: number; position: number; capacity: number }> = [
  { key: "gateway", kind: SponsorPlacementSlotKind.GATEWAY, name: "中转站目录", description: "展示在中转站赞助商目录", dailyPrice: 20, position: 0, capacity: 10 },
  { key: "home_left", kind: SponsorPlacementSlotKind.GATEWAY, name: "首页左侧", description: "首页左侧固定广告位", dailyPrice: 10, position: 1, capacity: 1 },
  { key: "home_right", kind: SponsorPlacementSlotKind.GATEWAY, name: "首页右侧", description: "首页右侧固定广告位", dailyPrice: 10, position: 2, capacity: 1 },
  { key: "home_bottom", kind: SponsorPlacementSlotKind.GATEWAY, name: "首页底部", description: "首页底部赞助商区域", dailyPrice: 15, position: 3, capacity: 10 },
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `shop_${index + 1}`,
    kind: SponsorPlacementSlotKind.SHOP,
    name: `店铺赞助位 ${index + 1}`,
    description: "展示在全部店铺页面搜索区域下方",
    dailyPrice: 10,
    position: index,
    capacity: 1,
  })),
];

@Injectable()
export class PlacementService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly objects: ObjectStoreService) {}
  onModuleInit() { this.cleanupTimer = setInterval(() => void this.cleanupExpired().catch(() => undefined), 10 * 60_000); this.cleanupTimer.unref(); }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  async slots(kindInput: unknown = "gateway") {
    await this.ensureSlots();
    const kind = slotKindSchema.parse(String(kindInput || "gateway"));
    const dbKind = kind === "shop" ? SponsorPlacementSlotKind.SHOP : SponsorPlacementSlotKind.GATEWAY;
    const configs = await this.prisma.sponsorPlacementSlotConfig.findMany({ where: { enabled: true, kind: dbKind }, orderBy: [{ position: "asc" }, { key: "asc" }] });
    const now = new Date();
    return Promise.all(configs.map(async (slot) => {
      const used = await this.activeCount(slot.key, now, new Date(now.getTime() + 24 * 60 * 60_000)) + await this.manualOccupancy(slot.key);
      return {
        key: slot.key, kind, name: slot.name, description: slot.description, dailyPrice: slot.dailyPrice.toNumber(), minDays: slot.minDays, maxDays: slot.maxDays, capacity: slot.capacity,
        used, available: used < slot.capacity,
      };
    }));
  }

  async quote(input: unknown) {
    await this.ensureSlots();
    const parsed = quoteInput.parse(input);
    const unique = new Map<string, z.infer<typeof slotInput>>();
    parsed.items.forEach((item) => unique.set(item.key, item));
    if (unique.size !== parsed.items.length) throw new BadRequestException("投放位置不能重复");
    const configs = await this.prisma.sponsorPlacementSlotConfig.findMany({ where: { key: { in: [...unique.keys()] }, enabled: true } });
    if (configs.length !== unique.size) throw new BadRequestException("所选投放位置当前不可用");
    const kinds = new Set(configs.map((config) => config.kind));
    if (kinds.size !== 1) throw new BadRequestException("一个订单不能混合中转广告和店铺广告位");
    const items = configs.sort((a, b) => a.position - b.position).map((slot) => {
      const days = unique.get(slot.key)!.days;
      if (days < slot.minDays || days > slot.maxDays) throw new BadRequestException(`${slot.name}投放天数需为 ${slot.minDays}-${slot.maxDays} 天`);
      const subtotal = slot.dailyPrice.mul(days);
      return { key: slot.key, name: slot.name, days, dailyPrice: slot.dailyPrice.toNumber(), subtotal: subtotal.toNumber(), minDays: slot.minDays, maxDays: slot.maxDays };
    });
    return { items, total: items.reduce((sum, item) => sum + item.subtotal, 0) };
  }

  async createOrder(userId: string, input: unknown, image?: Express.Multer.File) {
    const parsed = adInput.parse(input);
    if (!image && !parsed.imageUrl) throw new BadRequestException("请上传广告图片或填写 HTTPS 图片 URL");
    const rawItems = parseItems(input);
    const quote = await this.quote({ items: rawItems });
    await this.assertAvailability(rawItems);
    let imageObjectKey: string | null = null;
    try {
      if (image) {
        validateImage(image, 5 * 1024 * 1024);
        imageObjectKey = await this.objects.put(`sponsor-ads/${userId}/${randomUUID()}.${extension(image.mimetype)}`, image.buffer, image.mimetype);
      }
      const paymentConfig = await this.paymentRuntimeConfig();
      const orderNo = `PA${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 6).toUpperCase()}`;
      const configs = await this.prisma.sponsorPlacementSlotConfig.findMany({ where: { key: { in: rawItems.map((item) => item.key) } } });
      const ad = await this.prisma.sponsorAd.create({ data: {
        userId, kind: configs[0]?.kind === SponsorPlacementSlotKind.SHOP ? SponsorAdKind.SHOP : SponsorAdKind.GATEWAY, title: parsed.title, description: parsed.description, url: parsed.url, badge: parsed.badge || null,
        modelTags: parseTags(parsed.modelTags), pricingClaims: parsed.pricingClaims || null, imageUrl: imageObjectKey ? null : parsed.imageUrl || null, imageObjectKey,
        status: SponsorAdStatus.PENDING_PAYMENT,
      } });
      const configMap = new Map(configs.map((item) => [item.key, item]));
      const order = await this.prisma.sponsorPlacementOrder.create({ data: {
        orderNo, userId, sponsorAdId: ad.id, totalAmount: new Prisma.Decimal(quote.total), paymentChannel: "yipay",
        expiresAt: new Date(Date.now() + paymentConfig.orderTimeoutMinutes * 60_000),
        items: { create: quote.items.map((item) => ({ slotKey: item.key, slotConfigId: configMap.get(item.key)!.id, dailyPrice: item.dailyPrice, days: item.days, subtotal: item.subtotal })) },
      }, include: { items: true } });
      return { order: this.publicOrder(order), paymentUrl: this.paymentUrl(order.orderNo, quote.total, parsed.title, paymentConfig) };
    } catch (error) {
      if (imageObjectKey) await this.objects.remove(imageObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async listOrders(userId: string) {
    await this.cleanupExpiredOrders(userId);
    const orders = await this.prisma.sponsorPlacementOrder.findMany({ where: { userId }, include: { sponsorAd: true, items: { include: { slotConfig: true } } }, orderBy: { createdAt: "desc" } });
    return orders.map((order) => this.publicOrder(order));
  }

  async getOrder(userId: string, id: string) {
    await this.cleanupExpiredOrders(userId);
    const order = await this.prisma.sponsorPlacementOrder.findFirst({ where: { id, userId }, include: { sponsorAd: true, items: { include: { slotConfig: true } }, campaigns: true } });
    if (!order) throw new NotFoundException("订单不存在");
    return this.publicOrder(order);
  }

  async accountOverview(userId: string) {
    await this.cleanupExpiredOrders(userId);
    const orders = await this.prisma.sponsorPlacementOrder.findMany({
      where: { userId },
      include: { sponsorAd: true, items: { include: { slotConfig: true } } },
      orderBy: { createdAt: "desc" },
    });
    const statuses = orders.reduce<Record<string, number>>((counts, order) => {
      const key = String(order.status).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const now = new Date();
    const activeCampaigns = await this.prisma.sponsorPlacementCampaign.count({ where: { order: { userId }, status: SponsorPlacementCampaignStatus.RUNNING, startsAt: { lte: now }, endsAt: { gt: now } } });
    return {
      metrics: {
        ads: new Set(orders.map((order) => order.sponsorAdId)).size,
        pendingPayment: (statuses.pending_payment || 0) + (statuses.payment_processing || 0),
        pendingReview: statuses.paid_pending_review || 0,
        activeCampaigns,
        finished: (statuses.refunded || 0) + (statuses.cancelled || 0) + orders.filter((order) => order.status === SponsorPlacementOrderStatus.APPROVED && order.items.every((item) => item.endsAt && item.endsAt <= now)).length,
      },
      recentOrders: orders.slice(0, 5).map((order) => this.publicOrder(order)),
    };
  }

  async notifyPayment(input: Record<string, unknown>) {
    const orderNo = String(input.out_trade_no || input.orderNo || "");
    const tradeStatus = String(input.trade_status || input.status || "");
    const amount = Number(input.money || input.amount || 0);
    const paymentConfig = await this.paymentRuntimeConfig();
    if (!orderNo || !this.verifyPayment(input, paymentConfig.key)) throw new BadRequestException("支付通知签名无效");
    const order = await this.prisma.sponsorPlacementOrder.findUnique({ where: { orderNo }, include: { user: { select: { disabledAt: true } } } });
    if (!order) throw new NotFoundException("订单不存在");
    if (order.status === SponsorPlacementOrderStatus.PAID_PENDING_REVIEW || order.status === SponsorPlacementOrderStatus.APPROVED) return "success";
    if (Math.abs(order.totalAmount.toNumber() - amount) > 0.01) throw new BadRequestException("支付金额不匹配");
    if (!["TRADE_SUCCESS", "TRADE_FINISHED", "success", "SUCCESS"].includes(tradeStatus)) return "success";
    if (order.user.disabledAt) {
      await this.prisma.sponsorPlacementOrder.update({ where: { id: order.id }, data: { status: SponsorPlacementOrderStatus.REFUND_PENDING, paidAt: new Date(), paymentNotifiedAt: new Date(), transactionId: String(input.trade_no || input.transactionId || "") || null, reviewNote: "付款完成时用户账号已停用，请人工退款" } });
      return "success";
    }
    await this.prisma.$transaction([
      this.prisma.sponsorPlacementOrder.update({ where: { id: order.id }, data: { status: SponsorPlacementOrderStatus.PAID_PENDING_REVIEW, paidAt: new Date(), paymentNotifiedAt: new Date(), transactionId: String(input.trade_no || input.transactionId || "") || null } }),
      this.prisma.sponsorAd.update({ where: { id: order.sponsorAdId }, data: { status: SponsorAdStatus.PAID_PENDING_REVIEW } }),
    ]);
    return "success";
  }

  async adminConfig() { await this.ensureSlots(); const items = await this.prisma.sponsorPlacementSlotConfig.findMany({ orderBy: [{ kind: "asc" }, { position: "asc" }, { key: "asc" }] }); return items.map((item) => ({ ...item, kind: item.kind === SponsorPlacementSlotKind.SHOP ? "shop" as const : "gateway" as const, dailyPrice: item.dailyPrice.toNumber() })); }

  async paymentConfig() {
    const configStore = (this.prisma as any).paymentProviderConfig;
    const stored = configStore ? await configStore.findUnique({ where: { id: "yipay" } }) : null;
    const apiUrl = stored ? stored.apiUrl : process.env.YIPAY_API_URL?.trim() || null;
    const pid = stored ? stored.pid : process.env.YIPAY_PID?.trim() || null;
    const keyConfigured = stored ? Boolean(stored.keyCiphertext) : Boolean(process.env.YIPAY_KEY?.trim());
    const type = stored?.type || process.env.YIPAY_TYPE?.trim() || "alipay";
    const orderTimeoutMinutes = stored?.orderTimeoutMinutes || 30;
    const apiOrigin = process.env.PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000/v1";
    const webOrigin = process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
    return {
      configured: Boolean(apiUrl && pid && keyConfigured),
      apiUrl,
      pid,
      type,
      keyConfigured,
      keyLastFour: stored ? stored.keyLastFour : (process.env.YIPAY_KEY?.trim().slice(-4) || null),
      orderTimeoutMinutes,
      notifyUrl: `${apiOrigin}/payment/yipay/notify`,
      returnUrl: `${webOrigin}/account/orders`,
      missing: [
        !apiUrl ? "YIPAY_API_URL" : null,
        !pid ? "YIPAY_PID" : null,
        !keyConfigured ? "YIPAY_KEY" : null,
      ].filter((item): item is string => Boolean(item)),
    };
  }

  async savePaymentConfig(input: unknown) {
    const parsed = paymentConfigInput.parse(input);
    const configStore = (this.prisma as any).paymentProviderConfig;
    if (!configStore) throw new BadRequestException("支付配置存储不可用，请先执行数据库迁移");
    const existing = await configStore.findUnique({ where: { id: "yipay" } });
    let keyCiphertext = existing?.keyCiphertext || null;
    let keyLastFour = existing?.keyLastFour || null;
    if (parsed.clearKey) {
      keyCiphertext = null;
      keyLastFour = null;
    } else if (parsed.key) {
      try { keyCiphertext = encryptSecret(parsed.key); } catch { throw new BadRequestException("支付密钥加密失败，请先配置 GATEWAY_PROBE_ENCRYPTION_KEY"); }
      keyLastFour = parsed.key.slice(-4);
    } else if (!existing && process.env.YIPAY_KEY?.trim()) {
      try { keyCiphertext = encryptSecret(process.env.YIPAY_KEY.trim()); } catch { throw new BadRequestException("支付密钥加密失败，请先配置 GATEWAY_PROBE_ENCRYPTION_KEY"); }
      keyLastFour = process.env.YIPAY_KEY.trim().slice(-4);
    }
    await configStore.upsert({
      where: { id: "yipay" },
      create: { id: "yipay", apiUrl: parsed.apiUrl || null, pid: parsed.pid || null, keyCiphertext, keyLastFour, type: parsed.type, orderTimeoutMinutes: parsed.orderTimeoutMinutes },
      update: { apiUrl: parsed.apiUrl || null, pid: parsed.pid || null, keyCiphertext, keyLastFour, type: parsed.type, orderTimeoutMinutes: parsed.orderTimeoutMinutes },
    });
    return this.paymentConfig();
  }

  async continuePayment(userId: string, id: string) {
    const order = await this.prisma.sponsorPlacementOrder.findFirst({ where: { id, userId }, include: { sponsorAd: true, items: { include: { slotConfig: true } } } });
    if (!order) throw new NotFoundException("订单不存在");
    if (order.status !== SponsorPlacementOrderStatus.PENDING_PAYMENT && order.status !== SponsorPlacementOrderStatus.PAYMENT_PROCESSING) throw new BadRequestException("当前订单不能继续付款");
    if (order.expiresAt && order.expiresAt <= new Date()) {
      await this.cancelExpiredOrder(order.id, order.sponsorAdId);
      throw new BadRequestException("订单已超过付款时间，请重新创建订单");
    }
    const config = await this.paymentRuntimeConfig();
    const paymentUrl = this.paymentUrl(order.orderNo, order.totalAmount.toNumber(), order.sponsorAd.title, config);
    if (!paymentUrl) throw new BadRequestException("易支付尚未配置完整，请联系管理员");
    return { order: this.publicOrder(order), paymentUrl, expiresAt: order.expiresAt?.toISOString() || null };
  }

  async saveAdminConfig(input: unknown) {
    const items = z.array(z.object({ key: slotKeySchema, kind: slotKindSchema.default("gateway"), name: z.string().trim().min(1).max(50), description: z.string().trim().max(200).default(""), dailyPrice: z.coerce.number().min(0).max(1_000_000), minDays: z.coerce.number().int().min(1).max(365), maxDays: z.coerce.number().int().min(1).max(365), capacity: z.coerce.number().int().min(1).max(1000), enabled: z.coerce.boolean(), position: z.coerce.number().int().min(0).max(1000) })).min(1).max(100).parse(input);
    if (new Set(items.map((item) => item.key)).size !== items.length) throw new BadRequestException("投放位置 Key 不能重复");
    for (const item of items) {
      if (item.maxDays < item.minDays) throw new BadRequestException("最大天数不能小于最小天数");
      if (GATEWAY_SLOT_KEYS.includes(item.key as typeof GATEWAY_SLOT_KEYS[number]) && item.kind !== "gateway") throw new BadRequestException(`${item.key} 必须保持为中转广告位`);
      const kind = item.kind === "shop" ? SponsorPlacementSlotKind.SHOP : SponsorPlacementSlotKind.GATEWAY;
      const data = { ...item, kind, dailyPrice: item.dailyPrice };
      await this.prisma.sponsorPlacementSlotConfig.upsert({ where: { key: item.key }, create: data, update: data });
    }
    return this.adminConfig();
  }

  async adminOrders() { const orders = await this.prisma.sponsorPlacementOrder.findMany({ include: { user: { select: { id: true, email: true } }, sponsorAd: true, items: { include: { slotConfig: true } } }, orderBy: { createdAt: "desc" } }); return orders.map((order) => ({ ...this.publicOrder(order), user: order.user, transactionId: order.transactionId })); }

  async approve(id: string, reviewerId: string, note?: string) {
    const order = await this.prisma.sponsorPlacementOrder.findUnique({ where: { id }, include: { sponsorAd: true, items: { include: { slotConfig: true } } } });
    if (!order || order.status !== SponsorPlacementOrderStatus.PAID_PENDING_REVIEW) throw new BadRequestException("订单不在待审核状态");
    await this.assertAvailability(order.items.map((item) => ({ key: item.slotKey, days: item.days })));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const listing = order.sponsorAd.kind === SponsorAdKind.GATEWAY ? await tx.managedListing.create({ data: { type: ManagedListingType.GATEWAY, title: order.sponsorAd.title, description: order.sponsorAd.description, url: order.sponsorAd.url, thumbnailUrl: order.sponsorAd.imageUrl, thumbnailObjectKey: order.sponsorAd.imageObjectKey, badge: order.sponsorAd.badge, modelTags: order.sponsorAd.modelTags, pricingClaims: order.sponsorAd.pricingClaims, ownerUserId: order.userId, gatewayPlacement: order.items.some((item) => item.slotKey === "gateway"), homeSideSlot: order.items.some((item) => item.slotKey === "home_left") ? "LEFT" : order.items.some((item) => item.slotKey === "home_right") ? "RIGHT" : null, homeBottomPlacement: order.items.some((item) => item.slotKey === "home_bottom"), active: true, position: 0 } }) : null;
      await tx.sponsorPlacementOrder.update({ where: { id }, data: { status: SponsorPlacementOrderStatus.APPROVED, reviewedById: reviewerId, reviewedAt: now, reviewNote: note || null } });
      await tx.sponsorAd.update({ where: { id: order.sponsorAdId }, data: { status: SponsorAdStatus.APPROVED, reviewedById: reviewerId, reviewedAt: now, managedListingId: listing?.id || null } });
      for (const item of order.items) { const end = new Date(now.getTime() + item.days * 86400_000); await tx.sponsorPlacementOrderItem.update({ where: { id: item.id }, data: { startsAt: now, endsAt: end } }); await tx.sponsorPlacementCampaign.create({ data: { orderId: id, orderItemId: item.id, managedListingId: listing?.id || null, slotKey: item.slotKey, startsAt: now, endsAt: end, status: SponsorPlacementCampaignStatus.RUNNING } }); }
    });
    return this.getAdminOrder(id);
  }

  async reject(id: string, reviewerId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("请填写驳回原因");
    const order = await this.prisma.sponsorPlacementOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("订单不存在");
    await this.prisma.$transaction([this.prisma.sponsorPlacementOrder.update({ where: { id }, data: { status: SponsorPlacementOrderStatus.REFUND_PENDING, reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: reason.trim() } }), this.prisma.sponsorAd.update({ where: { id: order.sponsorAdId }, data: { status: SponsorAdStatus.REJECTED, rejectionReason: reason.trim(), reviewedById: reviewerId, reviewedAt: new Date() } })]);
    return this.getAdminOrder(id);
  }

  async refund(id: string, reviewerId: string) { const order = await this.prisma.sponsorPlacementOrder.update({ where: { id }, data: { status: SponsorPlacementOrderStatus.REFUNDED, reviewedById: reviewerId } }); return this.publicOrder(order); }
  async getAdminOrder(id: string) { const order = await this.prisma.sponsorPlacementOrder.findUnique({ where: { id }, include: { user: { select: { email: true } }, sponsorAd: true, items: { include: { slotConfig: true } }, campaigns: true } }); if (!order) throw new NotFoundException("订单不存在"); return this.publicOrder(order); }

  async cleanupExpired() {
    const now = new Date();
    const result = await this.prisma.sponsorPlacementCampaign.updateMany({ where: { endsAt: { lt: now }, status: { in: [SponsorPlacementCampaignStatus.RUNNING, SponsorPlacementCampaignStatus.SCHEDULED] } }, data: { status: SponsorPlacementCampaignStatus.EXPIRED } });
    const unpaidExpired = await this.cleanupExpiredOrders();
    return { expired: result.count, unpaidExpired };
  }

  async asset(id: string) { const ad = await this.prisma.sponsorAd.findUnique({ where: { id }, select: { imageObjectKey: true } }); if (!ad?.imageObjectKey) throw new NotFoundException("广告图片不存在"); return this.objects.getBinary(ad.imageObjectKey); }

  private async ensureSlots() { for (const slot of slotDefaults) await this.prisma.sponsorPlacementSlotConfig.upsert({ where: { key: slot.key }, create: { ...slot, dailyPrice: slot.dailyPrice }, update: {} }); }
  private async activeCount(key: string, starts: Date, ends: Date) { return this.prisma.sponsorPlacementCampaign.count({ where: { slotKey: key, status: { in: [SponsorPlacementCampaignStatus.SCHEDULED, SponsorPlacementCampaignStatus.RUNNING] }, startsAt: { lt: ends }, endsAt: { gt: starts } } }); }
  private async manualOccupancy(key: string) {
    if (key === "gateway") return this.prisma.managedListing.count({ where: { active: true, sponsorAd: { is: null }, gatewayPlacement: true } });
    if (key === "home_bottom") return this.prisma.managedListing.count({ where: { active: true, sponsorAd: { is: null }, homeBottomPlacement: true } });
    if (key === "home_left") return this.prisma.managedListing.count({ where: { active: true, sponsorAd: { is: null }, homeSideSlot: "LEFT" } });
    if (key === "home_right") return this.prisma.managedListing.count({ where: { active: true, sponsorAd: { is: null }, homeSideSlot: "RIGHT" } });
    return 0;
  }
  private async assertAvailability(items: Array<{ key: string; days: number }>) {
    const now = new Date();
    const configs = await this.prisma.sponsorPlacementSlotConfig.findMany({ where: { key: { in: items.map((item) => item.key) }, enabled: true } });
    if (configs.length !== items.length) throw new BadRequestException("所选投放位置当前不可用");
    const itemByKey = new Map(items.map((item) => [item.key, item]));
    for (const config of configs) {
      const item = itemByKey.get(config.key)!;
      const end = new Date(now.getTime() + item.days * 86400_000);
      if (await this.activeCount(config.key, now, end) + await this.manualOccupancy(config.key) >= config.capacity) throw new ConflictException(config.name + "当前无可用广告位");
    }
  }
  private publicOrder(order: any) {
    const ad = order.sponsorAd;
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: String(order.status).toLowerCase(),
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt?.toISOString?.() || order.createdAt,
      expiresAt: order.expiresAt?.toISOString?.() || null,
      canContinuePayment: [SponsorPlacementOrderStatus.PENDING_PAYMENT, SponsorPlacementOrderStatus.PAYMENT_PROCESSING].includes(order.status) && (!order.expiresAt || order.expiresAt > new Date()),
      paidAt: order.paidAt?.toISOString?.() || null,
      reviewedAt: order.reviewedAt?.toISOString?.() || null,
      reviewNote: order.reviewNote || null,
      sponsorAd: ad ? {
        id: ad.id,
        title: ad.title,
        description: ad.description,
        url: ad.url,
        badge: ad.badge,
        modelTags: ad.modelTags,
        pricingClaims: ad.pricingClaims,
        imageUrl: ad.imageObjectKey ? `/api/v1/assets/placements/${ad.id}` : ad.imageUrl,
         kind: String(ad.kind).toLowerCase(),
         status: String(ad.status).toLowerCase(),
        rejectionReason: ad.rejectionReason || null,
      } : undefined,
      items: (order.items || []).map((item: any) => ({
         key: item.slotKey,
         slotKey: item.slotKey,
         name: item.slotConfig?.name || item.slotKey,
         kind: item.slotConfig?.kind === SponsorPlacementSlotKind.SHOP ? "shop" : "gateway",
        days: item.days,
        dailyPrice: Number(item.dailyPrice),
        subtotal: Number(item.subtotal),
        startsAt: item.startsAt?.toISOString?.() || null,
        endsAt: item.endsAt?.toISOString?.() || null,
      })),
    };
  }
  private async cleanupExpiredOrders(userId?: string) {
    const expired = await this.prisma.sponsorPlacementOrder.findMany({
      where: { ...(userId ? { userId } : {}), status: { in: [SponsorPlacementOrderStatus.PENDING_PAYMENT, SponsorPlacementOrderStatus.PAYMENT_PROCESSING] }, expiresAt: { lt: new Date() } },
      select: { id: true, sponsorAdId: true },
    });
    if (!expired.length) return 0;
    await this.prisma.$transaction([
      this.prisma.sponsorPlacementOrder.updateMany({ where: { id: { in: expired.map((order) => order.id) }, status: { in: [SponsorPlacementOrderStatus.PENDING_PAYMENT, SponsorPlacementOrderStatus.PAYMENT_PROCESSING] } }, data: { status: SponsorPlacementOrderStatus.CANCELLED, reviewNote: "订单支付超时自动取消" } }),
      this.prisma.sponsorAd.updateMany({ where: { id: { in: expired.map((order) => order.sponsorAdId) }, status: SponsorAdStatus.PENDING_PAYMENT }, data: { status: SponsorAdStatus.CANCELLED } }),
    ]);
    return expired.length;
  }
  private async cancelExpiredOrder(id: string, sponsorAdId: string) {
    await this.prisma.$transaction([
      this.prisma.sponsorPlacementOrder.updateMany({ where: { id, status: { in: [SponsorPlacementOrderStatus.PENDING_PAYMENT, SponsorPlacementOrderStatus.PAYMENT_PROCESSING] } }, data: { status: SponsorPlacementOrderStatus.CANCELLED, reviewNote: "订单支付超时自动取消" } }),
      this.prisma.sponsorAd.updateMany({ where: { id: sponsorAdId, status: SponsorAdStatus.PENDING_PAYMENT }, data: { status: SponsorAdStatus.CANCELLED } }),
    ]);
  }
  private async paymentRuntimeConfig(): Promise<PaymentRuntimeConfig> {
    const configStore = (this.prisma as any).paymentProviderConfig;
    const stored = configStore ? await configStore.findUnique({ where: { id: "yipay" } }) : null;
    if (!stored) return { apiUrl: process.env.YIPAY_API_URL?.trim() || null, pid: process.env.YIPAY_PID?.trim() || null, key: process.env.YIPAY_KEY?.trim() || null, type: process.env.YIPAY_TYPE?.trim() || "alipay", orderTimeoutMinutes: 30 };
    let key: string | null = null;
    if (stored.keyCiphertext) {
      try { key = decryptSecret(stored.keyCiphertext); } catch { throw new BadRequestException("支付密钥解密失败，请重新保存易支付配置"); }
    }
    return { apiUrl: stored.apiUrl, pid: stored.pid, key, type: stored.type, orderTimeoutMinutes: stored.orderTimeoutMinutes };
  }
  private paymentUrl(orderNo: string, amount: number, name: string, config: PaymentRuntimeConfig) {
    if (!config.apiUrl || !config.pid || !config.key) return null;
    const params: Record<string, string> = { pid: config.pid, type: config.type, out_trade_no: orderNo, notify_url: `${process.env.PUBLIC_API_URL || "http://localhost:4000/v1"}/payment/yipay/notify`, return_url: `${process.env.WEB_ORIGIN || "http://localhost:3000"}/account/orders?order=${encodeURIComponent(orderNo)}`, name: name.slice(0, 100), money: amount.toFixed(2) };
    params.sign = this.sign(params, config.key); params.sign_type = "MD5";
    return `${config.apiUrl.replace(/\/$/, "")}/submit.php?${new URLSearchParams(params).toString()}`;
  }
  private verifyPayment(input: Record<string, unknown>, key: string | null) { if (!key) return process.env.NODE_ENV !== "production"; const sign = String(input.sign || ""); if (!sign) return false; const params = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "sign" && k !== "sign_type" && v !== undefined && v !== "")); return this.sign(params as Record<string, string>, key) === sign; }
  private sign(params: Record<string, string>, key: string) { const raw = Object.keys(params).filter((key) => params[key] !== "" && key !== "sign" && key !== "sign_type").sort().map((key) => `${key}=${params[key]}`).join("&"); return createHash("md5").update(`${raw}${key}`).digest("hex"); }
}

function parseItems(input: unknown) { const raw = (input as { items?: unknown })?.items; if (typeof raw === "string") { try { return quoteInput.parse({ items: JSON.parse(raw) }).items; } catch { throw new BadRequestException("投放位置格式无效"); } } return quoteInput.parse({ items: raw }).items; }
function parseTags(value: string) { return [...new Set(value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20); }
function validateImage(file: Express.Multer.File, limit: number) { if (file.size > limit || !["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) throw new BadRequestException("图片必须是 PNG、JPEG 或 WebP 且不超过限制"); }
function extension(mime: string) { return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"; }
