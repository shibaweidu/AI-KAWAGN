import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { submissionDecisionSchema, submissionSchema } from "@ai-card/contracts";
import { CollectionMode, DataSourceKind, Prisma, ShopStatus, SubmissionKind } from "@prisma/client";
import { createHmac } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { GatewayDirectoryService } from "./gateway-directory.service";

const DAILY_SUBMISSION_LIMIT = 3;
const SUBMISSION_SOURCE_KEY = "user-submissions";

@Injectable()
export class SubmissionService {
  constructor(private readonly prisma: PrismaService, private readonly gateways: GatewayDirectoryService) {}

  async submit(body: unknown, clientIp: string) {
    const data = submissionSchema.parse(body);
    // Bots commonly populate every text input. Treat this as a successful no-op.
    if (data.website.trim()) return { accepted: true, id: null, duplicate: false };
    const { url, normalizedUrl } = normalizeSubmissionUrl(data.url);
    const kind = data.kind === "gateway" ? SubmissionKind.GATEWAY : SubmissionKind.SHOP;
    const existing = await this.prisma.shopSubmission.findUnique({ where: { kind_normalizedUrl: { kind, normalizedUrl } } });
    if (existing) return { accepted: true, id: existing.id, duplicate: true };

    const clientIpHash = hashClientIp(clientIp);
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const recentCount = await this.prisma.shopSubmission.count({ where: { clientIpHash, createdAt: { gte: since } } });
    if (recentCount >= DAILY_SUBMISSION_LIMIT) throw new HttpException("提交次数过多，请 24 小时后再试", HttpStatus.TOO_MANY_REQUESTS);

    try {
      const record = await this.prisma.shopSubmission.create({
        data: {
          kind,
          name: data.name,
          url,
          normalizedUrl,
          contactEmail: data.contactEmail.trim().toLowerCase(),
          description: data.description,
          authorizationConfirmed: true,
          clientIpHash,
        },
      });
      return { accepted: true, id: record.id, duplicate: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const duplicate = await this.prisma.shopSubmission.findUnique({ where: { kind_normalizedUrl: { kind, normalizedUrl } } });
      if (!duplicate) throw error;
      return { accepted: true, id: duplicate.id, duplicate: true };
    }
  }

  async listAdmin(raw: Record<string, unknown>) {
    const page = positiveInt(raw.page, 1);
    const pageSize = Math.min(100, positiveInt(raw.pageSize, 30));
    const kind = raw.kind === "shop" ? SubmissionKind.SHOP : raw.kind === "gateway" ? SubmissionKind.GATEWAY : undefined;
    const status = raw.status === "pending" ? ShopStatus.PENDING : raw.status === "published" ? ShopStatus.ACTIVE : raw.status === "rejected" ? ShopStatus.REJECTED : undefined;
    const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : "";
    const where: Prisma.ShopSubmissionWhereInput = {
      kind,
      status,
      OR: q ? [
        { name: { contains: q, mode: "insensitive" } },
        { url: { contains: q, mode: "insensitive" } },
        { contactEmail: { contains: q, mode: "insensitive" } },
      ] : undefined,
    };
    const [items, total, pending] = await this.prisma.$transaction([
      this.prisma.shopSubmission.findMany({ where: { ...where, deletedAt: null }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.shopSubmission.count({ where: { ...where, deletedAt: null } }),
      this.prisma.shopSubmission.count({ where: { status: ShopStatus.PENDING, deletedAt: null } }),
    ]);
    return {
      items: await Promise.all(items.map((item) => this.serializeAdminSubmission(item))),
      total,
      pending,
      page,
      pageSize,
      totalPages: total ? Math.ceil(total / pageSize) : 0,
    };
  }

  async decide(id: string, body: unknown) {
    const decision = submissionDecisionSchema.parse(body);
    const submission = await this.prisma.shopSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException("投稿不存在");
    if (submission.deletedAt) throw new BadRequestException("该投稿已删除");

    if (decision.action === "reject") {
      if (!decision.reviewNote) throw new BadRequestException("请填写拒绝原因");
      await this.unpublish(submission);
      return this.serializeAdminSubmission(await this.prisma.shopSubmission.update({
        where: { id }, data: { status: ShopStatus.REJECTED, reviewNote: decision.reviewNote, reviewedAt: new Date() },
      }));
    }

    const name = decision.name || submission.name || fallbackSubmissionName(submission.url);
    const url = decision.url ? normalizeSubmissionUrl(decision.url).url : submission.url;
    const contactEmail = decision.contactEmail || submission.contactEmail;
    const description = decision.description ?? submission.description;
    if (decision.action === "edit") {
      if (submission.status === ShopStatus.ACTIVE) {
        if (submission.kind === SubmissionKind.GATEWAY) {
          const gatewayId = await this.findPublishedGatewayId(submission);
          if (gatewayId) await this.gateways.updateManualGateway(gatewayId, this.gatewayInput(decision, name, description, url));
        } else {
          const shopId = await this.findPublishedShopId(submission);
          if (shopId) await this.prisma.shop.update({ where: { id: shopId }, data: { name, description, homepageUrl: url } });
        }
      }
      return this.serializeAdminSubmission(await this.prisma.shopSubmission.update({
        where: { id },
        data: { name, url, normalizedUrl: normalizeSubmissionUrl(url).normalizedUrl, contactEmail, description, reviewNote: decision.reviewNote || submission.reviewNote, reviewedAt: submission.status === ShopStatus.PENDING ? submission.reviewedAt : new Date() },
      }));
    }
    if (submission.status === ShopStatus.ACTIVE) throw new BadRequestException("已发布投稿请使用再次编辑");
    if (submission.kind === SubmissionKind.GATEWAY) {
      const gatewayId = await this.findPublishedGatewayId(submission);
      const gateway = gatewayId
        ? await this.gateways.updateManualGateway(gatewayId, this.gatewayInput(decision, name, description, url))
        : await this.gateways.createManualGateway(this.gatewayInput(decision, name, description, url));
      const updated = await this.prisma.shopSubmission.update({
        where: { id }, data: { name, url, normalizedUrl: normalizeSubmissionUrl(url).normalizedUrl, contactEmail, description, status: ShopStatus.ACTIVE, publishedGatewayId: gateway.id, publishedShopId: null, reviewNote: decision.reviewNote || null, reviewedAt: new Date() },
      });
      return { ...serializeSubmission(updated), published: { type: "gateway", id: gateway.id } };
    }

    const shop = await this.publishShop({ ...submission, publishedShopId: await this.findPublishedShopId(submission) }, name, url, description, decision.reviewNote);
    const updated = await this.prisma.shopSubmission.findUniqueOrThrow({ where: { id } });
    return { ...(await this.serializeAdminSubmission(updated)), published: { type: "shop" as const, id: shop.id, slug: shop.slug } };
  }

  async remove(id: string) {
    const submission = await this.prisma.shopSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException("投稿不存在");
    if (submission.deletedAt) return { id, deleted: true };
    await this.unpublish(submission);
    await this.prisma.shopSubmission.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }

  private async publishShop(submission: { id: string; url: string; publishedShopId: string | null }, name: string, url: string, description: string, reviewNote: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.shop.findFirst({ where: { id: submission.publishedShopId || undefined }, select: { id: true, slug: true } });
      const duplicate = !existing ? await tx.shop.findFirst({ where: { homepageUrl: url }, select: { id: true } }) : null;
      if (duplicate) throw new BadRequestException("该店铺已收录");
      const source = await tx.dataSource.upsert({
        where: { key: SUBMISSION_SOURCE_KEY },
        create: {
          key: SUBMISSION_SOURCE_KEY,
          name: "用户授权投稿",
          kind: DataSourceKind.MANUAL_IMPORT,
          baseUrl: "https://aikawang.local/submissions",
          attributionUrl: "https://aikawang.local/submissions",
          enabled: false,
          pollIntervalSeconds: 24 * 60 * 60,
          robotsReviewedAt: new Date(),
        },
        update: {},
      });
      const shop = existing ? await tx.shop.update({ where: { id: existing.id }, data: { name, description: description || "由店铺授权提交，商品与报价会在配置同步来源后展示。", homepageUrl: url, status: ShopStatus.ACTIVE, verifiedAt: new Date(), publishedAt: new Date() } }) : await tx.shop.create({
        data: {
          slug: `submission-${submission.id}`,
          name,
          description: description || "由店铺授权提交，商品与报价会在配置同步来源后展示。",
          homepageUrl: url,
          adapterKind: "authorized-direct",
          status: ShopStatus.ACTIVE,
          verifiedAt: new Date(),
          publishedAt: new Date(),
          trustScore: 50,
        },
      });
      if (!existing) await tx.shopSource.create({
        data: {
          shopId: shop.id,
          dataSourceId: source.id,
          externalId: submission.id,
          collectionMode: CollectionMode.AUTHORIZED_DIRECT,
          attributionLabel: source.name,
          authorizationEvidence: "用户投稿时确认拥有店铺或已获得数据同步授权。",
        },
      });
      await tx.shopSubmission.update({
        where: { id: submission.id },
        data: { name, url, normalizedUrl: normalizeSubmissionUrl(url).normalizedUrl, description, status: ShopStatus.ACTIVE, publishedShopId: shop.id, publishedGatewayId: null, reviewNote: reviewNote || null, reviewedAt: new Date() },
      });
      return shop;
    });
  }

  private gatewayInput(decision: { logoUrl?: string; modelTags?: string; pricingClaims?: string; displayGroupId?: string | null }, name: string, description: string, url: string) {
    return { name, description, url, logoUrl: decision.logoUrl || "", modelTags: decision.modelTags || "", pricingClaims: decision.pricingClaims || "", displayGroupId: decision.displayGroupId || null };
  }

  private async unpublish(submission: { id: string; kind: SubmissionKind; publishedShopId: string | null; publishedGatewayId: string | null; url: string }) {
    if (submission.kind === SubmissionKind.GATEWAY) {
      const id = await this.findPublishedGatewayId(submission);
      if (id) await this.gateways.rejectManualGateway(id);
    } else {
      const id = await this.findPublishedShopId(submission);
      if (id) await this.prisma.shop.update({ where: { id }, data: { status: ShopStatus.REJECTED, publishedAt: null } });
    }
  }

  private async findPublishedShopId(submission: { id: string; publishedShopId: string | null }) {
    if (submission.publishedShopId) return submission.publishedShopId;
    const shop = await this.prisma.shop.findUnique({ where: { slug: `submission-${submission.id}` }, select: { id: true } });
    return shop?.id || null;
  }

  private async findPublishedGatewayId(submission: { publishedGatewayId: string | null; url: string }) {
    if (submission.publishedGatewayId) return submission.publishedGatewayId;
    const gateway = await this.prisma.gatewayDirectoryEntry.findFirst({ where: { sourceKey: "manual", destinationUrl: submission.url }, select: { id: true } });
    return gateway?.id || null;
  }

  private async serializeAdminSubmission(item: Parameters<typeof serializeSubmission>[0] & { publishedShopId: string | null; publishedGatewayId: string | null }) {
    const base = serializeSubmission(item);
    if (item.kind === SubmissionKind.SHOP) {
      const id = await this.findPublishedShopId(item);
      const shop = id ? await this.prisma.shop.findUnique({ where: { id }, select: { id: true, name: true, description: true, homepageUrl: true } }) : null;
      return { ...base, published: shop ? { type: "shop" as const, id: shop.id, name: shop.name, description: shop.description, url: shop.homepageUrl } : null };
    }
    const id = await this.findPublishedGatewayId(item);
    const gateway = id ? await this.prisma.gatewayDirectoryEntry.findUnique({ where: { id }, include: { displayGroup: true } }) : null;
    return { ...base, published: gateway ? { type: "gateway" as const, id: gateway.id, name: gateway.name, description: gateway.description, url: gateway.destinationUrl || gateway.sourceRedirectUrl, logoUrl: gateway.logoUrl || "", modelTags: gateway.modelTags.join(", "), pricingClaims: gateway.pricingClaims || "", displayGroupId: gateway.displayGroupId || "" } : null };
  }
}

export function normalizeSubmissionUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password) throw new BadRequestException("仅接受不含账号信息的 HTTPS 链接");
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return { url: url.href, normalizedUrl: url.href };
}

