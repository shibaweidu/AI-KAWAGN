import { managedListingInputSchema, searchAdInputSchema } from "@ai-card/contracts";
import { IngestionService, isLdxp211bCandidate, isLdxpProductSyncDue, isLdxpProductSyncPending, normalize211bOrigin, normalizeApprovedHomepageUrl, normalizeCatalogUrl, parse211bDiscoveryInput, parse211bShopDirectory, parse211bShopProducts, parseImportRows, parseLdxpProductBackfillInput, parseLdxpSchedule, parseSourceSchedule, shouldDeactivateMissingLdxpOffer } from "./ingestion.service";

describe("managed listing editor", () => {
  const current = {
    id: "listing-1", type: "GATEWAY", title: "原赞助商", description: "原说明", url: "https://old.example.com",
    thumbnailUrl: null, thumbnailObjectKey: "managed-listings/original.webp", badge: null, modelTags: [], pricingClaims: null,
    gatewayPlacement: true, homeSideSlot: null, homeBottomPlacement: false, active: true, position: 0,
    createdAt: new Date("2026-08-14T00:00:00.000Z"), updatedAt: new Date("2026-08-14T00:00:00.000Z"),
  };

  it("accepts only credential-free HTTPS destinations", () => {
    const base = { type: "gateway", title: "赞助商", description: "", thumbnailUrl: "", badge: "" };
    expect(() => managedListingInputSchema.parse({ ...base, url: "http://example.com" })).toThrow();
    expect(() => managedListingInputSchema.parse({ ...base, url: "https://user:pass@example.com" })).toThrow();
    expect(managedListingInputSchema.parse({ ...base, url: "https://example.com" }).url).toBe("https://example.com");
  });

  it("parses independent directory, side and bottom placement fields", () => {
    const result = managedListingInputSchema.parse({
      type: "gateway", title: "赞助商", description: "", url: "https://example.com",
      gatewayPlacement: "true", homeSideSlot: "right", homeBottomPlacement: "true",
    });

    expect(result).toMatchObject({ gatewayPlacement: true, homeSideSlot: "right", homeBottomPlacement: true });
    expect(() => managedListingInputSchema.parse({
      type: "gateway", title: "赞助商", description: "", url: "https://example.com", homeSideSlot: "center",
    })).toThrow();
  });

  it("rejects a homepage side slot already occupied by another active sponsor", async () => {
    const prisma = {
      managedListing: {
        findUnique: jest.fn().mockResolvedValue(current),
        findFirst: jest.fn().mockResolvedValue({ title: "已有赞助商" }),
      },
    };
    const service = new IngestionService(prisma as never, { put: jest.fn(), remove: jest.fn() } as never);

    await expect(service.updateManagedListing("listing-1", {
      type: "gateway", title: "原赞助商", description: "", url: "https://example.com",
      gatewayPlacement: true, homeSideSlot: "left", homeBottomPlacement: true,
    })).rejects.toThrow("首页左侧赞助位已被“已有赞助商”占用");
    expect(prisma.managedListing.findFirst).toHaveBeenCalledWith({
      where: { type: "GATEWAY", active: true, homeSideSlot: "LEFT", id: { not: "listing-1" } },
      select: { title: true },
    });
  });

  it("preserves the uploaded image when text is edited without a replacement", async () => {
    const update = jest.fn().mockImplementation(({ data }) => ({ ...current, ...data, title: "新赞助商", updatedAt: new Date("2026-08-14T01:00:00.000Z") }));
    const prisma = { managedListing: { findUnique: jest.fn().mockResolvedValue(current), update } };
    const service = new IngestionService(prisma as never, { put: jest.fn(), remove: jest.fn() } as never);

    await service.updateManagedListing("listing-1", { type: "gateway", title: "新赞助商", description: "新说明", url: "https://new.example.com", thumbnailUrl: "", badge: "" });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ thumbnailObjectKey: "managed-listings/original.webp", thumbnailUrl: null }) }));
  });

  it("stores a valid local image and replaces the previous image", async () => {
    const update = jest.fn().mockImplementation(({ data }) => ({ ...current, ...data, updatedAt: new Date("2026-08-14T02:00:00.000Z") }));
    const put = jest.fn().mockResolvedValue("stored");
    const prisma = { managedListing: { findUnique: jest.fn().mockResolvedValue(current), update } };
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = new IngestionService(prisma as never, { put, remove } as never);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

    await service.updateManagedListing("listing-1", { type: "gateway", title: "原赞助商", description: "", url: "https://new.example.com", thumbnailUrl: "", badge: "" }, { buffer: png, size: png.length, mimetype: "image/png" } as Express.Multer.File);

    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^managed-listings\/.+\.png$/), png, "image/png");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ thumbnailObjectKey: expect.stringMatching(/^managed-listings\/.+\.png$/), thumbnailUrl: null }) }));
    expect(remove).toHaveBeenCalledWith("managed-listings/original.webp");
  });
});

