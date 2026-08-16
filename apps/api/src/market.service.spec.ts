import { homeBannerInputSchema, offerFeedbackSchema, offerSearchQuerySchema, siteSettingsInputSchema } from "@ai-card/contracts";
import { CollectionMode, Prisma, ShopStatus } from "@prisma/client";
import { categoryGroupFor, directorySummary, getStockStatus, isBlockedProduct, MarketService, safeSourceDestination } from "./market.service";
import type { PrismaService } from "./prisma.service";

function createPrismaMock() {
  const prisma = {
    $transaction: jest.fn(),
    shop: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    offer: { findMany: jest.fn(), findFirst: jest.fn() },
    feedback: { create: jest.fn() },
    canonicalProduct: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    category: { findMany: jest.fn() },
    hotSearchTerm: { findMany: jest.fn().mockResolvedValue([]) },
    searchAd: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
    managedListing: { findFirst: jest.fn() },
    outboundClick: { create: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (value: unknown): Promise<unknown> => Array.isArray(value) ? Promise.all(value) : (value as (client: unknown) => unknown)(prisma));
  return prisma;
}

function offer(overrides: Partial<Record<string, unknown>> = {}) {
  const observedAt = overrides.sourceObservedAt instanceof Date ? overrides.sourceObservedAt : new Date("2026-08-03T00:00:00.000Z");
  return {
    id: "offer-feed", shopId: "shop-1", sourceProductId: "source-product-1", canonicalProductId: "product-1",
    dataSourceId: "source-feed", externalId: "external-feed", collectionMode: CollectionMode.PUBLIC_FEED,
    price: new Prisma.Decimal(18), stock: null, currency: "CNY", active: true,
    sourceUrl: "https://store.example.com/buy/feed", sourceObservedAt: observedAt, syncedAt: observedAt,
    sourceAttributionUrl: "https://211b.site/shops/store-one",
    canonicalProduct: { id: "product-1", slug: "gpt-plus", title: "GPT Plus", summary: "30 天", category: { name: "OpenAI" } },
    sourceProduct: { description: "30 天订阅" },
    shop: { id: "shop-1", slug: "store-one", name: "一号店", logoUrl: null, verifiedAt: null },
    dataSource: { name: "链动小店", attributionUrl: "https://pay.ldxp.cn" },
    ...overrides,
  };
}

function publicShop(id: string, publishedAt: string) {
  return {
    id, slug: id, name: id, description: "", logoUrl: null, verifiedAt: null,
    publishedAt: new Date(publishedAt), lastSyncedAt: new Date(publishedAt),
    offers: [{ price: new Prisma.Decimal(18), canonicalProductId: "product-1", canonicalProduct: { category: { name: "OpenAI" } } }], reviews: [],
    sourceMappings: [{ dataSource: { name: "链动小店", attributionUrl: "https://pay.ldxp.cn" } }],
    approvedCandidates: [],
  };
}

describe("MarketService database mode", () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: MarketService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new MarketService(prisma as unknown as PrismaService);
  });

  it("parses query defaults, price ranges, stock states and feedback types", () => {
    expect(offerSearchQuerySchema.parse({}).sort).toBe("price_asc");
    expect(() => offerSearchQuerySchema.parse({ minPrice: 20, maxPrice: 10 })).toThrow();
    expect(getStockStatus(0)).toBe("out_of_stock");
    expect(getStockStatus(5)).toBe("low_stock");
    expect(getStockStatus(20)).toBe("in_stock");
    expect(getStockStatus(null)).toBe("in_stock");
    expect(offerFeedbackSchema.parse({ type: "price_error" }).type).toBe("price_error");
    expect(() => offerFeedbackSchema.parse({ type: "spam" })).toThrow();
  });

  it("recognizes traffic-card variants without blocking ordinary AI subscriptions", () => {
    expect(isBlockedProduct("电信流量卡 100GB")).toBe(true);
    expect(isBlockedProduct("物联网 SIM Card", "通信产品")).toBe(true);
    expect(isBlockedProduct("性价比电话卡", "30元260G通用+30G定向+200分钟语音通话")).toBe(true);
    expect(isBlockedProduct("GPT Plus 30 天套餐", "AI订阅")).toBe(false);
  });

  it("validates site settings and safe banner schedules", () => {
    expect(siteSettingsInputSchema.parse({ siteName: "AI卡网", slogan: "AICardHub", description: "公开报价聚合", seoTitle: "数字商品比价", seoDescription: "快速比较店铺报价", seoKeywords: "AI比价，数字商品" }).seoKeywords).toEqual(["AI比价", "数字商品"]);
    expect(homeBannerInputSchema.parse({ title: "活动", summary: "", buttonLabel: "查看", targetUrl: "https://example.com", label: "广告", startsAt: "", endsAt: "", active: "false" }).active).toBe(false);
    expect(() => homeBannerInputSchema.parse({ title: "活动", summary: "", buttonLabel: "查看", targetUrl: "https://user:secret@example.com", label: "广告", startsAt: "", endsAt: "", active: "true" })).toThrow();
  });

  it("groups, merges and paginates category browsing without changing source categories", async () => {
    prisma.category.findMany.mockResolvedValue([
      { slug: "gemini-upper", name: "Gemini", _count: { products: 2 } },
      { slug: "gemini-lower", name: "gemini", _count: { products: 1 } },
      { slug: "cursor", name: "Cursor 编程", _count: { products: 1 } },
      { slug: "empty", name: "空分类", _count: { products: 0 } },
    ]);

    const result = await service.categoryBrowse({ group: "gemini", page: 1, pageSize: 20 });
    expect(result).toMatchObject({ total: 1, page: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ name: "Gemini", count: 3, group: "gemini" });
    expect(result.groups.find((group) => group.id === "gemini")).toMatchObject({ categoryCount: 1, productCount: 3 });
    expect(categoryGroupFor("Claude API 套餐")).toBe("claude");
    expect(categoryGroupFor("Codex 接码")).toBe("coding");
  });

  it("never queries pending or unpublished shops for public listings", async () => {
    prisma.shop.findMany.mockResolvedValue([]);
    prisma.shop.count.mockResolvedValue(0);
    await service.shops({ sort: "newest" });

    expect(prisma.shop.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ShopStatus.ACTIVE, publishedAt: { not: null } }),
      orderBy: [{ publishedAt: "desc" }],
    }));
  });

  it("returns published shops in database newest order with source attribution", async () => {
    prisma.shop.findMany.mockResolvedValue([
      publicShop("new-shop", "2026-08-03T00:00:00.000Z"),
      publicShop("old-shop", "2026-08-01T00:00:00.000Z"),
    ]);
    prisma.shop.count.mockResolvedValue(2);

    const result = await service.shops({ sort: "newest", page: 1, pageSize: 20 });
    expect(result.items.map((shop) => shop.id)).toEqual(["new-shop", "old-shop"]);
    expect(result.items[0]).toMatchObject({ sourceName: "链动小店", publishedAt: "2026-08-03T00:00:00.000Z" });
    expect(result.items[0].categories).toEqual(["OpenAI"]);
  });

  it("uses verified directory aggregates when item-level offers are unavailable", async () => {
    const shop = {
      ...publicShop("directory-shop", "2026-08-03T00:00:00.000Z"),
      offers: [],
      approvedCandidates: [{
        rawMetadata: { productCount: 42, stock: 380, minPrice: 0.2, maxPrice: 99, categories: ["邮箱", "AI订阅"] },
        sourceSyncedAt: new Date("2026-08-02T23:00:00.000Z"),
      }],
    };
    prisma.shop.findMany.mockResolvedValue([shop]);
    prisma.shop.count.mockResolvedValue(1);

    const result = await service.shops({ sort: "newest", page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ productCount: 42, lowestPrice: 0.2, highestPrice: 99, aggregateStock: 380, categories: ["邮箱", "AI订阅"], dataLevel: "directory" });
  });

  it("groups offers by product and keeps authorized direct data over a newer public feed", async () => {
    const direct = offer({
      id: "offer-direct", externalId: "external-direct", dataSourceId: "source-direct",
      collectionMode: CollectionMode.AUTHORIZED_DIRECT, price: new Prisma.Decimal(20), stock: 8,
      sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"), syncedAt: new Date("2026-08-01T00:00:00.000Z"),
      dataSource: { name: "一号店 授权直采", attributionUrl: "https://store.example.com" },
    });
    const newerFeed = offer({ sourceObservedAt: new Date("2026-08-03T00:00:00.000Z"), syncedAt: new Date("2026-08-03T00:00:00.000Z") });
    const secondShop = offer({
      id: "offer-second", shopId: "shop-2", externalId: "external-second", price: new Prisma.Decimal(16),
      shop: { id: "shop-2", slug: "store-two", name: "二号店", logoUrl: null, verifiedAt: new Date() },
    });
    prisma.offer.findMany.mockResolvedValue([newerFeed, direct, secondShop]);

    const result = await service.offers({ sort: "price_asc", page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ offerCount: 2, lowestPrice: 16, highestPrice: 20, verifiedShopCount: 2 });
    expect(result.items[0].offers.find((item) => item.shopId === "shop-1")).toMatchObject({
      id: "offer-direct", sourceMode: "authorized_direct", sourceName: "一号店 授权直采", stockStatus: "low_stock",
    });
    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } }),
    }));
  });

  it("excludes zero-price records from the public quote list", async () => {
    prisma.offer.findMany.mockImplementation(async (args: { where?: { price?: { gt?: number } } }) => args.where?.price?.gt === 0 ? [] : [offer({ price: new Prisma.Decimal(0) })]);

    const result = await service.offers({ sort: "price_asc", page: 1, pageSize: 20 });

    expect(result.items).toEqual([]);
    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ price: { gt: 0, gte: undefined, lte: undefined } }),
    }));
  });

  it("excludes traffic-card offers from the public quote list", async () => {
    prisma.offer.findMany.mockResolvedValue([
      offer({ id: "traffic-card", canonicalProduct: { ...offer().canonicalProduct, title: "全国流量卡 100GB", category: { name: "通信" } } }),
      offer({ id: "ai-subscription" }),
    ]);

    const result = await service.offers({ sort: "price_asc", page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].productName).toBe("GPT Plus");
  });

  it("returns not found for a traffic-card product detail", async () => {
    prisma.canonicalProduct.findFirst.mockResolvedValue({
      id: "traffic-product", slug: "traffic-card", title: "全国流量卡", summary: "100GB", thumbnailUrl: null,
      category: { name: "通信" }, offers: [offer({ canonicalProduct: { ...offer().canonicalProduct, title: "全国流量卡", category: { name: "通信" } } })],
    });

    await expect(service.product("traffic-card")).rejects.toThrow("Product not found");
  });

  it("returns database home data without a demo marker", async () => {
    jest.spyOn(service, "stats").mockResolvedValue({ shops: 0, products: 0, verifiedShops: 0, updatedToday: 0, lastSyncedAt: null });
    jest.spyOn(service, "categories").mockResolvedValue([]);
    jest.spyOn(service, "offers").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, ad: null });
    jest.spyOn(service, "hot").mockResolvedValue([]);
    jest.spyOn(service, "shops").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    await expect(service.home()).resolves.toMatchObject({ isDemo: false, offers: { total: 0 } });
  });

  it("uses directory product counts even when the source omits a maximum price", () => {
    expect(directorySummary([{ rawMetadata: { productCount: 913, minPrice: 0.01 } }])).toEqual({
      productCount: 913, minPrice: 0.01, maxPrice: 0.01, stock: null, categories: [],
    });
  });

  it("only accepts redirect destinations on the approved source host", () => {
    expect(safeSourceDestination("https://pay.ldxp.cn/item/abc", ["https://pay.ldxp.cn"]))
      .toBe("https://pay.ldxp.cn/item/abc");
    expect(() => safeSourceDestination("https://example.com/item/abc", ["https://pay.ldxp.cn"]))
      .toThrow("Unapproved destination host");
    expect(() => safeSourceDestination("http://pay.ldxp.cn/item/abc", ["https://pay.ldxp.cn"]))
      .toThrow("Unsafe destination");
  });

  it("tracks active managed listing redirects and rejects inactive entries", async () => {
    prisma.managedListing.findFirst.mockResolvedValue({ id: "sponsor-1", url: "https://sponsor.example.com/welcome" });

    await expect(service.listingTarget("sponsor-1")).resolves.toBe("https://sponsor.example.com/welcome");
    expect(prisma.managedListing.findFirst).toHaveBeenCalledWith({ where: { id: "sponsor-1", active: true } });
    expect(prisma.outboundClick.create).toHaveBeenCalledWith({ data: { targetType: "listing", targetId: "sponsor-1", destinationHost: "sponsor.example.com" } });

    prisma.managedListing.findFirst.mockResolvedValue(null);
    await expect(service.listingTarget("inactive-sponsor")).rejects.toThrow("Listing not found");
  });

  it("rate limits repeated anonymous offer feedback", async () => {
    prisma.offer.findFirst.mockResolvedValue({ id: "offer-1" });
    prisma.feedback.create.mockResolvedValue({});
    for (let index = 0; index < 5; index += 1) await expect(service.addOfferFeedback("offer-1", { type: "other" }, "test-client")).resolves.toMatchObject({ accepted: true });
    await expect(service.addOfferFeedback("offer-1", { type: "other" }, "test-client")).resolves.toEqual({ accepted: false, reason: "rate_limited" });
    expect(prisma.feedback.create).toHaveBeenCalledTimes(5);
  });
});