export function hashClientIp(clientIp: string) {
  const secret = process.env.SUBMISSION_IP_HASH_SECRET || process.env.JWT_SECRET || "development-submission-ip-hash-secret";
  return createHmac("sha256", secret).update(clientIp || "unknown").digest("hex");
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function serializeSubmission(item: { id: string; kind: SubmissionKind; name: string; url: string; contactEmail: string; description: string; authorizationConfirmed: boolean; status: ShopStatus; reviewNote: string | null; reviewedAt: Date | null; createdAt: Date }) {
  return {
    id: item.id,
    kind: item.kind === SubmissionKind.GATEWAY ? "gateway" : "shop",
    name: item.name || fallbackSubmissionName(item.url),
    url: item.url,
    contactEmail: item.contactEmail,
    description: item.description,
    authorizationConfirmed: item.authorizationConfirmed,
    status: item.status === ShopStatus.ACTIVE ? "published" : item.status === ShopStatus.REJECTED ? "rejected" : "pending",
    reviewNote: item.reviewNote,
    reviewedAt: item.reviewedAt?.toISOString() || null,
    createdAt: item.createdAt.toISOString(),
  };
}

function fallbackSubmissionName(url: string) {
  try { return new URL(url).hostname; }
  catch { return "未命名投稿"; }
}
