import { HttpException } from "@nestjs/common";
import { ShopStatus, SubmissionKind } from "@prisma/client";
import { SubmissionService, normalizeSubmissionUrl } from "./submission.service";

const submission = {
  id: "submission-1",
  kind: SubmissionKind.SHOP,
  name: "示例店铺",
  url: "https://shop.example.com/",
  normalizedUrl: "https://shop.example.com/",
  contactEmail: "owner@example.com",
  description: "公开商品店铺",
  authorizationConfirmed: true,
  clientIpHash: "hash",
  status: ShopStatus.PENDING,
  reviewNote: null,
  reviewedAt: null,
  createdAt: new Date("2026-08-14T00:00:00.000Z"),
};

function setup() {
  const prisma = {
    shopSubmission: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(submission),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    shop: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    gatewayDirectoryEntry: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  const gateways = { createManualGateway: jest.fn() };
  return { prisma, gateways, service: new SubmissionService(prisma as never, gateways as never) };
}

describe("SubmissionService", () => {
  it("normalizes HTTPS links and drops tracking fragments", () => {
    expect(normalizeSubmissionUrl("https://SHOP.example.com/path/?utm=campaign#top")).toEqual({
      url: "https://shop.example.com/path",
      normalizedUrl: "https://shop.example.com/path",
    });
  });

  it("accepts anonymous shop submissions without storing the raw IP", async () => {
    const { prisma, service } = setup();
    await expect(service.submit({
      kind: "shop", name: "示例店铺", url: "https://shop.example.com/?utm=ad", contactEmail: "OWNER@example.com",
      description: "公开商品店铺", authorizationConfirmed: true, website: "",
    }, "203.0.113.8")).resolves.toEqual({ accepted: true, id: "submission-1", duplicate: false });
    expect(prisma.shopSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: SubmissionKind.SHOP,
      normalizedUrl: "https://shop.example.com/",
      contactEmail: "owner@example.com",
      clientIpHash: expect.not.stringContaining("203.0.113.8"),
    }) }));
  });

  it("returns the existing submission for a duplicate link", async () => {
    const { prisma, service } = setup();
    prisma.shopSubmission.findUnique.mockResolvedValue(submission);
    await expect(service.submit({ kind: "shop", name: "重复", url: submission.url, contactEmail: "owner@example.com", authorizationConfirmed: true }, "203.0.113.8"))
      .resolves.toEqual({ accepted: true, id: submission.id, duplicate: true });
    expect(prisma.shopSubmission.create).not.toHaveBeenCalled();
  });

  it("blocks honeypots and limits a client to three daily submissions", async () => {
    const { prisma, service } = setup();
    await expect(service.submit({ kind: "gateway", name: "机器人", url: "https://gateway.example.com", contactEmail: "owner@example.com", authorizationConfirmed: true, website: "filled" }, "203.0.113.8"))
      .resolves.toEqual({ accepted: true, id: null, duplicate: false });
    expect(prisma.shopSubmission.findUnique).not.toHaveBeenCalled();

    prisma.shopSubmission.count.mockResolvedValue(3);
    await expect(service.submit({ kind: "gateway", name: "示例中转站", url: "https://gateway.example.com", contactEmail: "owner@example.com", authorizationConfirmed: true }, "203.0.113.8"))
      .rejects.toBeInstanceOf(HttpException);
  });

  it("requires a rejection note and publishes a gateway through the manual gateway flow", async () => {
    const { prisma, gateways, service } = setup();
    prisma.shopSubmission.findUnique.mockResolvedValue({ ...submission, kind: SubmissionKind.GATEWAY });
    await expect(service.decide(submission.id, { action: "reject" })).rejects.toThrow("请填写拒绝原因");

    gateways.createManualGateway.mockResolvedValue({ id: "gateway-1" });
    prisma.shopSubmission.update.mockResolvedValue({ ...submission, kind: SubmissionKind.GATEWAY, status: ShopStatus.ACTIVE, reviewedAt: new Date() });
    await expect(service.decide(submission.id, { action: "publish", name: "示例中转站", description: "中转服务", modelTags: "GPT" }))
      .resolves.toEqual(expect.objectContaining({ status: "published", published: { type: "gateway", id: "gateway-1" } }));
    expect(gateways.createManualGateway).toHaveBeenCalledWith(expect.objectContaining({ name: "示例中转站", url: submission.url, modelTags: "GPT" }));
  });

  it("publishes a reviewed shop with an authorized submission source but no automatic product crawl", async () => {
    const { prisma, service } = setup();
    prisma.shopSubmission.findUnique.mockResolvedValue(submission);
    prisma.shopSubmission.findUniqueOrThrow.mockResolvedValue({ ...submission, status: ShopStatus.ACTIVE, reviewedAt: new Date() });
    const tx = {
      shop: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "shop-1", slug: "submission-submission-1" }) },
      dataSource: { upsert: jest.fn().mockResolvedValue({ id: "source-1", name: "用户授权投稿" }) },
      shopSource: { create: jest.fn().mockResolvedValue({}) },
      shopSubmission: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(service.decide(submission.id, { action: "publish", description: "审核后的店铺说明" }))
      .resolves.toEqual(expect.objectContaining({ status: "published", published: { type: "shop", id: "shop-1", slug: "submission-submission-1" } }));
    expect(tx.shop.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      adapterKind: "authorized-direct", status: ShopStatus.ACTIVE, homepageUrl: submission.url,
    }) }));
    expect(tx.shopSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalId: submission.id }) }));
  });

  it("edits a published shop and writes the change to the published record", async () => {
    const { prisma, service } = setup();
    const published = { ...submission, status: ShopStatus.ACTIVE, publishedShopId: "shop-1" };
    prisma.shopSubmission.findUnique.mockResolvedValue(published);
    prisma.shop.update.mockResolvedValue({ id: "shop-1" });
    prisma.shopSubmission.update.mockResolvedValue({ ...published, name: "新名称", url: "https://new.example.com" });
    prisma.shop.findUnique.mockResolvedValue({ id: "shop-1", name: "新名称", description: "新说明", homepageUrl: "https://new.example.com" });

    await expect(service.decide(submission.id, {
      action: "edit", name: "新名称", url: "https://new.example.com", contactEmail: "new@example.com", description: "新说明",
    })).resolves.toEqual(expect.objectContaining({ name: "新名称", published: expect.objectContaining({ id: "shop-1", url: "https://new.example.com" }) }));
    expect(prisma.shop.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop-1" }, data: expect.objectContaining({ name: "新名称", homepageUrl: "https://new.example.com/" }) }));
  });

  it("rejects and removes a published submission from public listings", async () => {
    const { prisma, service } = setup();
    const published = { ...submission, status: ShopStatus.ACTIVE, publishedShopId: "shop-1" };
    prisma.shopSubmission.findUnique.mockResolvedValue(published);
    prisma.shop.update.mockResolvedValue({});
    prisma.shopSubmission.update.mockResolvedValue({ ...published, status: ShopStatus.REJECTED, reviewNote: "资料失效" });

    await expect(service.decide(submission.id, { action: "reject", reviewNote: "资料失效" })).resolves.toEqual(expect.objectContaining({ status: "rejected" }));
    expect(prisma.shop.update).toHaveBeenCalledWith({ where: { id: "shop-1" }, data: { status: ShopStatus.REJECTED, publishedAt: null } });

    prisma.shopSubmission.findUnique.mockResolvedValue({ ...published, deletedAt: null });
    await expect(service.remove(submission.id)).resolves.toEqual({ id: submission.id, deleted: true });
    expect(prisma.shopSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: submission.id }, data: { deletedAt: expect.any(Date) } }));
  });
});
