import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

@Injectable()
export class BotInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization || "";
    const received = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = process.env.BOT_INTERNAL_SECRET || "";
    if (!expected || !received || !sameSecret(received, expected)) throw new UnauthorizedException("Bot service authentication required");
    return true;
  }
}

function sameSecret(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