describe("search advertisement editor", () => {
  const segment = { text: "限时优惠", bold: true, italic: false, underline: false, color: "orange" as const, href: "https://example.com/deal" };

  it("parses structured content from multipart fields and rejects insecure image URLs", () => {
    expect(searchAdInputSchema.parse({ title: "推广", url: "https://example.com", global: "true", content: JSON.stringify([segment]) }).content).toEqual([segment]);
    expect(() => searchAdInputSchema.parse({ title: "推广", url: "https://example.com", global: true, logoUrl: "http://example.com/logo.png" })).toThrow();
  });

  it("updates rich text and replaces an uploaded background without losing statistics", async () => {
    const current = {
      id: "ad-1", title: "旧广告", description: "旧说明", descriptionContent: null, url: "https://example.com",
      imageUrl: null, backgroundObjectKey: "search-ads/background/old.webp", logoUrl: "https://example.com/logo.webp", logoObjectKey: null,
      label: "广告", keywords: [], global: true, active: true, position: 0, startsAt: null, endsAt: null,
      impressionCount: 12, clickCount: 3, createdAt: new Date("2026-08-16T00:00:00.000Z"), updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    };
    const update = jest.fn().mockImplementation(({ data }) => ({ ...current, ...data, updatedAt: new Date("2026-08-16T01:00:00.000Z") }));
    const remove = jest.fn().mockResolvedValue(undefined);
    const prisma = { searchAd: { findUnique: jest.fn().mockResolvedValue(current), update } };
    const objects = { put: jest.fn().mockResolvedValue(undefined), remove };
    const service = new IngestionService(prisma as never, objects as never);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

    const result = await service.updateSearchAd("ad-1", {
      title: "新广告", url: "https://example.com", global: "true", active: "true", label: "推广",
      content: JSON.stringify([segment]), backgroundImageUrl: "", logoUrl: "https://example.com/logo.webp",
    }, { backgroundImage: [{ buffer: png, size: png.length, mimetype: "image/png" } as Express.Multer.File] });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      description: "限时优惠", descriptionContent: [segment], imageUrl: null,
      backgroundObjectKey: expect.stringMatching(/^search-ads\/background\/.+\.png$/),
    }) }));
    expect(remove).toHaveBeenCalledWith("search-ads/background/old.webp");
    expect(result).toMatchObject({ impressionCount: 12, clickCount: 3, backgroundImageUrl: expect.stringContaining("/api/v1/assets/search-ads/ad-1/background") });
  });
});

describe("ingestion import preview", () => {
  it("returns explicit valid and invalid counts for the admin preview", () => {
    const result = parseImportRows(JSON.stringify([{
      source: "fixture",
      externalShopId: "shop-1",
      shopName: "测试店铺",
      homepageUrl: "https://shop.example.com",
      externalProductId: "product-1",
      productName: "测试商品",
      specification: "30 天",
      category: "其他",
      externalOfferId: "offer-1",
      price: 9.9,
      currency: "CNY",
      stock: 2,
      offerUrl: "https://shop.example.com/buy/product-1",
      observedAt: "2026-08-03T00:00:00+08:00",
    }]), "json");

    expect(result).toMatchObject({ total: 1, valid: 1, invalid: 0, errors: [] });
    expect(result.rows).toHaveLength(1);
  });

  it("counts rejected rows without staging them", () => {
    const result = parseImportRows(JSON.stringify([{ source: "fixture", homepageUrl: "http://127.0.0.1" }]), "json");

    expect(result).toMatchObject({ total: 1, valid: 0, invalid: 1, rows: [] });
    expect(result.errors[0].issues.length).toBeGreaterThan(0);
  });
});

describe("approved shop homepage", () => {
  it("preserves a path-based storefront URL", () => {
    expect(normalizeApprovedHomepageUrl("https://pay.ldxp.cn/shop/G062JE24"))
      .toBe("https://pay.ldxp.cn/shop/G062JE24");
  });

  it("rejects embedded credentials", () => {
    expect(() => normalizeApprovedHomepageUrl("https://user:password@pay.ldxp.cn/shop/test"))
      .toThrow("Only credential-free HTTPS homepages are accepted");
  });
});

