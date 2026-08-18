import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role, SponsorAdStatus, SponsorPlacementCampaignStatus, SponsorPlacementOrderStatus } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "./prisma.service";

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  role: z.enum(["all", "buyer", "merchant", "moderator", "admin"]).optional().default("all"),
  status: z.enum(["all", "active", "disabled"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(30),
});
const roleSchema = z.object({ role: z.enum(["buyer", "merchant", "moderator"]) });
const statusSchema = z.object({ active: z.boolean() });

@Injectable()
export class UserAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: unknown) {
    const query = listQuerySchema.parse(input);
    const where = {
      ...(query.q ? { email: { contains: query.q, mode: "insensitive" as const } } : {}),
      ...(query.role !== "all" ? { role: query.role.toUpperCase() as Role } : {}),
      ...(query.status === "active" ? { disabledAt: null } : query.status === "disabled" ? { disabledAt: { not: null } } : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, role: true, verifiedAt: true, disabledAt: true, createdAt: true,
          _count: { select: { sponsorAds: true, placementOrders: true } },
          placementOrders: { select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: users.map(toAdminUser), total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, role: true, verifiedAt: true, disabledAt: true, createdAt: true,
        _count: { select: { sponsorAds: true, placementOrders: true } },
        placementOrders: { select: { status: true } },
      },
    });
    if (!user) throw new NotFoundException("用户不存在");
    return toAdminUser(user);
  }

  async changeRole(id: string, input: unknown) {
    const data = roleSchema.parse(input);
    const user = await this.requireManageable(id);
    const role = data.role.toUpperCase() as Role;
    if (user.role === role) return this.detail(id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { role } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return this.detail(id);
  }

  async changeStatus(id: string, input: unknown) {
    const data = statusSchema.parse(input);
    const user = await this.requireManageable(id);
    if (data.active) {
      if (!user.disabledAt) return this.detail(id);
      await this.prisma.user.update({ where: { id }, data: { disabledAt: null } });
      return this.detail(id);
    }
    if (user.disabledAt) return this.detail(id);
    const now = new Date();
    const reason = "用户账号已被超级管理员停用";
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { disabledAt: now } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.sponsorPlacementOrder.updateMany({ where: { userId: id, status: { in: [SponsorPlacementOrderStatus.PENDING_PAYMENT, SponsorPlacementOrderStatus.PAYMENT_PROCESSING] } }, data: { status: SponsorPlacementOrderStatus.CANCELLED, reviewNote: reason } });
      await tx.sponsorPlacementOrder.updateMany({ where: { userId: id, status: SponsorPlacementOrderStatus.PAID_PENDING_REVIEW }, data: { status: SponsorPlacementOrderStatus.REFUND_PENDING, reviewedAt: now, reviewNote: reason } });
      await tx.sponsorAd.updateMany({ where: { userId: id, status: { in: [SponsorAdStatus.DRAFT, SponsorAdStatus.PENDING_PAYMENT] } }, data: { status: SponsorAdStatus.CANCELLED } });
      await tx.sponsorAd.updateMany({ where: { userId: id, status: SponsorAdStatus.PAID_PENDING_REVIEW }, data: { status: SponsorAdStatus.REJECTED, rejectionReason: reason, reviewedAt: now } });
      await tx.sponsorPlacementCampaign.updateMany({ where: { order: { userId: id }, status: { in: [SponsorPlacementCampaignStatus.SCHEDULED, SponsorPlacementCampaignStatus.RUNNING] } }, data: { status: SponsorPlacementCampaignStatus.CANCELLED } });
      await tx.managedListing.updateMany({ where: { ownerUserId: id, active: true }, data: { active: false } });
    });
    return this.detail(id);
  }

  private async requireManageable(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true, disabledAt: true } });
    if (!user) throw new NotFoundException("用户不存在");
    if (user.role === Role.ADMIN) throw new ForbiddenException("超级管理员账号只能通过命令行维护");
    return user;
  }
}

function toAdminUser(user: { id: string; email: string; role: Role; verifiedAt: Date | null; disabledAt: Date | null; createdAt: Date; _count: { sponsorAds: number; placementOrders: number }; placementOrders: Array<{ status: SponsorPlacementOrderStatus }> }) {
  const orderStatuses = user.placementOrders.reduce<Record<string, number>>((counts, order) => {
    const key = order.status.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    id: user.id, email: user.email, role: user.role.toLowerCase(), verified: Boolean(user.verifiedAt), active: !user.disabledAt,
    disabledAt: user.disabledAt?.toISOString() || null, createdAt: user.createdAt.toISOString(),
    ads: user._count.sponsorAds, orders: user._count.placementOrders, orderStatuses,
  };
}
