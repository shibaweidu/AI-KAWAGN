import { homeBannerInputSchema, offerFeedbackSchema, offerSearchQuerySchema, siteSettingsInputSchema } from "@ai-card/contracts";
import { CollectionMode, Prisma, ShopStatus } from "@prisma/client";
import { getStockStatus, MarketService } from "./market.service";
import type { PrismaService } from "./prisma.service";

function createPrismaMock() {
  const prisma = {
    $transaction: jest.fn(),
    shop: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    offer: { findMany: jest.fn(), findFirst: jest.fn() },
    feedback: { create: jest.fn() },
    canonicalProduct: { findMany: jest.fn(), count: jest.fn() },
    hotSearchTerm: { findMany: jest.fn().mockResolvedValue([]) },
    searchAd: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
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

  it("validates site settings and safe banner schedules", () => {
    expect(siteSettingsInputSchema.parse({ siteName: "AI卡网", slogan: "AICardHub", description: "公开报价聚合", seoTitle: "数字商品比价", seoDescription: "快速比较店铺报价", seoKeywords: "AI比价，数字商品" }).seoKeywords).toEqual(["AI比价", "数字商品"]);
    expect(homeBannerInputSchema.parse({ title: "活动", summary: "", buttonLabel: "查看", targetUrl: "https://example.com", label: "广告", startsAt: "", endsAt: "", active: "false" }).active).toBe(false);
    expect(() => homeBannerInputSchema.parse({ title: "活动", summary: "", buttonLabel: "查看", targetUrl: "https://user:secret@example.com", label: "广告", startsAt: "", endsAt: "", active: "true" })).toThrow();
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

  it("returns database home data without a demo marker", async () => {
    jest.spyOn(service, "stats").mockResolvedValue({ shops: 0, products: 0, verifiedShops: 0, updatedToday: 0, lastSyncedAt: null });
    jest.spyOn(service, "categories").mockResolvedValue([]);
    jest.spyOn(service, "offers").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, ad: null });
    jest.spyOn(service, "hot").mockResolvedValue([]);
    jest.spyOn(service, "shops").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    await expect(service.home()).resolves.toMatchObject({ isDemo: false, offers: { total: 0 } });
  });

  it("rejects non-HTTPS submissions before writing", async () => {
    await expect(service.submit({ url: "http://example.com", contactEmail: "a@example.com", authorizationConfirmed: true })).rejects.toThrow();
  });

  it("rate limits repeated anonymous offer feedback", async () => {
    prisma.offer.findFirst.mockResolvedValue({ id: "offer-1" });
    prisma.feedback.create.mockResolvedValue({});
    for (let index = 0; index < 5; index += 1) await expect(service.addOfferFeedback("offer-1", { type: "other" }, "test-client")).resolves.toMatchObject({ accepted: true });
    await expect(service.addOfferFeedback("offer-1", { type: "other" }, "test-client")).resolves.toEqual({ accepted: false, reason: "rate_limited" });
    expect(prisma.feedback.create).toHaveBeenCalledTimes(5);
  });
});
