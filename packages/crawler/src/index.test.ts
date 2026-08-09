import { describe, expect, it } from "vitest";
import { isBlockedAddress, normalizeTitle, parsePrice, parseTaokayouShopPage, productFingerprint } from "./index";

describe("product normalization", () => {
  it("normalizes full-width text and punctuation", () => expect(normalizeTitle("ＧＰＴ PLUS｜30天 - 直充")).toBe("gpt plus 30天 直充"));
  it("parses currency strings", () => expect(parsePrice("¥ 19.90")).toBe(19.9));
  it("creates stable category-aware fingerprints", () => {
    expect(productFingerprint("GPT PLUS", "OpenAI")).toBe(productFingerprint("gpt plus", "openai"));
    expect(productFingerprint("GPT PLUS", "OpenAI")).not.toBe(productFingerprint("GPT PLUS", "Other"));
  });
});

describe("SSRF address filtering", () => {
  it.each(["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.20", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fe80::1"])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("Taokayou public directory parser", () => {
  it("extracts only public shop metadata", () => {
    const metadata = parseTaokayouShopPage(
      { externalId: "123", directoryUrl: "https://www.taokayou.com/shop/123", lastModified: null },
      '<meta property="og:title" content="测试店铺 | 淘卡优"><meta property="og:image" content="https://cdn.example.com/logo.png"><strong>2026/8/3 00:40:49</strong><small>最近同步</small><strong>2026/07/19</strong><small>平台收录</small>',
    );
    expect(metadata).toMatchObject({
      externalId: "123",
      name: "测试店铺",
      logoUrl: "https://cdn.example.com/logo.png",
      sourceListedAt: "2026-07-18T16:00:00.000Z",
      sourceSyncedAt: "2026-08-02T16:40:49.000Z",
    });
  });

  it("fails when the public page no longer contains a shop name", () => {
    expect(() => parseTaokayouShopPage(
      { externalId: "123", directoryUrl: "https://www.taokayou.com/shop/123", lastModified: null },
      "<html><body>changed</body></html>",
    )).toThrow("missing a name");
  });
});