describe("LDXP schedule", () => {
  it("accepts supported intervals", () => {
    expect(parseLdxpSchedule({ enabled: true, intervalMinutes: 10 })).toEqual({ enabled: true, intervalMinutes: 10 });
    expect(parseLdxpSchedule({ enabled: true, intervalMinutes: 360 })).toEqual({ enabled: true, intervalMinutes: 360 });
  });

  it("rejects unsafe polling intervals", () => {
    expect(() => parseLdxpSchedule({ enabled: true, intervalMinutes: 5 })).toThrow("10-1440");
    expect(() => parseLdxpSchedule({ enabled: "true", intervalMinutes: 360 })).toThrow("布尔值");
  });
});

describe("public catalog schedule and deduplication", () => {
  it("normalizes equivalent LDXP shop and product links", () => {
    expect(normalizeCatalogUrl("https://www.ldxp.cn/shop/Demo/?utm_source=feed#top")).toBe("https://pay.ldxp.cn/shop/Demo");
    expect(normalizeCatalogUrl("https://pay.ldxp.cn/item/x/?utm_source=feed")).toBe("https://pay.ldxp.cn/item/x");
  });

  it("requires lower polling frequency for public catalog sources", () => {
    expect(parseSourceSchedule({ enabled: true, intervalMinutes: 60 }, 60)).toEqual({ enabled: true, intervalMinutes: 60 });
    expect(() => parseSourceSchedule({ enabled: true, intervalMinutes: 30 }, 60)).toThrow("60-1440");
  });
});

describe("LDXP product backfill", () => {
  it("uses bounded batches", () => {
    expect(parseLdxpProductBackfillInput({})).toEqual({ batchSize: 25, refreshAll: false, priorityTokens: [] });
    expect(parseLdxpProductBackfillInput({ batchSize: "50", refreshAll: true, priorityTokens: ["King"] })).toEqual({ batchSize: 50, refreshAll: true, priorityTokens: ["King"] });
    expect(() => parseLdxpProductBackfillInput({ batchSize: 101 })).toThrow("1-100");
    expect(() => parseLdxpProductBackfillInput({ refreshAll: "true" })).toThrow("布尔值");
    expect(() => parseLdxpProductBackfillInput({ priorityTokens: ["bad/token"] })).toThrow("合法店铺 Token");
  });

  it("only treats a completed product sync marker as hydrated", () => {
    expect(isLdxpProductSyncPending({ discoverySource: "211b.site" })).toBe(true);
    expect(isLdxpProductSyncPending({ productSyncedAt: "2026-08-10T00:00:00.000Z" })).toBe(false);
    expect(isLdxpProductSyncPending({ productSyncStatus: "failed", productSyncedAt: "2026-08-10T00:00:00.000Z" })).toBe(true);
    expect(isLdxp211bCandidate({ discoverySource: "211b.site" })).toBe(true);
    expect(isLdxp211bCandidate({ importedSource: "ldxp-shop-directory" })).toBe(false);
  });

  it("refreshes completed shops once per full refresh run", () => {
    const runStartedAt = new Date("2026-08-11T00:00:00.000Z");
    expect(isLdxpProductSyncDue({ productSyncedAt: "2026-08-10T23:00:00.000Z" }, true, runStartedAt)).toBe(true);
    expect(isLdxpProductSyncDue({ productSyncedAt: "2026-08-11T00:01:00.000Z" }, true, runStartedAt)).toBe(false);
    expect(isLdxpProductSyncDue({ productSyncedAt: "2026-08-10T23:00:00.000Z" }, false, runStartedAt)).toBe(false);
    expect(isLdxpProductSyncDue({ productSyncedAt: "2026-08-10T23:00:00.000Z" }, false, runStartedAt, 10 * 60 * 1000)).toBe(true);
    expect(isLdxpProductSyncDue({ productSyncedAt: "2026-08-11T00:05:00.000Z" }, false, runStartedAt, 10 * 60 * 1000)).toBe(false);
  });

  it("only deactivates an offer after two successful snapshots miss it", () => {
    expect(shouldDeactivateMissingLdxpOffer(0)).toBe(false);
    expect(shouldDeactivateMissingLdxpOffer(1)).toBe(false);
    expect(shouldDeactivateMissingLdxpOffer(2)).toBe(true);
    expect(shouldDeactivateMissingLdxpOffer(3)).toBe(true);
  });
});

