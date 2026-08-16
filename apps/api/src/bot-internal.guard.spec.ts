import { UnauthorizedException } from "@nestjs/common";
import { BotInternalGuard } from "./bot-internal.guard";

function context(authorization?: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) } as never;
}

describe("BotInternalGuard", () => {
  const original = process.env.BOT_INTERNAL_SECRET;
  afterEach(() => { process.env.BOT_INTERNAL_SECRET = original; });

  it("accepts the dedicated internal bearer secret", () => {
    process.env.BOT_INTERNAL_SECRET = "a-secure-internal-secret";
    expect(new BotInternalGuard().canActivate(context("Bearer a-secure-internal-secret"))).toBe(true);
  });

  it("rejects missing and incorrect credentials", () => {
    process.env.BOT_INTERNAL_SECRET = "a-secure-internal-secret";
    expect(() => new BotInternalGuard().canActivate(context())).toThrow(UnauthorizedException);
    expect(() => new BotInternalGuard().canActivate(context("Bearer incorrect"))).toThrow(UnauthorizedException);
  });
});
