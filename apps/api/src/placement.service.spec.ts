import { Prisma } from "@prisma/client";
import { PlacementService } from "./placement.service";

function setup() {
  const prisma = {
    sponsorPlacementSlotConfig: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
    sponsorPlacementOrder: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    sponsorAd: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
  };
  const objects = { put: jest.fn(), remove: jest.fn(), getBinary: jest.fn() };
  return { prisma, objects, service: new PlacementService(prisma as never, objects as never) };
}

describe("PlacementService", () => {
  it("calculates every line and total from server-side price rules", async () => {
    const { prisma, service } = setup();
    prisma.sponsorPlacementSlotConfig.findMany.mockResolvedValue([
      { key: "gateway", name: "中转站目录", dailyPrice: new Prisma.Decimal(20), minDays: 1, maxDays: 30, position: 0 },
      { key: "home_bottom", name: "首页底部", dailyPrice: new Prisma.Decimal(15), minDays: 1, maxDays: 30, position: 3 },
    ]);
    await expect(service.quote({ items: [{ key: "gateway", days: 3 }, { key: "home_bottom", days: 2 }] })).resolves.toEqual({
      items: [
        { key: "gateway", name: "中转站目录", days: 3, dailyPrice: 20, subtotal: 60, minDays: 1, maxDays: 30 },
        { key: "home_bottom", name: "首页底部", days: 2, dailyPrice: 15, subtotal: 30, minDays: 1, maxDays: 30 },
      ],
      total: 90,
    });
  });

  it("rejects duplicate positions before an order can be created", async () => {
    const { service } = setup();
    await expect(service.quote({ items: [{ key: "gateway", days: 3 }, { key: "gateway", days: 5 }] })).rejects.toThrow("投放位置不能重复");
  });

  it("accepts repeated successful payment notifications idempotently", async () => {
    const { prisma, service } = setup();
    prisma.sponsorPlacementOrder.findUnique.mockResolvedValue({ id: "order-1", orderNo: "PA1", sponsorAdId: "ad-1", totalAmount: new Prisma.Decimal(20), status: "PAID_PENDING_REVIEW" });
    await expect(service.notifyPayment({ out_trade_no: "PA1", money: "20.00", trade_status: "TRADE_SUCCESS" })).resolves.toBe("success");
    expect(prisma.sponsorPlacementOrder.update).not.toHaveBeenCalled();
  });
});