describe("211b directory discovery", () => {
  it("uses the current fixed HTTPS mirror origin", () => {
    expect(normalize211bOrigin()).toBe("https://2dou.org");
    expect(normalize211bOrigin("https://mirror.example/")).toBe("https://mirror.example");
    expect(() => normalize211bOrigin("http://mirror.example")).toThrow("HTTPS");
    expect(() => normalize211bOrigin("https://mirror.example/shops")).toThrow("无路径");
  });

  it("extracts public shop cards as LDXP candidates", () => {
    const html = `
      <section><div class="section-heading"><span>811 家</span></div>
      <a class="directory-card" href="/shops/G062JE24">
        <div class="directory-card-head"><span class="large-avatar">各</span></div>
        <h2>各类低价对接汇总</h2><p>G062JE24</p>
        <div class="directory-metrics"><div><strong>1,676</strong><span>在售商品</span></div><div><strong>¥0.00</strong><span>店内起价</span></div></div>
      </a>
      <a class="directory-card" href="/shops/xt123">
        <div class="directory-card-head"><span class="large-avatar"><img src="https://qn.ldxp.cn/a.png" alt="ai小头"></span></div>
        <h2>ai小头</h2><p>xt123</p>
        <div class="directory-metrics"><div><strong>988</strong><span>在售商品</span></div><div><strong>¥0.01</strong><span>店内起价</span></div></div>
      </a>
      <nav class="pagination"><span>第 1 / 14 页</span></nav></section>`;

    expect(parse211bShopDirectory(html)).toEqual({
      totalPages: 14,
      totalShops: 811,
      shops: [
        {
          token: "G062JE24",
          name: "各类低价对接汇总",
          mirrorUrl: "https://2dou.org/shops/G062JE24",
          originalShopUrl: "https://pay.ldxp.cn/shop/G062JE24",
          productCount: 1676,
          minPrice: 0,
          logoUrl: null,
        },
        {
          token: "xt123",
          name: "ai小头",
          mirrorUrl: "https://2dou.org/shops/xt123",
          originalShopUrl: "https://pay.ldxp.cn/shop/xt123",
          productCount: 988,
          minPrice: 0.01,
          logoUrl: "https://qn.ldxp.cn/a.png",
        },
      ],
    });
  });

  it("validates conservative discovery page limits", () => {
    expect(parse211bDiscoveryInput({ maxPages: "14", maxProductShops: "50" })).toEqual({ maxPages: 14, syncProducts: true, maxProductShops: 50 });
    expect(parse211bDiscoveryInput({ maxPages: "1" })).toEqual({ maxPages: 1, syncProducts: true, maxProductShops: 5 });
    expect(() => parse211bDiscoveryInput({ maxPages: 0 })).toThrow("1-50");
    expect(() => parse211bDiscoveryInput({ maxPages: 51 })).toThrow("1-50");
    expect(() => parse211bDiscoveryInput({ maxProductShops: 201 })).toThrow("0-200");
  });
});

describe("211b shop products", () => {
  it("extracts category, product link, image, price and stock", () => {
    const html = `
      <div class="shop-profile"><span>测</span><div><h1>测试店铺</h1></div></div>
      <div class="category-block">
        <div class="section-heading"><div><h2>AI 账号</h2></div><span>2 件商品</span></div>
        <article class="product-card">
          <a class="product-image" href="https://pay.ldxp.cn/item/item-a"><img src="https://qn.ldxp.cn/a.png" alt="A"><span class="stock">库存 8</span></a>
          <div class="product-body"><h3><a href="https://pay.ldxp.cn/item/item-a">GPT Plus</a></h3><div class="product-footer"><strong><small>¥</small>19.90</strong></div></div>
        </article>
        <article class="product-card">
          <a class="product-image" href="https://pay.ldxp.cn/item/item-b"><span class="stock out">暂时缺货</span></a>
          <div class="product-body"><h3><a href="https://pay.ldxp.cn/item/item-b">Claude Pro</a></h3><div class="product-footer"><strong><small>¥</small>29.00</strong></div></div>
        </article>
      </div>
      <nav class="pagination"><span>第 1 / 3 页，共 120 件</span></nav>`;

    expect(parse211bShopProducts(html, "shop-token")).toMatchObject({
      name: "测试店铺",
      totalPages: 3,
      categories: [{ id: null, name: "AI 账号", goodsCount: 2 }],
      items: [
        { externalId: "ldxp:item-a", productName: "GPT Plus", category: "AI 账号", price: 19.9, stock: 8, offerUrl: "https://pay.ldxp.cn/item/item-a", imageUrl: "https://qn.ldxp.cn/a.png" },
        { externalId: "ldxp:item-b", productName: "Claude Pro", category: "AI 账号", price: 29, stock: 0, offerUrl: "https://pay.ldxp.cn/item/item-b" },
      ],
    });
  });
});
