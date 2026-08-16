import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { announcementInputSchema, announcementSegmentSchema, gatewayNoticeInputSchema, homeBannerInputSchema, sideAdInputSchema, sideAdSlotSchema, siteSettingsInputSchema } from "@ai-card/contracts";
import { SideAdSlot } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { ObjectStoreService } from "./object-store.service";

const SITE_ID = "primary";
const BANNER_ID = "primary";
const ANNOUNCEMENT_ID = "primary";
const SIDE_AD_SLOTS = [SideAdSlot.LEFT, SideAdSlot.RIGHT] as const;

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly objects: ObjectStoreService) {}

  async getPublicSettings() {
    const settings = await this.ensureSettings();
    return { ...this.toPublicSettings(settings), announcement: await this.getActiveAnnouncement() };
  }

  async updateSettings(body: unknown, logo?: Express.Multer.File) {
    const data = siteSettingsInputSchema.parse(body);
    const logoObjectKey = logo ? await this.storeImage("site/logo", logo, 2 * 1024 * 1024) : undefined;
    const settings = await this.prisma.siteSetting.upsert({
      where: { id: SITE_ID },
      create: { id: SITE_ID, ...data, logoObjectKey },
      update: { ...data, ...(logoObjectKey ? { logoObjectKey } : {}) },
    });
    return this.toPublicSettings(settings);
  }

  async updateGatewayNotice(body: unknown) {
    const data = gatewayNoticeInputSchema.parse(body);
    const settings = await this.prisma.siteSetting.upsert({
      where: { id: SITE_ID },
      create: {
        id: SITE_ID,
        gatewayNoticeTitle: data.title,
        gatewayNoticeDescription: data.description,
        gatewayNoticeEnabled: data.enabled,
      },
      update: {
        gatewayNoticeTitle: data.title,
        gatewayNoticeDescription: data.description,
        gatewayNoticeEnabled: data.enabled,
      },
    });
    return this.toGatewayNotice(settings);
  }

  async getAdminBanner() {
    const banner = await this.ensureBanner();
    return this.toAdminBanner(banner);
  }

  async getAdminSideAds() {
    const items = await this.ensureSideAds();
    return items.map((item) => this.toAdminSideAd(item));
  }

  async updateSideAd(rawSlot: string, body: unknown, image?: Express.Multer.File) {
    const slot = this.parseSideAdSlot(rawSlot);
    const data = sideAdInputSchema.parse(body);
    const current = await this.prisma.sideAd.upsert({
      where: { slot },
      create: { slot },
      update: {},
    });
    let imageObjectKey = current.imageObjectKey;
    let imageUrl = current.imageUrl;
    let uploadedObjectKey: string | null = null;
    if (image) {
      uploadedObjectKey = await this.storeImage(`site/side-ad-${slot.toLowerCase()}`, image, 5 * 1024 * 1024);
      imageObjectKey = uploadedObjectKey;
      imageUrl = null;
    } else if (data.clearImage) {
      imageObjectKey = null;
      imageUrl = null;
    } else if (typeof (body as { imageUrl?: unknown })?.imageUrl === "string" && String((body as { imageUrl: string }).imageUrl).trim()) {
      imageObjectKey = null;
      imageUrl = data.imageUrl;
    }
    if (data.active && !imageObjectKey && !imageUrl) throw new BadRequestException("启用侧边广告前请先上传或填写图片");
    try {
      const item = await this.prisma.sideAd.update({
        where: { slot },
        data: { title: data.title, url: data.url, imageUrl, imageObjectKey, label: data.label, active: data.active },
      });
      if (current.imageObjectKey && current.imageObjectKey !== imageObjectKey) await this.objects.remove(current.imageObjectKey).catch(() => undefined);
      return this.toAdminSideAd(item);
    } catch (error) {
      if (uploadedObjectKey) await this.objects.remove(uploadedObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async getActiveSideAds() {
    const items = await this.prisma.sideAd.findMany({ where: { active: true, OR: [{ imageObjectKey: { not: null } }, { imageUrl: { not: null } }] }, orderBy: { slot: "asc" } });
    const visible = items.map((item) => this.toPublicSideAd(item));
    await Promise.all(items.map((item) => this.prisma.sideAd.update({ where: { id: item.id }, data: { impressionCount: { increment: 1 } } }).catch(() => undefined)));
    return visible;
  }

  async sideAdTarget(rawSlot: string) {
    const slot = this.parseSideAdSlot(rawSlot);
    const item = await this.prisma.sideAd.findUnique({ where: { slot } });
    if (!item?.active || (!item.imageObjectKey && !item.imageUrl)) throw new NotFoundException("Side ad not found");
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new NotFoundException("Unsafe destination");
    await this.prisma.sideAd.update({ where: { id: item.id }, data: { clickCount: { increment: 1 } } }).catch(() => undefined);
    return url.href;
  }

  async getSideAdAsset(rawSlot: string) {
    const slot = this.parseSideAdSlot(rawSlot);
    const item = await this.prisma.sideAd.findUnique({ where: { slot } });
    if (!item?.imageObjectKey) throw new NotFoundException("Asset not found");
    try { return await this.objects.getBinary(item.imageObjectKey); }
    catch { throw new NotFoundException("Asset not found"); }
  }

  async getAdminAnnouncement() {
    return this.toAnnouncement(await this.ensureAnnouncement());
  }

  async updateAnnouncement(body: unknown) {
    const data = announcementInputSchema.parse(body);
    const announcement = await this.prisma.siteAnnouncement.upsert({
      where: { id: ANNOUNCEMENT_ID },
      create: { id: ANNOUNCEMENT_ID, ...data },
      update: data,
    });
    return this.toAnnouncement(announcement);
  }

  async getActiveAnnouncement() {
    const now = new Date();
    const announcement = await this.prisma.siteAnnouncement.findFirst({
      where: {
        id: ANNOUNCEMENT_ID,
        enabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    });
    if (!announcement) return null;
    const result = this.toAnnouncement(announcement);
    return result.content.length ? result : null;
  }

  async updateBanner(body: unknown, files: { desktopImage?: Express.Multer.File[]; mobileImage?: Express.Multer.File[] }) {
    const data = homeBannerInputSchema.parse(body);
    const current = await this.ensureBanner();
    const desktopObjectKey = files.desktopImage?.[0] ? await this.storeImage("site/banner-desktop", files.desktopImage[0], 5 * 1024 * 1024) : current.desktopObjectKey;
    const mobileObjectKey = files.mobileImage?.[0] ? await this.storeImage("site/banner-mobile", files.mobileImage[0], 5 * 1024 * 1024) : current.mobileObjectKey;
    if (data.active && !desktopObjectKey) throw new BadRequestException("启用广告前请先上传桌面广告图");
    const banner = await this.prisma.homeBanner.update({
      where: { id: BANNER_ID },
      data: { ...data, desktopObjectKey, mobileObjectKey },
    });
    return this.toAdminBanner(banner);
  }

  async getActiveBanner() {
    const now = new Date();
    const banner = await this.prisma.homeBanner.findFirst({
      where: {
        id: BANNER_ID,
        active: true,
        desktopObjectKey: { not: null },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    });
    if (!banner || !banner.desktopObjectKey) return null;
    const version = banner.updatedAt.getTime();
    return {
      id: banner.id,
      title: banner.title,
      summary: banner.summary,
      buttonLabel: banner.buttonLabel,
      targetUrl: banner.targetUrl,
      imageDesktop: this.assetUrl("banner-desktop", version),
      imageMobile: this.assetUrl(banner.mobileObjectKey ? "banner-mobile" : "banner-desktop", version),
      label: banner.label,
      startsAt: (banner.startsAt || banner.createdAt).toISOString(),
      endsAt: (banner.endsAt || new Date("9999-12-31T23:59:59.999Z")).toISOString(),
    };
  }

  async getAsset(asset: string) {
    let objectKey: string | null = null;
    if (asset === "site-logo") objectKey = (await this.ensureSettings()).logoObjectKey;
    if (asset === "banner-desktop" || asset === "banner-mobile") {
      const banner = await this.ensureBanner();
      objectKey = asset === "banner-mobile" ? banner.mobileObjectKey || banner.desktopObjectKey : banner.desktopObjectKey;
    }
    if (!objectKey) throw new NotFoundException("Asset not found");
    try { return await this.objects.getBinary(objectKey); }
    catch { throw new NotFoundException("Asset not found"); }
  }

  async bannerTarget(id: string) {
    const banner = await this.getActiveBanner();
    if (!banner || banner.id !== id) throw new NotFoundException("Banner not found");
    const url = new URL(banner.targetUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new NotFoundException("Unsafe destination");
    return url.href;
  }

  private ensureSettings() {
    return this.prisma.siteSetting.upsert({ where: { id: SITE_ID }, create: { id: SITE_ID }, update: {} });
  }

  private ensureBanner() {
    return this.prisma.homeBanner.upsert({ where: { id: BANNER_ID }, create: { id: BANNER_ID }, update: {} });
  }

  private ensureAnnouncement() {
    return this.prisma.siteAnnouncement.upsert({
      where: { id: ANNOUNCEMENT_ID },
      create: { id: ANNOUNCEMENT_ID, content: [] },
      update: {},
    });
  }

  private ensureSideAds() {
    return Promise.all(SIDE_AD_SLOTS.map((slot) => this.prisma.sideAd.upsert({ where: { slot }, create: { slot }, update: {} })));
  }

  private parseSideAdSlot(rawSlot: string) {
    const result = sideAdSlotSchema.safeParse(String(rawSlot).toLowerCase());
    if (!result.success) throw new BadRequestException("广告位必须是 left 或 right");
    return result.data === "left" ? SideAdSlot.LEFT : SideAdSlot.RIGHT;
  }

  private toAdminSideAd(item: { id: string; slot: SideAdSlot; title: string; url: string; imageUrl: string | null; imageObjectKey: string | null; label: string; active: boolean; impressionCount: number; clickCount: number; createdAt: Date; updatedAt: Date }) {
    return {
      id: item.id,
      slot: item.slot === SideAdSlot.LEFT ? "left" as const : "right" as const,
      title: item.title,
      url: item.url,
      imageUrl: item.imageObjectKey ? this.assetUrl(`side-ads/${item.slot.toLowerCase()}`, item.updatedAt.getTime()) : item.imageUrl,
      label: item.label,
      active: item.active,
      impressionCount: item.impressionCount,
      clickCount: item.clickCount,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toPublicSideAd(item: { id: string; slot: SideAdSlot; title: string; url: string; imageUrl: string | null; imageObjectKey: string | null; label: string; updatedAt: Date }) {
    return {
      id: item.id,
      slot: item.slot === SideAdSlot.LEFT ? "left" as const : "right" as const,
      title: item.title,
      url: item.url,
      imageUrl: item.imageObjectKey ? this.assetUrl(`side-ads/${item.slot.toLowerCase()}`, item.updatedAt.getTime()) : item.imageUrl!,
      label: item.label,
    };
  }

  private toPublicSettings(settings: { siteName: string; slogan: string; description: string; seoTitle: string; seoDescription: string; seoKeywords: string[]; logoObjectKey: string | null; gatewayNoticeTitle: string; gatewayNoticeDescription: string; gatewayNoticeEnabled: boolean; updatedAt: Date }) {
    return {
      siteName: settings.siteName,
      slogan: settings.slogan,
      description: settings.description,
      seoTitle: settings.seoTitle,
      seoDescription: settings.seoDescription,
      seoKeywords: settings.seoKeywords,
      logoUrl: settings.logoObjectKey ? this.assetUrl("site-logo", settings.updatedAt.getTime()) : null,
      gatewayNotice: this.toGatewayNotice(settings),
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private toGatewayNotice(settings: { gatewayNoticeTitle: string; gatewayNoticeDescription: string; gatewayNoticeEnabled: boolean }) {
    return {
      title: settings.gatewayNoticeTitle,
      description: settings.gatewayNoticeDescription,
      enabled: settings.gatewayNoticeEnabled,
    };
  }

  private toAdminBanner(banner: { id: string; title: string; summary: string; buttonLabel: string; targetUrl: string; label: string; desktopObjectKey: string | null; mobileObjectKey: string | null; startsAt: Date | null; endsAt: Date | null; active: boolean; updatedAt: Date }) {
    const version = banner.updatedAt.getTime();
    return {
      id: banner.id,
      title: banner.title,
      summary: banner.summary,
      buttonLabel: banner.buttonLabel,
      targetUrl: banner.targetUrl,
      label: banner.label,
      imageDesktop: banner.desktopObjectKey ? this.assetUrl("banner-desktop", version) : null,
      imageMobile: banner.mobileObjectKey ? this.assetUrl("banner-mobile", version) : null,
      startsAt: banner.startsAt?.toISOString() || null,
      endsAt: banner.endsAt?.toISOString() || null,
      active: banner.active,
      updatedAt: banner.updatedAt.toISOString(),
    };
  }

  private toAnnouncement(announcement: { id: string; label: string; content: unknown; enabled: boolean; dismissible: boolean; startsAt: Date | null; endsAt: Date | null; updatedAt: Date }) {
    const content = Array.isArray(announcement.content)
      ? announcement.content.flatMap((segment) => {
          const parsed = announcementSegmentSchema.safeParse(segment);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return {
      id: announcement.id,
      label: announcement.label,
      content,
      enabled: announcement.enabled,
      dismissible: announcement.dismissible,
      startsAt: announcement.startsAt?.toISOString() || null,
      endsAt: announcement.endsAt?.toISOString() || null,
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }

  private assetUrl(asset: string, version: number) { return `/api/v1/assets/${asset}?v=${version}`; }

  private async storeImage(prefix: string, file: Express.Multer.File, maxSize: number) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择图片文件");
    if (file.size > maxSize) throw new BadRequestException(`图片不能超过 ${Math.round(maxSize / 1024 / 1024)} MB`);
    const extension = imageExtension(file.mimetype, file.buffer);
    if (!extension) throw new BadRequestException("仅支持 PNG、JPEG 或 WebP 图片");
    const key = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    await this.objects.put(key, file.buffer, file.mimetype);
    return key;
  }
}

function imageExtension(mime: string, body: Buffer) {
  if (mime === "image/png" && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if ((mime === "image/jpeg" || mime === "image/jpg") && body[0] === 0xff && body[1] === 0xd8 && body.at(-2) === 0xff && body.at(-1) === 0xd9) return "jpg";
  if (mime === "image/webp" && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}
