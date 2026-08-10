import { isLdxp211bCandidate, isLdxpProductSyncPending, normalizeApprovedHomepageUrl, parse211bDiscoveryInput, parse211bShopDirectory, parse211bShopProducts, parseImportRows, parseLdxpProductBackfillInput, parseLdxpSchedule } from "./ingestion.service";

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
    expect(parseLdxpSchedule({ enabled: true, intervalMinutes: 360 })).toEqual({ enabled: true, intervalMinutes: 360 });
  });

  it("rejects unsafe polling intervals", () => {
    expect(() => parseLdxpSchedule({ enabled: true, intervalMinutes: 5 })).toThrow("30-1440");
    expect(() => parseLdxpSchedule({ enabled: "true", intervalMinutes: 360 })).toThrow("布尔值");
  });
});

describe("LDXP product backfill", () => {
  it("uses bounded batches", () => {
    expect(parseLdxpProductBackfillInput({})).toEqual({ batchSize: 25 });
    expect(parseLdxpProductBackfillInput({ batchSize: "50" })).toEqual({ batchSize: 50 });
    expect(() => parseLdxpProductBackfillInput({ batchSize: 101 })).toThrow("1-100");
  });

  it("only treats a completed product sync marker as hydrated", () => {
    expect(isLdxpProductSyncPending({ discoverySource: "211b.site" })).toBe(true);
    expect(isLdxpProductSyncPending({ productSyncedAt: "2026-08-10T00:00:00.000Z" })).toBe(false);
    expect(isLdxp211bCandidate({ discoverySource: "211b.site" })).toBe(true);
    expect(isLdxp211bCandidate({ importedSource: "ldxp-shop-directory" })).toBe(false);
  });
});

describe("211b directory discovery", () => {
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
          mirrorUrl: "https://211b.site/shops/G062JE24",
          originalShopUrl: "https://pay.ldxp.cn/shop/G062JE24",
          productCount: 1676,
          minPrice: 0,
          logoUrl: null,
        },
        {
          token: "xt123",
          name: "ai小头",
          mirrorUrl: "https://211b.site/shops/xt123",
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
