import { AuthService } from "./auth.service";

describe("AuthService", () => {
  it("does not authenticate sessions belonging to disabled users", async () => {
    const prisma = { session: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { id: "user-1", email: "user@example.com", role: "BUYER", verifiedAt: new Date(), disabledAt: new Date(), createdAt: new Date() } }) } };
    const service = new AuthService(prisma as never);
    await expect(service.verify("session-token")).resolves.toBeNull();
  });
});
