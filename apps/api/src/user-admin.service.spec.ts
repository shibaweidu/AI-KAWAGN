import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { UserAdminService } from "./user-admin.service";

const detailUser = {
  id: "buyer-1", email: "buyer@example.com", role: Role.BUYER, verifiedAt: new Date(), disabledAt: null, createdAt: new Date(),
  _count: { sponsorAds: 2, placementOrders: 3 }, placementOrders: [{ status: "APPROVED" as const }],
};

function setup() {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    session: { updateMany: jest.fn() },
    sponsorPlacementOrder: { updateMany: jest.fn() },
    sponsorAd: { updateMany: jest.fn() },
    sponsorPlacementCampaign: { updateMany: jest.fn() },
    managedListing: { updateMany: jest.fn() },
    $transaction: jest.fn(async (action: unknown) => typeof action === "function" ? action(prisma) : Promise.all(action as Promise<unknown>[])),
  };
  return { prisma, service: new UserAdminService(prisma as never) };
}

describe("UserAdminService", () => {
  it("stops sessions, advertisements and unfinished orders when disabling a user", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValueOnce({ id: "buyer-1", role: Role.BUYER, disabledAt: null }).mockResolvedValueOnce({ ...detailUser, disabledAt: new Date() });
    await expect(service.changeStatus("buyer-1", { active: false })).resolves.toMatchObject({ id: "buyer-1", active: false });
    expect(prisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "buyer-1", revokedAt: null } }));
    expect(prisma.sponsorPlacementOrder.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.sponsorPlacementCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELLED" } }));
    expect(prisma.managedListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: "buyer-1", active: true }, data: { active: false } }));
  });

  it("does not permit super-admin accounts to be changed in the UI", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: "admin-1", role: Role.ADMIN, disabledAt: null });
    await expect(service.changeRole("admin-1", { role: "buyer" })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
