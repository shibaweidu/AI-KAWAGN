import { announcementInputSchema, gatewayNoticeInputSchema, sideAdInputSchema, sideAdSchema } from "@ai-card/contracts";
import { SiteSettingsService } from "./site-settings.service";

const segment = { text: "查看更新", bold: true, italic: false, underline: true, color: "blue" as const, href: "/updates" };

describe("announcement contract", () => {
  it.each(["/privacy", "https://example.com/news"])("accepts safe link %s", (href) => {
    expect(announcementInputSchema.parse({ label: "公告", content: [{ ...segment, href }], enabled: true, dismissible: true }).content[0].href).toBe(href);
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "//example.com", "http://example.com", "https://user:pass@example.com"])("rejects unsafe link %s", (href) => {
    expect(() => announcementInputSchema.parse({ label: "公告", content: [{ ...segment, href }], enabled: true, dismissible: true })).toThrow();
  });

  it("rejects empty enabled announcements and oversized content", () => {
    expect(() => announcementInputSchema.parse({ label: "公告", content: [], enabled: true, dismissible: true })).toThrow();
    expect(() => announcementInputSchema.parse({ label: "公告", content: Array.from({ length: 51 }, () => segment), enabled: false, dismissible: true })).toThrow();
    expect(() => announcementInputSchema.parse({ label: "公告", content: [{ ...segment, text: "a".repeat(201) }], enabled: false, dismissible: true })).toThrow();
  });

  it("preserves spaces between differently formatted segments", () => {
    const result = announcementInputSchema.parse({
      label: "公告",
      content: [{ ...segment, text: "前半段 " }, { ...segment, text: "后半段", bold: false }],
      enabled: true,
      dismissible: true,
    });
    expect(result.content.map((item) => item.text).join("")).toBe("前半段 后半段");
  });
});

describe("site settings", () => {
  it("persists a changed site name through the primary settings record", async () => {
    const updatedAt = new Date("2026-08-14T00:00:00.000Z");
    const upsert = jest.fn().mockResolvedValue({
      siteName: "新网站名称",
      slogan: "AICardHub",
      description: "聚合公开报价",
      seoTitle: "数字商品比价",
      seoDescription: "快速比较公开报价",
      seoKeywords: ["AI比价"],
      logoObjectKey: null,
      updatedAt,
    });
    const prisma = { siteSetting: { upsert } };
    const service = new SiteSettingsService(prisma as never, {} as never);

    await expect(service.updateSettings({
      siteName: "  新网站名称  ",
      slogan: "AICardHub",
      description: "聚合公开报价",
      seoTitle: "数字商品比价",
      seoDescription: "快速比较公开报价",
      seoKeywords: "AI比价",
    })).resolves.toEqual(expect.objectContaining({ siteName: "新网站名称" }));

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "primary" },
      update: expect.objectContaining({ siteName: "新网站名称" }),
    }));
  });
});

describe("gateway notice settings", () => {
  it("validates and trims editable notice content", () => {
    expect(gatewayNoticeInputSchema.parse({
      title: "  使用前请核验  ",
      description: "  请先小额测试。  ",
      enabled: false,
    })).toEqual({ title: "使用前请核验", description: "请先小额测试。", enabled: false });
    expect(() => gatewayNoticeInputSchema.parse({ title: "", description: "说明", enabled: true })).toThrow();
  });

  it("updates only the gateway notice fields", async () => {
    const upsert = jest.fn().mockResolvedValue({
      gatewayNoticeTitle: "新的提示",
      gatewayNoticeDescription: "新的说明",
      gatewayNoticeEnabled: true,
    });
    const service = new SiteSettingsService({ siteSetting: { upsert } } as never, {} as never);

    await expect(service.updateGatewayNotice({ title: " 新的提示 ", description: " 新的说明 ", enabled: true }))
      .resolves.toEqual({ title: "新的提示", description: "新的说明", enabled: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "primary" },
      update: {
        gatewayNoticeTitle: "新的提示",
        gatewayNoticeDescription: "新的说明",
        gatewayNoticeEnabled: true,
      },
    }));
  });
});

describe("active site announcement", () => {
  function serviceWith(record: Record<string, unknown> | null) {
    const prisma = { siteAnnouncement: { findFirst: jest.fn().mockResolvedValue(record) } };
    return { service: new SiteSettingsService(prisma as never, {} as never), findFirst: prisma.siteAnnouncement.findFirst };
  }

  it("returns null for disabled, future or expired records selected out by Prisma", async () => {
    const { service, findFirst } = serviceWith(null);
    await expect(service.getActiveAnnouncement()).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ enabled: true }) }));
  });

  it("returns valid controlled segments inside the active schedule", async () => {
    const now = new Date();
    const { service } = serviceWith({ id: "primary", label: "通知", content: [segment], enabled: true, dismissible: true, startsAt: null, endsAt: null, updatedAt: now });
    await expect(service.getActiveAnnouncement()).resolves.toEqual(expect.objectContaining({ id: "primary", label: "通知", enabled: true, content: [segment] }));
  });

  it("does not expose an active record with empty or invalid content", async () => {
    const { service } = serviceWith({ id: "primary", label: "公告", content: [{ text: "", href: "javascript:alert(1)" }], enabled: true, dismissible: true, startsAt: null, endsAt: null, updatedAt: new Date() });
    await expect(service.getActiveAnnouncement()).resolves.toBeNull();
  });
});

describe("side ad contract", () => {
  it("accepts credential-free HTTPS destinations and local uploaded image paths", () => {
    const input = sideAdInputSchema.parse({ title: "优惠", url: "https://example.com/deal", imageUrl: null, label: "广告", active: false, clearImage: false });
    expect(input.url).toBe("https://example.com/deal");
    expect(sideAdSchema.parse({ id: "ad-1", slot: "left", title: "优惠", url: input.url, imageUrl: "/api/v1/assets/side-ads/left?v=1", label: "广告" }).slot).toBe("left");
  });

  it.each(["http://example.com", "https://user:pass@example.com"]) ("rejects unsafe side-ad URL %s", (url) => {
    expect(() => sideAdInputSchema.parse({ title: "优惠", url, imageUrl: "https://cdn.example.com/ad.png", label: "广告", active: false, clearImage: false })).toThrow();
  });

  it("returns only active image-backed ads to the public serializer", async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: "ad-1", slot: "LEFT", title: "优惠", url: "https://example.com/deal", imageUrl: "https://cdn.example.com/ad.png", imageObjectKey: null, label: "广告", updatedAt: new Date(),
    }]);
    const service = new SiteSettingsService({ sideAd: { findMany, update: jest.fn().mockResolvedValue(undefined) } } as never, {} as never);
    await expect(service.getActiveSideAds()).resolves.toEqual([expect.objectContaining({ slot: "left", imageUrl: "https://cdn.example.com/ad.png" })]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, OR: [{ imageObjectKey: { not: null } }, { imageUrl: { not: null } }] } }));
  });
});

