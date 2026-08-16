import type { SearchAdPage } from "@ai-card/contracts";
import { commandQuery, escapeHtml, formatSearchReply, validateQuery } from "./format";

const page: SearchAdPage = {
  items: [{
    productId: "p1", productSlug: "plus-account", productName: "Plus <成品号>", productThumbnailUrl: null,
    category: "AI", specification: "", offerCount: 23, inStockOfferCount: 20, verifiedShopCount: 23,
    lowestPrice: 10, highestPrice: 30, latestSyncedAt: "2026-08-14T00:00:00.000Z", offers: [{
      id: "o1", productId: "p1", productSlug: "plus-account", productName: "Plus <成品号>", productThumbnailUrl: null,
      category: "AI", specification: "", shopId: "s1", shopSlug: "shop", shopName: "店铺", shopLogo: "店",
      shopVerified: true, price: 10, isLowestPrice: true, stock: 10, stockStatus: "low_stock", syncedAt: "2026-08-14T00:00:00.000Z",
      sourceName: "链动小店", sourceMode: "public_directory", sourceAttributionUrl: null, sourceObservedAt: "2026-08-14T00:00:00.000Z",
    }],
  }],
  total: 12, page: 1, pageSize: 10, totalPages: 2, ad: null,
};

describe("bot message formatting", () => {
  it("parses explicit commands with optional bot usernames", () => {
    expect(commandQuery("/price@aicard_bot  Plus 成品号 ", "price")).toBe("Plus 成品号");
    expect(commandQuery("/search Claude", "search")).toBe("Claude");
  });

  it("validates query bounds", () => {
    expect(validateQuery("")).toContain("/price");
    expect(validateQuery("a")).toContain("2 个字符");
    expect(validateQuery("正常商品")).toBeNull();
  });

  it("escapes Telegram HTML and includes grouped offer details", () => {
    const message = formatSearchReply(page, "Plus <号>", "https://example.com");
    expect(message).toContain("Plus &lt;号&gt;");
    expect(message).toContain("Plus &lt;成品号&gt;");
    expect(message).toContain("23 家报价｜20 家有货");
    expect(message).toContain("https://example.com/products/plus-account");
    expect(escapeHtml('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });

  it("renders an actionable empty state", () => {
    expect(formatSearchReply({ ...page, items: [], total: 0, totalPages: 0 }, "无结果", "https://example.com")).toContain("没有找到");
  });
});
