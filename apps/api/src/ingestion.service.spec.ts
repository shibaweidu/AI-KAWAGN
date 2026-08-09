import { normalizeApprovedHomepageUrl, parse211bDiscoveryInput, parse211bShopDirectory, parseImportRows, parseLdxpSchedule } from "./ingestion.service";

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
