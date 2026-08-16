import { BotPlatform, BotRuntimeStatus } from "@prisma/client";
import { BotService } from "./bot.service";

const now = new Date("2026-08-14T04:00:00.000Z");
const integration = {
  platform: BotPlatform.TELEGRAM, enabled: false, configured: false, runtimeStatus: BotRuntimeStatus.WAITING_CONFIG,
  botUsername: null, lastHeartbeatAt: null, lastError: null, createdAt: now, updatedAt: now,
};

describe("BotService", () => {
  function setup() {
    const prisma = {
      botIntegration: { upsert: jest.fn().mockResolvedValue(integration) },
      botChatAllowlist: {
        findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      botQueryMetric: {
        count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _avg: { durationMs: null } }),
        groupBy: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
    };
    const market = { offers: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 0, ad: null }) };
    return { service: new BotService(prisma as never, market as never), prisma, market };
  }

  it("updates only the requested integration enable state", async () => {
    const { service, prisma } = setup();
    prisma.botIntegration.upsert.mockResolvedValue({ ...integration, enabled: true });
    await expect(service.updateIntegration("telegram", { enabled: true })).resolves.toEqual(expect.objectContaining({ platform: "telegram", enabled: true }));
    expect(prisma.botIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { platform: BotPlatform.TELEGRAM }, update: { enabled: true } }));
  });

  it("rejects invalid platform names and chat IDs", async () => {
    const { service } = setup();
    await expect(service.updateIntegration("discord", { enabled: true })).rejects.toThrow();
    await expect(service.saveChat("telegram", { externalChatId: "group-name", label: "测试群" })).rejects.toThrow();
  });

  it("uses the grouped offer search with price ordering for previews", async () => {
    const { service, market } = setup();
    await expect(service.preview({ q: "Plus 成品号", page: 1 })).resolves.toEqual(expect.objectContaining({ query: "Plus 成品号", items: [] }));
    expect(market.offers).toHaveBeenCalledWith({ q: "Plus 成品号", page: 1, pageSize: 10, sort: "price_asc" });
  });

  it("does not expose token fields in integration responses", async () => {
    const { service } = setup();
    const result = await service.internalConfig("telegram");
    expect(result).toEqual({ platform: "telegram", enabled: false });
    expect(result).not.toHaveProperty("token");
  });
});
